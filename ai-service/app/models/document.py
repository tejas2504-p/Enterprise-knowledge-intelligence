from pydantic import BaseModel

class IndexDocumentRequest(BaseModel):
    document_id: str
    knowledge_base_id: str
    title: str
    text: str

class IndexDocumentResponse(BaseModel):
    status: str
    chunks_indexed: int

class DeleteDocumentResponse(BaseModel):
    status: str
    deleted_chunks: int

class DeleteKnowledgeBaseResponse(BaseModel):
    status: str
    deleted_chunks: int
