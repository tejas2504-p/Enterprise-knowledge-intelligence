from fastapi import APIRouter, Depends
from app.api.dependencies import get_api_key
from app.models.document import IndexDocumentRequest, IndexDocumentResponse, DeleteDocumentResponse, DeleteKnowledgeBaseResponse
from app.models.chat import ChatRequest, ChatResponse
from app.services.rag import rag_service

router = APIRouter(dependencies=[Depends(get_api_key)])

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
