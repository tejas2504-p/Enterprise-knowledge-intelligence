import inspect
import logging
import re
from typing import Any, Optional
from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.models.query_understanding import (
    QueryUnderstandingRequest,
    QueryUnderstandingResult,
    QueryUnderstandingSummary,
)
from app.models.rag import Citation, RagQueryRequest, RagQueryResponse, RagRetrievalMetadata
from app.prompts.rag_prompts import INSUFFICIENT_EVIDENCE_RESPONSE
from app.services.embedding_service import (
    EmbeddingProviderError,
    EmbeddingRateLimitError,
    EmbeddingValidationError,
    gemini_embedding_service,
    sanitize_error_message,
)
from app.services.generation_service import (
    GenerationProviderError,
    GenerationRateLimitError,
    GenerationTimeoutError,
    gemini_generation_service,
)
from app.services.query_understanding import query_understanding_service
from app.services.vector_store import (
    IncompatibleVectorDimensionError,
    InvalidVectorError,
    VectorSearchResult,
    VectorStoreConnectionError,
    vector_store_service,
)

logger = logging.getLogger(__name__)


def extract_relevant_excerpt(text: str, query: str, max_chars: int = 250) -> str:
    """
    Extract a concise, relevant excerpt from chunk text matching query terms where possible,
    falling back to leading text if no specific term boundary is found.
    """
    clean_text = text.strip()
    if len(clean_text) <= max_chars:
        return clean_text

    # Seek query keywords in chunk
    words = [re.escape(w.lower()) for w in re.findall(r"\w+", query) if len(w) > 3]
    if words:
        pattern = re.compile(r"|".join(words), re.IGNORECASE)
        match = pattern.search(clean_text)
        if match:
            start_pos = max(0, match.start() - 60)
            end_pos = min(len(clean_text), start_pos + max_chars)
            excerpt = clean_text[start_pos:end_pos].strip()
            if start_pos > 0:
                excerpt = "..." + excerpt
            if end_pos < len(clean_text):
                excerpt = excerpt + "..."
            return excerpt

    # Fallback to leading slice
    return clean_text[:max_chars].strip() + "..."


