from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.api.dependencies import get_api_key, get_verified_user_context
from app.core.security import VerifiedUserContext
from app.models.document import (
    BatchIndexDocumentRequest,
    BatchIndexDocumentResponse,
    ChunkDocumentRequest,
    ChunkDocumentResponse,
    DeleteDocumentResponse,
    DeleteKnowledgeBaseResponse,
    IndexDocumentRequest,
    IndexDocumentResponse,
)
from app.models.chat import ChatRequest, ChatResponse, SourceSnippet
from app.models.rag import RagQueryRequest
from app.services.chunking import chunking_service
from app.services.embedding_service import (
    EmbeddingProviderError,
    EmbeddingRateLimitError,
    EmbeddingValidationError,
    sanitize_error_message,
)
from app.services.rag import DocumentNotFoundError, rag_service
from app.services.rag_query_service import rag_query_service
from app.services.vector_store import (
    IncompatibleVectorDimensionError,
    InvalidVectorError,
    VectorStoreConnectionError,
    VectorStoreError,
)

router = APIRouter(dependencies=[Depends(get_api_key)])


def _map_service_exception(exc: Exception, default_prefix: str = "Operation failed") -> HTTPException:
    safe = sanitize_error_message(exc)
    if isinstance(exc, HTTPException):
        return exc
    if isinstance(exc, DocumentNotFoundError):
        return HTTPException(status_code=404, detail=safe)
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=safe)
    if isinstance(exc, EmbeddingRateLimitError):
        return HTTPException(status_code=429, detail=safe)
    if isinstance(exc, (EmbeddingValidationError, InvalidVectorError)):
        return HTTPException(status_code=422, detail=safe)
    if isinstance(exc, IncompatibleVectorDimensionError):
        return HTTPException(status_code=409, detail=safe)
    if isinstance(exc, VectorStoreConnectionError):
        return HTTPException(status_code=503, detail=safe)
    if isinstance(exc, (EmbeddingProviderError, VectorStoreError)):
        return HTTPException(status_code=502, detail=safe)
    return HTTPException(status_code=500, detail=f"{default_prefix}: {safe}")


@router.post("/documents/chunk", response_model=ChunkDocumentResponse)
async def chunk_document(request: ChunkDocumentRequest, raw_req: Request):
    """
    Chunk extracted document text and return structured chunks with metadata.
    If text is not provided, attempts to retrieve the processed document directly from MongoDB.
    """
    if request.text is not None and request.text != "":
        return chunking_service.chunk_document(request)

    db = getattr(raw_req.app, "mongodb", None)
    if not db:
        raise HTTPException(
            status_code=400,
            detail="Document text was not provided in request, and MongoDB connection is not available to load extractedText."
        )

    try:
        return await chunking_service.chunk_document_from_db(
            db=db,
            document_id=request.document_id,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
            tokenizer_strategy=request.tokenizer_strategy,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=sanitize_error_message(e))
    except Exception as e:
        raise _map_service_exception(e, "Failed to chunk document from database")


@router.post("/documents/{document_id}/chunk", response_model=ChunkDocumentResponse)
async def chunk_document_by_id(
    document_id: str,
    raw_req: Request,
    chunk_size: Optional[int] = Query(None, description="Optional override for chunk size in tokens"),
    chunk_overlap: Optional[int] = Query(None, description="Optional override for chunk overlap in tokens"),
    tokenizer_strategy: Optional[str] = Query(None, description="Tokenizer strategy (tiktoken or words)"),
):
    """
    Consume existing processed document directly from MongoDB by document ID,
    chunk its extracted text, and return structured chunks.
    """
    db = getattr(raw_req.app, "mongodb", None)
    if not db:
        raise HTTPException(status_code=503, detail="MongoDB connection is not available to retrieve processed document.")

    try:
        return await chunking_service.chunk_document_from_db(
            db=db,
            document_id=document_id,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            tokenizer_strategy=tokenizer_strategy,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=sanitize_error_message(e))
    except Exception as e:
        raise _map_service_exception(e, "Failed to chunk document")


@router.post("/documents/index", response_model=IndexDocumentResponse)
async def index_document(request: IndexDocumentRequest, raw_req: Request):
    """
    End-to-end vector ingestion for a single document.
    Chunks text, generates embeddings, upserts into Qdrant, and updates indexingStatus.
    """
    db = getattr(raw_req.app, "mongodb", None)
    try:
        return await rag_service.index_document(request, db=db)
    except Exception as e:
        raise _map_service_exception(e, "Failed to index document")


@router.post("/documents/batch-index", response_model=BatchIndexDocumentResponse)
async def batch_index_documents(request: BatchIndexDocumentRequest, raw_req: Request):
    """
    Batch ingestion for multiple documents.
    Handles partial failures safely, indexing what succeeds and detailing errors.
    """
    db = getattr(raw_req.app, "mongodb", None)
    try:
        return await rag_service.batch_index_documents(request, db=db)
    except Exception as e:
        raise _map_service_exception(e, "Batch indexing failed")


@router.post("/documents/{document_id}/index", response_model=IndexDocumentResponse)
async def index_document_by_id(document_id: str, raw_req: Request):
    """
    Trigger indexing of an existing processed document directly from MongoDB by ID.
    Reuses extracted text without re-extracting PDF or DOCX files.
    """
    db = getattr(raw_req.app, "mongodb", None)
    if not db:
        raise HTTPException(status_code=503, detail="MongoDB connection is not available to retrieve processed document.")

    req = IndexDocumentRequest(document_id=document_id, knowledge_base_id="")
    try:
        return await rag_service.index_document(req, db=db)
    except Exception as e:
        raise _map_service_exception(e, "Failed to index document")


@router.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
def delete_document(document_id: str):
    """Delete all indexed vector points for a document."""
    try:
        return rag_service.delete_document(document_id)
    except Exception as e:
        raise _map_service_exception(e, "Failed to delete document vectors")


@router.delete("/knowledge-bases/{knowledge_base_id}", response_model=DeleteKnowledgeBaseResponse)
def delete_knowledge_base(knowledge_base_id: str):
    """Delete all indexed vector points for an entire knowledge base."""
    try:
        return rag_service.delete_knowledge_base(knowledge_base_id)
    except Exception as e:
        raise _map_service_exception(e, "Failed to delete knowledge base vectors")


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    raw_req: Request,
    user_context: VerifiedUserContext = Depends(get_verified_user_context),
):
    """
    Protected legacy chat adapter enforcing verified user context and delegating
    strictly through the RBAC-protected RAG pipeline.
    """
    if not request.knowledge_base_ids:
        raise HTTPException(status_code=400, detail="knowledge_base_ids cannot be empty")

    db = getattr(raw_req.app, "mongodb", None)
    rag_res = await rag_query_service.execute_query(
        request=RagQueryRequest(
            question=request.query,
            knowledgeBaseId=request.knowledge_base_ids[0],
        ),
        db=db,
        user_id=user_context.user_id,
        user_role=user_context.role,
        user_department=user_context.department,
        organization_id=user_context.organization_id,
    )
    return ChatResponse(
        answer=rag_res.answer,
        sources=[
            SourceSnippet(
                document_id=c.document_id,
                title=c.filename or c.document_id,
                score=c.score,
                text_snippet=c.excerpt,
            )
            for c in rag_res.citations
        ],
    )
