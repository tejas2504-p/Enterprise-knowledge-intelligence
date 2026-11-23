from typing import Any, Optional
from pydantic import BaseModel, Field
from app.models.document import ChunkItem


class EmbeddingModelConfig(BaseModel):
    """Configuration tracking for model and dimension to prevent incompatible vector mixing."""
    provider: str = "gemini"
    model_name: str = "text-embedding-004"
    dimension: int = 768
    task_type: Optional[str] = "RETRIEVAL_DOCUMENT"
    batch_size: int = 64
    timeout: float = 30.0


class EmbeddedChunk(BaseModel):
    """A document chunk enriched with its vector embedding and configuration metadata."""
    chunk_id: str
    chunk_index: int
    text: str = ""
    embedding: list[float]
    dimension: int
    model: str
    content_hash: str
    token_count: int = 0
    char_count: int = 0
    start_char: int = 0
    end_char: int = 0
    page_number: Optional[int] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ChunkEmbeddingRequest(BaseModel):
    """Request schema for generating embeddings from document chunks."""
    document_id: str
    knowledge_base_id: Optional[str] = None
    chunks: list[ChunkItem]
    model: Optional[str] = None
    dimension: Optional[int] = None
    task_type: Optional[str] = None
    title: Optional[str] = None


class ChunkEmbeddingResponse(BaseModel):
    """Response schema containing generated chunk embeddings and execution metrics."""
    status: str = "success"
    document_id: str
    model: str
    dimension: int
    total_chunks: int
    cached_chunks: int
    generated_chunks: int
    embeddings: list[EmbeddedChunk]


class TextEmbeddingRequest(BaseModel):
    """Request schema for generating embeddings from raw text strings (e.g. queries)."""
    texts: list[str]
    model: Optional[str] = None
    dimension: Optional[int] = None
    task_type: Optional[str] = None
    title: Optional[str] = None


class TextEmbeddingResponse(BaseModel):
    """Response schema containing embeddings for raw text strings."""
    status: str = "success"
    model: str
    dimension: int
    count: int
    embeddings: list[list[float]]
