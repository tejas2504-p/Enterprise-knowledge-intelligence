import logging
from datetime import datetime, timezone
from typing import Any, Optional
from bson import ObjectId

from app.models.chat import ChatRequest, ChatResponse, SourceSnippet
from app.models.document import (
    BatchIndexDocumentRequest,
    BatchIndexDocumentResponse,
    DeleteDocumentResponse,
    DeleteKnowledgeBaseResponse,
    DocumentIndexResult,
    IndexDocumentRequest,
    IndexDocumentResponse,
)
from app.services.chunking import chunking_service
from app.services.embedding_service import gemini_embedding_service, sanitize_error_message
from app.services.embeddings import get_embedding
from app.services.llm import generate_answer
from app.services.vector_store import vector_store_service

logger = logging.getLogger(__name__)


class RagService:
    """
    RAG Ingestion and Retrieval Pipeline Service.
    Connects processed documents from MongoDB, chunks text, generates embeddings,
    and idempotently manages vectors in Qdrant with tenant and access-control boundaries.
    """

    async def _fetch_document_from_db(self, db: Any, document_id: str) -> Optional[dict[str, Any]]:
        """Fetch processed document and associated knowledge base metadata from MongoDB."""
        if db is None:
            return None
        query = {"_id": ObjectId(document_id)} if ObjectId.is_valid(document_id) else {"_id": document_id}
        doc = await db["documents"].find_one(query)
        if not doc:
            return None

        # Lookup KnowledgeBase if department or organization is missing
        kb_id = str(doc.get("knowledgeBase", ""))
        if kb_id and (not doc.get("department") or not doc.get("organization")):
            kb_query = {"_id": ObjectId(kb_id)} if ObjectId.is_valid(kb_id) else {"_id": kb_id}
            kb = await db["knowledgebases"].find_one(kb_query)
            if kb:
                if not doc.get("department"):
                    doc["department"] = kb.get("department")
                if not doc.get("organization"):
                    doc["organization"] = kb.get("organization")

        return doc

    async def _update_db_indexing_status(
        self,
        db: Any,
        document_id: str,
        status: str,
        chunks_count: int = 0,
        error: Optional[str] = None,
    ) -> None:
        """Update indexing status, timestamp, and safe error information in MongoDB."""
        if db is None:
            return
        query = {"_id": ObjectId(document_id)} if ObjectId.is_valid(document_id) else {"_id": document_id}
        update_data: dict[str, Any] = {
            "indexingStatus": status,
        }
        if status == "indexed":
            update_data["indexedAt"] = datetime.now(timezone.utc)
            update_data["chunksCount"] = chunks_count
            update_data["indexingError"] = None
        elif status == "failed":
            update_data["indexingError"] = error
        elif status == "processing":
            update_data["indexingError"] = None

        try:
            await db["documents"].update_one(query, {"$set": update_data})
        except Exception as e:
            logger.warning("Failed to update indexingStatus in MongoDB for %s: %s", document_id, sanitize_error_message(e))

    async def index_document(self, request: IndexDocumentRequest, db: Any = None) -> IndexDocumentResponse:
        """
        End-to-End Ingestion Pipeline for a Single Document:
        1. Fetch extracted text & metadata (from request or MongoDB without re-extracting file)
        2. Chunk text using hierarchical boundary cascade and PageTracker
        3. Generate embeddings with caching for unchanged chunks and bounded retries
        4. Upsert vectors into Qdrant using deterministic UUIDv5 point IDs (purging stale chunks)
        5. Update indexing status in MongoDB (if db is connected)
        """
        document_id = request.document_id
        text = request.text
        kb_id = request.knowledge_base_id
        org_id = request.organization_id
        department = request.department
        filename = request.filename
        title = request.title or ""
        page_count = request.page_count
        metadata = request.metadata or {}

        # 1. Fetch extracted text and metadata from DB if text was not provided
        if not text and db is not None:
            doc = await self._fetch_document_from_db(db, document_id)
            if doc:
                text = doc.get("extractedText", "")
                kb_id = kb_id or str(doc.get("knowledgeBase", ""))
                org_id = org_id or doc.get("organization")
                department = department or doc.get("department")
                filename = filename or doc.get("originalFileName")
                title = title or doc.get("title", "")
                page_count = page_count or doc.get("pageCount")
                metadata = {**doc.get("metadata", {}), **metadata}

        if not text or not text.strip():
            # Cleanly handle empty document text
            now_iso = datetime.now(timezone.utc).isoformat()
            await self._update_db_indexing_status(db, document_id, status="indexed", chunks_count=0)
            return IndexDocumentResponse(
                status="success",
                document_id=document_id,
                chunks_indexed=0,
                indexed_at=now_iso,
            )

        # Mark indexingStatus as processing in MongoDB
        await self._update_db_indexing_status(db, document_id, status="processing")

        try:
            # 2. Chunk text
            chunks = chunking_service.default_chunker.chunk_text(
                text=text,
                document_id=document_id,
                knowledge_base_id=kb_id,
                filename=filename,
                department=department,
                organization_id=org_id,
                page_count=page_count,
                custom_metadata=metadata,
            )

            if not chunks:
                now_iso = datetime.now(timezone.utc).isoformat()
                await self._update_db_indexing_status(db, document_id, status="indexed", chunks_count=0)
                return IndexDocumentResponse(
                    status="success",
                    document_id=document_id,
                    chunks_indexed=0,
                    indexed_at=now_iso,
                )

            # 3. Generate embeddings (automatically caches unchanged chunks)
            embed_resp = gemini_embedding_service.embed_chunks(
                chunks=chunks,
                document_id=document_id,
                knowledge_base_id=kb_id,
                title=title,
            )

            # 4. Upsert vectors into Qdrant (purging stale chunks and using stable UUIDv5 IDs)
            chunks_indexed = vector_store_service.reindex_document(
                document_id=document_id,
                chunks=embed_resp.embeddings,
                knowledge_base_id=kb_id,
                organization_id=org_id,
                department=department,
                filename=filename,
                title=title,
            )

            # 5. Update indexingStatus in MongoDB to indexed
            now_iso = datetime.now(timezone.utc).isoformat()
            await self._update_db_indexing_status(db, document_id, status="indexed", chunks_count=chunks_indexed)

            return IndexDocumentResponse(
                status="success",
                document_id=document_id,
                chunks_indexed=chunks_indexed,
                indexed_at=now_iso,
            )

        except Exception as exc:
            safe_err = sanitize_error_message(exc)
            logger.error("Ingestion failed for document %s: %s", document_id, safe_err)
            await self._update_db_indexing_status(db, document_id, status="failed", error=safe_err)
            raise

    async def batch_index_documents(
        self,
        request: BatchIndexDocumentRequest,
        db: Any = None,
    ) -> BatchIndexDocumentResponse:
        """
        Batch Ingestion Pipeline for Multiple Documents:
        Supports lists of IndexDocumentRequest or document_ids.
        Handles partial failures gracefully so one document's error does not abort the batch.
        """
        doc_requests: list[IndexDocumentRequest] = list(request.documents)

        # If document_ids provided, build requests from MongoDB records
        if request.document_ids and db is not None:
            for doc_id in request.document_ids:
                doc = await self._fetch_document_from_db(db, doc_id)
                if doc:
                    doc_requests.append(
                        IndexDocumentRequest(
                            document_id=str(doc.get("_id", doc_id)),
                            knowledge_base_id=str(doc.get("knowledgeBase", "")),
                            title=doc.get("title", ""),
                            text=doc.get("extractedText", ""),
                            filename=doc.get("originalFileName"),
                            department=doc.get("department"),
                            organization_id=doc.get("organization"),
                            page_count=doc.get("pageCount"),
                            metadata=doc.get("metadata", {}),
                        )
                    )

        total = len(doc_requests)
        successful = 0
        failed = 0
        results: list[DocumentIndexResult] = []

        for doc_req in doc_requests:
            try:
                resp = await self.index_document(doc_req, db=db)
                successful += 1
                results.append(
                    DocumentIndexResult(
                        document_id=doc_req.document_id,
                        status="indexed",
                        chunks_indexed=resp.chunks_indexed,
                    )
                )
            except Exception as e:
                failed += 1
                safe_err = sanitize_error_message(e)
                results.append(
                    DocumentIndexResult(
                        document_id=doc_req.document_id,
                        status="failed",
                        chunks_indexed=0,
                        error=safe_err,
                    )
                )

        if failed == 0:
            overall_status = "success"
        elif successful > 0:
            overall_status = "partial_success"
        else:
            overall_status = "failed"

        return BatchIndexDocumentResponse(
            status=overall_status,
            total_documents=total,
            successful_documents=successful,
            failed_documents=failed,
            results=results,
        )

    def delete_document(self, document_id: str) -> DeleteDocumentResponse:
        """Remove indexed vector points from Qdrant when a document is deleted."""
        vector_store_service.delete_by_document(document_id)
        return DeleteDocumentResponse(status="success", deleted_chunks=0)

    def delete_knowledge_base(self, knowledge_base_id: str) -> DeleteKnowledgeBaseResponse:
        """Remove all indexed vector points from Qdrant for a knowledge base."""
        vector_store_service.delete_by_knowledge_base(knowledge_base_id)
        return DeleteKnowledgeBaseResponse(status="success", deleted_chunks=0)

    def chat(self, request: ChatRequest) -> ChatResponse:
        """Context retrieval and LLM response generation."""
        query_vector = get_embedding(request.query)

        search_results = vector_store_service.search(
            query_vector=query_vector,
            knowledge_base_ids=request.knowledge_base_ids,
            organization_id=getattr(request, "organization_id", None),
            department=getattr(request, "department", None),
            limit=5,
        )

        sources = []
        context_snippets = []
        for hit in search_results:
            sources.append(
                SourceSnippet(
                    document_id=hit.document_id,
                    title=hit.title or "",
                    score=hit.score,
                    text_snippet=hit.text,
                )
            )
            context_snippets.append(hit.text)

        answer = generate_answer(request.query, context_snippets, request.chat_history)
        return ChatResponse(answer=answer, sources=sources)


rag_service = RagService()