class RagQueryService:
    """
    Orchestrates the 9-step Retrieval-Augmented Generation pipeline.
    """

    def __init__(
        self,
        vector_store=None,
        embedding_service=None,
        generation_service=None,
        query_understanding=None,
    ):
        self.vector_store = vector_store or vector_store_service
        self.embedding_service = embedding_service or gemini_embedding_service
        self.generation_service = generation_service or gemini_generation_service
        self.query_understanding = query_understanding or query_understanding_service

    @staticmethod
    def _build_qu_summary(
        qu_result: Optional[QueryUnderstandingResult],
    ) -> Optional[QueryUnderstandingSummary]:
        if qu_result is None:
            return None
        return QueryUnderstandingSummary(
            intent=qu_result.analysis.intent,
            keywords=qu_result.analysis.keywords,
            entities=qu_result.analysis.entities,
            is_ambiguous=qu_result.analysis.is_ambiguous,
            clarification_needed=qu_result.analysis.clarification_needed,
            suggested_clarifications=qu_result.analysis.suggested_clarifications,
            is_multi_part=qu_result.analysis.is_multi_part,
            is_follow_up=qu_result.analysis.is_follow_up,
            was_rewritten=qu_result.rewrite.was_rewritten,
            rewrite_strategy=qu_result.rewrite.rewrite_strategy,
            original_question=qu_result.original_question,
            primary_retrieval_query=qu_result.rewrite.primary_retrieval_query,
            alternative_queries=qu_result.rewrite.alternative_queries,
            sub_queries=qu_result.rewrite.sub_queries,
            retrieval_queries_used=qu_result.retrieval_queries,
            used_conversation_context=qu_result.used_conversation_context,
            fallback_used=qu_result.fallback_used,
        )

    async def verify_kb_access(
        self,
        knowledge_base_id: str,
        db: Any = None,
        user_id: Optional[str] = None,
        user_role: str = "user",
        user_department: Optional[str] = None,
        organization_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Verify the user's access to the requested knowledge base through MongoDB.
        Enforces tenant isolation, visibility permissions (private, department, organization),
        admin overrides, and archived status checks.
        """
        if db is None:
            # Testing mode without MongoDB attached
            return {
                "knowledge_base_id": knowledge_base_id,
                "organization_id": organization_id,
                "department": None,
                "visibility": "organization",
                "owner": user_id or "",
            }

        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Verified user identity is required to access Knowledge Base",
            )

        query = {"_id": ObjectId(knowledge_base_id)} if ObjectId.is_valid(knowledge_base_id) else {"_id": knowledge_base_id}
        kb = await db["knowledgebases"].find_one(query)

        if not kb:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Knowledge Base '{knowledge_base_id}' not found",
            )

        kb_owner = str(kb.get("owner", ""))
        kb_visibility = kb.get("visibility", "private")
        kb_org = kb.get("organization")
        kb_dept = kb.get("department")
        kb_status = kb.get("status", "active")

        if kb_status == "archived":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Knowledge Base is archived and cannot be queried",
            )

        # Organization isolation
        if organization_id and kb_org and organization_id != kb_org:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized: organization boundary mismatch",
            )

        # Authorization matrix matching Node.js access control
        is_authorized = False
        if user_role == "admin":
            is_authorized = True
        elif user_id == kb_owner:
            is_authorized = True
        elif kb_visibility == "organization":
            is_authorized = True
        elif kb_visibility == "department":
            is_authorized = bool(user_department and kb_dept and user_department == kb_dept)

        if not is_authorized:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Not authorized to access this private Knowledge Base"
                    if kb_visibility == "private"
                    else "Not authorized to access this Knowledge Base"
                ),
            )

        return {
            "knowledge_base_id": str(kb.get("_id", knowledge_base_id)),
            "organization_id": kb_org or organization_id,
            "department": kb_dept,
            "visibility": kb_visibility,
            "owner": kb_owner,
            "title": kb.get("name", ""),
        }

    async def get_authorized_document_ids(
        self,
        knowledge_base_id: str,
        kb_context: dict[str, Any],
        db: Any = None,
        user_id: Optional[str] = None,
        user_role: str = "user",
        user_department: Optional[str] = None,
    ) -> tuple[Optional[list[str]], dict[str, Any]]:
        """
        Resolve indexed document IDs inside the Knowledge Base that the user is authorized to read.
        Returns (allowed_document_ids, doc_stats). If MongoDB documents cursor is unavailable (unit test),
        returns (None, {}).
        """
        if db is None:
            return None, {}

        docs_coll = db["documents"]
        find_fn = getattr(docs_coll, "find", None)
        if not callable(find_fn):
            return None, {}

        kb_query = (
            {"knowledgeBase": {"$in": [ObjectId(knowledge_base_id), knowledge_base_id]}}
            if ObjectId.is_valid(knowledge_base_id)
            else {"knowledgeBase": knowledge_base_id}
        )
        cursor = find_fn(kb_query)
        to_list_fn = getattr(cursor, "to_list", None)
        if not callable(to_list_fn):
            return None, {}

        docs_awaitable = to_list_fn(length=5000)
        if not inspect.isawaitable(docs_awaitable):
            return None, {}

        docs = await docs_awaitable
        if not isinstance(docs, list):
            return None, {}

        kb_owner = str(kb_context.get("owner", ""))
        kb_visibility = kb_context.get("visibility", "private")

        allowed_ids: list[str] = []
        indexed_count = 0

        for doc in docs:
            if not isinstance(doc, dict):
                continue
            doc_id = str(doc.get("_id", ""))
            if not doc_id:
                continue

            uploader = str(doc.get("uploadedBy", ""))
            doc_visibility = doc.get("visibility", "private")
            doc_dept = doc.get("department")

            if user_role == "admin":
                can_read = True
            elif user_id and (uploader == user_id or kb_owner == user_id):
                can_read = True
            elif doc_visibility == "restricted":
                can_read = False
            elif doc_dept and kb_visibility != "organization" and doc_dept != user_department:
                can_read = False
            else:
                can_read = True

            if not can_read:
                continue

            idx_status = doc.get("indexingStatus")
            if idx_status == "indexed":
                indexed_count += 1
                allowed_ids.append(doc_id)
            elif idx_status not in ("pending", "processing", "failed"):
                # Allow records created before indexingStatus tracking
                allowed_ids.append(doc_id)

        stats = {
            "total_documents": len(docs),
            "indexed_documents": indexed_count,
            "no_indexed_documents": len(allowed_ids) == 0,
        }
        return allowed_ids, stats

    def _get_model_name(self) -> str:
        raw = getattr(self.generation_service, "model_name", None)
        if isinstance(raw, str) and raw:
            return raw
        return getattr(settings, "GEMINI_GENERATION_MODEL", "gemini-2.5-flash")

    async def execute_query(
        self,
        request: RagQueryRequest,
        db: Any = None,
        user_id: Optional[str] = None,
        user_role: str = "user",
        user_department: Optional[str] = None,
        organization_id: Optional[str] = None,
    ) -> RagQueryResponse:
        """
        Executes the end-to-end RAG pipeline:
        1. Validate request
        2. Verify user access to the KB and determine authorized indexed documents
        3. Generate query embedding
        4. Search Qdrant with mandatory access filters
        5. Retrieve relevant chunks
        6. Apply similarity threshold and top-k limits
        7. Construct context from evidence (or return insufficient-evidence)
        8. Send to configured Gemini generation model
        9. Return answer, citations, and metadata
        """
        # 1. Validate request
        clean_question = request.question.strip()
        if not clean_question:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Question cannot be empty or whitespace only",
            )

        clean_kb_id = request.knowledgeBaseId.strip()
        if not clean_kb_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="knowledgeBaseId cannot be empty",
            )

        # 2. Verify access to Knowledge Base & resolve readable documents
        kb_context = await self.verify_kb_access(
            knowledge_base_id=clean_kb_id,
            db=db,
            user_id=user_id,
            user_role=user_role,
            user_department=user_department,
            organization_id=organization_id,
        )
        verified_org_id = kb_context.get("organization_id")

        allowed_doc_ids, doc_stats = await self.get_authorized_document_ids(
            knowledge_base_id=clean_kb_id,
            kb_context=kb_context,
            db=db,
            user_id=user_id,
            user_role=user_role,
            user_department=user_department,
        )

        top_k = request.top_k or getattr(settings, "RAG_TOP_K", 5)
        similarity_threshold = (
            request.similarity_threshold
            if request.similarity_threshold is not None
            else getattr(settings, "RAG_SIMILARITY_THRESHOLD", 0.65)
        )

        # 2b. Phase 4 Query Understanding & Rewriting (non-answering, preserves original question)
        use_qu = (
            request.enable_query_understanding
            if request.enable_query_understanding is not None
            else getattr(settings, "QUERY_UNDERSTANDING_ENABLED", True)
        )
        qu_result: Optional[QueryUnderstandingResult] = None
        retrieval_queries: list[str] = [clean_question]
        if use_qu:
            qu_result = await self.query_understanding.process_query(
                QueryUnderstandingRequest(
                    question=clean_question,
                    conversation_history=request.conversation_history,
                    conversationId=request.conversationId,
                    knowledgeBaseId=clean_kb_id,
                    knowledge_base_name=kb_context.get("title") or None,
                ),
                db=db,
                user_id=user_id,
                user_role=user_role,
                fallback_on_error=True,
            )
            if qu_result.retrieval_queries:
                retrieval_queries = qu_result.retrieval_queries
        qu_summary = self._build_qu_summary(qu_result)

        # If DB verified 0 readable indexed documents, skip Qdrant and Gemini calls cleanly
        if allowed_doc_ids is not None and len(allowed_doc_ids) == 0:
            logger.info(
                "KB %s has 0 authorized indexed documents for user %s. Returning insufficient evidence response.",
                clean_kb_id,
                user_id,
            )
            return RagQueryResponse(
                answer=INSUFFICIENT_EVIDENCE_RESPONSE,
                citations=[],
                metadata=RagRetrievalMetadata(
                    knowledge_base_id=clean_kb_id,
                    chunks_retrieved=0,
                    chunks_used=0,
                    model=self._get_model_name(),
                    similarity_threshold=similarity_threshold,
                    insufficient_evidence=True,
                    no_indexed_documents=True,
                    indexed_documents=doc_stats.get("indexed_documents", 0),
                    query_understanding=qu_summary,
                ),
                conversationId=request.conversationId,
            )

        # 3. Generate Query Embedding(s)
        try:
            embed_resp = self.embedding_service.embed_texts(
                texts=retrieval_queries,
                task_type="RETRIEVAL_QUERY",
            )
            if not embed_resp.embeddings:
                raise EmbeddingValidationError("Embedding service returned empty query vector")
            query_vectors = list(embed_resp.embeddings)
        except EmbeddingRateLimitError as e:
            safe_err = sanitize_error_message(e)
            logger.error("Embedding rate limit exceeded: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Embedding API rate limit exceeded: {safe_err}",
            ) from e
        except EmbeddingValidationError as e:
            safe_err = sanitize_error_message(e)
            logger.error("Invalid query embedding response: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Invalid query embedding response: {safe_err}",
            ) from e
        except EmbeddingProviderError as e:
            safe_err = sanitize_error_message(e)
            logger.error("Embedding provider failure: %s", safe_err)
            http_status = (
                status.HTTP_504_GATEWAY_TIMEOUT
                if "timeout" in safe_err.lower() or "timed out" in safe_err.lower() or "deadline" in safe_err.lower()
                else status.HTTP_502_BAD_GATEWAY
            )
            raise HTTPException(
                status_code=http_status,
                detail=f"Failed to generate query embedding: {safe_err}",
            ) from e
        except Exception as e:
            safe_err = sanitize_error_message(e)
            logger.error("Failed to generate query embedding: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate query embedding: {safe_err}",
            ) from e

        # 4 & 5. Search Qdrant with Mandatory Access-Control Filters (fusing multi-query hits)
        merged_hits: dict[str, VectorSearchResult] = {}
        try:
            for q_vec in query_vectors:
                search_kwargs: dict[str, Any] = {
                    "query_vector": q_vec,
                    "knowledge_base_ids": [clean_kb_id],
                    "organization_id": verified_org_id,
                    "limit": top_k * 2,  # Over-fetch slightly before threshold filtering
                }
                if allowed_doc_ids is not None:
                    search_kwargs["document_ids"] = allowed_doc_ids

                hits: list[VectorSearchResult] = self.vector_store.search(**search_kwargs)
                for hit in hits:
                    hit_key = hit.point_id or f"{hit.document_id}:{hit.chunk_id or hit.chunk_index}"
                    existing = merged_hits.get(hit_key)
                    if existing is None or hit.score > existing.score:
                        merged_hits[hit_key] = hit
            search_hits = sorted(merged_hits.values(), key=lambda h: h.score, reverse=True)
        except VectorStoreConnectionError as e:
            safe_err = sanitize_error_message(e)
            logger.error("Vector store unavailable during search: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Vector database unavailable: {safe_err}",
            ) from e
        except (InvalidVectorError, IncompatibleVectorDimensionError) as e:
            safe_err = sanitize_error_message(e)
            logger.error("Vector dimension mismatch during search: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Vector dimension incompatibility: {safe_err}",
            ) from e
        except Exception as e:
            safe_err = sanitize_error_message(e)
            logger.error("Vector search failed: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Vector search failed: {safe_err}",
            ) from e

        # Post-filter safeguard: ensure only authorized document IDs survive
        if allowed_doc_ids is not None:
            allowed_set = set(allowed_doc_ids)
            search_hits = [hit for hit in search_hits if hit.document_id in allowed_set]

        # 6. Apply Similarity Threshold & Top-K Limit
        surviving_chunks = [
            hit for hit in search_hits if hit.score >= similarity_threshold
        ][:top_k]

        chunks_retrieved = len(search_hits)
        chunks_used = len(surviving_chunks)

        # 7. Empty Retrieval / Below-Threshold Insufficient Evidence Check
        if chunks_used == 0:
            logger.info(
                "No chunks passed similarity threshold %.2f for KB %s (retrieved: %d). Returning insufficient evidence response.",
                similarity_threshold,
                clean_kb_id,
                chunks_retrieved,
            )
            return RagQueryResponse(
                answer=INSUFFICIENT_EVIDENCE_RESPONSE,
                citations=[],
                metadata=RagRetrievalMetadata(
                    knowledge_base_id=clean_kb_id,
                    chunks_retrieved=chunks_retrieved,
                    chunks_used=0,
                    model=self._get_model_name(),
                    similarity_threshold=similarity_threshold,
                    insufficient_evidence=True,
                    no_indexed_documents=doc_stats.get("no_indexed_documents", False),
                    indexed_documents=doc_stats.get("indexed_documents"),
                    query_understanding=qu_summary,
                ),
                conversationId=request.conversationId,
            )

        # 8. Send Question & Untrusted Context to Gemini Generation Model
        evidence_items = [
            {
                "document_id": c.document_id,
                "filename": c.filename,
                "chunk_id": c.chunk_id,
                "page_number": c.page_number,
                "text": c.text,
            }
            for c in surviving_chunks
        ]

        try:
            generated_answer = self.generation_service.generate_rag_answer(
                question=clean_question,
                evidence_items=evidence_items,
            )
        except GenerationRateLimitError as e:
            safe_err = sanitize_error_message(e)
            logger.error("Generation rate limit exceeded: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"LLM API rate limit exceeded: {safe_err}",
            ) from e
        except GenerationTimeoutError as e:
            safe_err = sanitize_error_message(e)
            logger.error("Generation timed out: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"LLM generation timed out: {safe_err}",
            ) from e
        except Exception as e:
            safe_err = sanitize_error_message(e)
            logger.error("Generation failed: %s", safe_err)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LLM generation failed: {safe_err}",
            ) from e

        # 8b. Anti-Fabrication Citation Verification & Cleanup
        evidence_marker_pattern = re.compile(r"\[Evidence\s+(\d+)\]", re.IGNORECASE)
        raw_markers = [int(m.group(1)) for m in evidence_marker_pattern.finditer(generated_answer)]
        max_evidence_idx = len(surviving_chunks)

        invalid_markers = [n for n in raw_markers if n < 1 or n > max_evidence_idx]
        valid_markers = [n for n in raw_markers if 1 <= n <= max_evidence_idx]

        # Reject purely fabricated citation outputs (all markers out of bounds)
        if raw_markers and not valid_markers:
            logger.warning(
                "LLM output contained only invalid/fabricated citation references %s (valid: 1..%d). Rejecting.",
                invalid_markers,
                max_evidence_idx,
            )
            return RagQueryResponse(
                answer=INSUFFICIENT_EVIDENCE_RESPONSE,
                citations=[],
                metadata=RagRetrievalMetadata(
                    knowledge_base_id=clean_kb_id,
                    chunks_retrieved=chunks_retrieved,
                    chunks_used=chunks_used,
                    model=self._get_model_name(),
                    similarity_threshold=similarity_threshold,
                    insufficient_evidence=True,
                    no_indexed_documents=False,
                    indexed_documents=doc_stats.get("indexed_documents"),
                    query_understanding=qu_summary,
                ),
                conversationId=request.conversationId,
            )

        if invalid_markers:
            logger.warning(
                "Stripped invalid/fabricated citation reference(s) %s from LLM output (valid: 1..%d)",
                invalid_markers,
                max_evidence_idx,
            )
            generated_answer = evidence_marker_pattern.sub(
                lambda m: m.group(0) if 1 <= int(m.group(1)) <= max_evidence_idx else "",
                generated_answer,
            )
            generated_answer = re.sub(r" {2,}", " ", generated_answer).strip()

        # Check if the LLM output explicitly signaled lack of evidence
        is_insufficient = False
        lower_ans = generated_answer.lower()
        if (
            "insufficient evidence" in lower_ans
            or "do not have sufficient" in lower_ans
            or "cannot be answered based" in lower_ans
            or "not mentioned in the provided" in lower_ans
        ):
            is_insufficient = True

        # 9. Return Answer, Grounded Citations, and Retrieval Metadata
        if is_insufficient:
            citations = []
        else:
            if valid_markers:
                seen_idx: set[int] = set()
                cited_chunks: list[VectorSearchResult] = []
                for idx in valid_markers:
                    if idx not in seen_idx:
                        seen_idx.add(idx)
                        cited_chunks.append(surviving_chunks[idx - 1])
            else:
                cited_chunks = surviving_chunks

            excerpt_query = clean_question
            if qu_result and qu_result.analysis.keywords:
                excerpt_query = f"{clean_question} {' '.join(qu_result.analysis.keywords)}"

            citations = [
                Citation(
                    document_id=c.document_id,
                    filename=c.filename,
                    chunk_id=c.chunk_id,
                    page_number=c.page_number,
                    excerpt=extract_relevant_excerpt(c.text, excerpt_query),
                    score=round(c.score, 4),
                )
                for c in cited_chunks
            ]

        return RagQueryResponse(
            answer=generated_answer,
            citations=citations,
            metadata=RagRetrievalMetadata(
                knowledge_base_id=clean_kb_id,
                chunks_retrieved=chunks_retrieved,
                chunks_used=chunks_used,
                model=self._get_model_name(),
                similarity_threshold=similarity_threshold,
                insufficient_evidence=is_insufficient,
                no_indexed_documents=False,
                indexed_documents=doc_stats.get("indexed_documents"),
                query_understanding=qu_summary,
            ),
            conversationId=request.conversationId,
        )


# Global instance
rag_query_service = RagQueryService()
