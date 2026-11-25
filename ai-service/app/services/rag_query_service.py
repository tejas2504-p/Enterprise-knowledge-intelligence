import inspect
import logging
import re
from typing import Any, Optional
from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.models.rag import Citation, RagQueryRequest, RagQueryResponse, RagRetrievalMetadata
from app.prompts.rag_prompts import INSUFFICIENT_EVIDENCE_RESPONSE
from app.services.embedding_service import gemini_embedding_service
from app.services.generation_service import gemini_generation_service
from app.services.vector_store import VectorSearchResult, vector_store_service

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
    ):
        self.vector_store = vector_store or vector_store_service
        self.embedding_service = embedding_service or gemini_embedding_service
        self.generation_service = generation_service or gemini_generation_service

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
                ),
                conversationId=request.conversationId,
            )

        # 3. Generate Query Embedding
        try:
            embed_resp = self.embedding_service.embed_texts(
                texts=[clean_question],
                task_type="RETRIEVAL_QUERY",
            )
            if not embed_resp.embeddings:
                raise ValueError("Embedding service returned empty query vector")
            query_vector = embed_resp.embeddings[0]
        except Exception as e:
            logger.error("Failed to generate query embedding: %s", str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate query embedding: {str(e)}",
            ) from e

        # 4 & 5. Search Qdrant with Mandatory Access-Control Filters
        search_kwargs: dict[str, Any] = {
            "query_vector": query_vector,
            "knowledge_base_ids": [clean_kb_id],
            "organization_id": verified_org_id,
            "limit": top_k * 2,  # Over-fetch slightly before threshold filtering
        }
        if allowed_doc_ids is not None:
            search_kwargs["document_ids"] = allowed_doc_ids

        try:
            search_hits: list[VectorSearchResult] = self.vector_store.search(**search_kwargs)
        except Exception as e:
            logger.error("Vector search failed: %s", str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Vector search failed: {str(e)}",
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
        except Exception as e:
            logger.error("Generation failed: %s", str(e))
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"LLM generation failed: {str(e)}",
            ) from e

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

        # 9. Return Answer, Citations, and Retrieval Metadata
        citations = [
            Citation(
                document_id=c.document_id,
                filename=c.filename,
                chunk_id=c.chunk_id,
                page_number=c.page_number,
                excerpt=extract_relevant_excerpt(c.text, clean_question),
                score=round(c.score, 4),
            )
            for c in surviving_chunks
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
            ),
            conversationId=request.conversationId,
        )


# Global instance
rag_query_service = RagQueryService()
