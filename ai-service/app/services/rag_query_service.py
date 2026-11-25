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
        organization_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """
        Verify the user's access to the requested knowledge base through MongoDB.
        Enforces tenant isolation, visibility permissions, and status checks.
        """
        if db is None:
            # If DB is not connected (e.g., testing mode without MongoDB), pass through
            return {
                "knowledge_base_id": knowledge_base_id,
                "organization_id": organization_id,
                "department": None,
            }

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

        # Private visibility: user must be the owner
        if kb_visibility == "private" and user_id and user_id != kb_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access this private Knowledge Base",
            )

        return {
            "knowledge_base_id": str(kb.get("_id", knowledge_base_id)),
            "organization_id": kb_org or organization_id,
            "department": kb_dept,
            "title": kb.get("name", ""),
        }

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
        organization_id: Optional[str] = None,
    ) -> RagQueryResponse:
        """
        Executes the end-to-end RAG pipeline:
        1. Validate request
        2. Verify user access to the KB
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

        # 2. Verify access to Knowledge Base
        kb_context = await self.verify_kb_access(
            knowledge_base_id=clean_kb_id,
            db=db,
            user_id=user_id,
            organization_id=organization_id,
        )
        verified_org_id = kb_context.get("organization_id")
        verified_dept = kb_context.get("department")

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
        top_k = request.top_k or getattr(settings, "RAG_TOP_K", 5)
        similarity_threshold = (
            request.similarity_threshold
            if request.similarity_threshold is not None
            else getattr(settings, "RAG_SIMILARITY_THRESHOLD", 0.65)
        )

        try:
            search_hits: list[VectorSearchResult] = self.vector_store.search(
                query_vector=query_vector,
                knowledge_base_ids=[clean_kb_id],
                organization_id=verified_org_id,
                department=verified_dept,
                limit=top_k * 2,  # Over-fetch slightly before threshold filtering
            )
        except Exception as e:
            logger.error("Vector search failed: %s", str(e))
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Vector search failed: {str(e)}",
            ) from e

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
                similarity_threshold, clean_kb_id, chunks_retrieved
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
        # Construct non-fabricated citations for all surviving chunks
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
            ),
            conversationId=request.conversationId,
        )


# Global instance
rag_query_service = RagQueryService()
