from typing import Any
from pydantic import BaseModel, Field

class ChunkMetadata(BaseModel):
    document_id: str
    knowledge_base_id: str
    organization_id: str | None = None
    department: str | None = None
    filename: str | None = None
    chunk_index: int
    total_chunks: int
    page_number: int | None = None
    start_page: int | None = None
    end_page: int | None = None
    start_char: int
    end_char: int
    token_count: int
    char_count: int
    custom_metadata: dict[str, Any] = Field(default_factory=dict)

class ChunkItem(BaseModel):
    chunk_id: str
    text: str
    chunk_index: int
    token_count: int
    char_count: int
    start_char: int
    end_char: int
    page_number: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

class ChunkDocumentRequest(BaseModel):
    document_id: str
    knowledge_base_id: str
    text: str | None = None
    title: str | None = None
    filename: str | None = None
    department: str | None = None
    organization_id: str | None = None
    page_count: int | None = None
    chunk_size: int | None = None
    chunk_overlap: int | None = None
    tokenizer_strategy: str | None = None
    metadata: dict[str, Any] | None = None

class ChunkDocumentResponse(BaseModel):
    status: str
    document_id: str
    knowledge_base_id: str
    total_chunks: int
    chunks: list[ChunkItem]

class IndexDocumentRequest(BaseModel):
    document_id: str
    knowledge_base_id: str
    title: str = ""
    text: str | None = None
    filename: str | None = None
    department: str | None = None
    organization_id: str | None = None
    page_count: int | None = None
    metadata: dict[str, Any] | None = None

class IndexDocumentResponse(BaseModel):
    status: str
    chunks_indexed: int

class DeleteDocumentResponse(BaseModel):
    status: str
    deleted_chunks: int

class DeleteKnowledgeBaseResponse(BaseModel):
    status: str
    deleted_chunks: int

