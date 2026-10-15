from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from app.api.dependencies import get_api_key
from app.models.document import (
    ChunkDocumentRequest,
    ChunkDocumentResponse,
    IndexDocumentRequest,
    IndexDocumentResponse,
    DeleteDocumentResponse,
    DeleteKnowledgeBaseResponse,
)
from app.models.chat import ChatRequest, ChatResponse
from app.services.chunking import chunking_service
from app.services.rag import rag_service

router = APIRouter(dependencies=[Depends(get_api_key)])


@router.post("/documents/chunk", response_model=ChunkDocumentResponse)
async def chunk_document(request: ChunkDocumentRequest, raw_req: Request):
    """
    Chunk extracted document text and return structured chunks with metadata.
    If text is not provided, attempts to retrieve the processed document directly from MongoDB.
    """
    if request.text is not None and request.text != "":
        return chunking_service.chunk_document(request)

    # If text is not provided, consume processed document from MongoDB
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
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to chunk document from database: {str(e)}")


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
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to chunk document: {str(e)}")


@router.post("/documents/index", response_model=IndexDocumentResponse)
def index_document(request: IndexDocumentRequest):
    return rag_service.index_document(request)


@router.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
def delete_document(document_id: str):
    return rag_service.delete_document(document_id)


@router.delete("/knowledge-bases/{knowledge_base_id}", response_model=DeleteKnowledgeBaseResponse)
def delete_knowledge_base(knowledge_base_id: str):
    return rag_service.delete_knowledge_base(knowledge_base_id)


@router.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest):
    return rag_service.chat(request)

