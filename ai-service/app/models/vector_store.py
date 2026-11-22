from typing import Any, Optional
from pydantic import BaseModel, Field


class VectorSearchFilter(BaseModel):
    """Filter criteria enforced at the vector database level before retrieval."""
    organization_id: Optional[str] = None
    knowledge_base_ids: Optional[list[str]] = None
    department: Optional[str] = None
    document_id: Optional[str] = None
    custom_filters: Optional[dict[str, Any]] = None


class VectorSearchResult(BaseModel):
    """Structured result returned from vector search retrieval."""
    point_id: str
    score: float
    document_id: str
    knowledge_base_id: str
    text: str
    organization_id: Optional[str] = None
    department: Optional[str] = None
    chunk_id: Optional[str] = None
    chunk_index: Optional[int] = None
    total_chunks: Optional[int] = None
    filename: Optional[str] = None
    title: Optional[str] = None
    page_number: Optional[int] = None
    start_page: Optional[int] = None
    end_page: Optional[int] = None
    start_char: Optional[int] = None
    end_char: Optional[int] = None
    token_count: Optional[int] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CollectionMetadata(BaseModel):
    """Metadata regarding collection configuration and embedding compatibility."""
    collection_name: str
    dimension: int
    distance: str
    points_count: int
    status: str
    embedding_model: Optional[str] = None
