from typing import Any, Optional
from pydantic import BaseModel, Field


class RagQueryRequest(BaseModel):
    """Request schema for RAG Question-Answering pipeline."""
    question: str = Field(..., min_length=1, description="The user's question to answer from knowledge base context")
    knowledgeBaseId: str = Field(..., min_length=1, description="The knowledge base ID to query")
    conversationId: Optional[str] = Field(None, description="Optional conversation tracking identifier")
    top_k: Optional[int] = Field(None, ge=1, le=20, description="Optional override for maximum retrieved chunks")
    similarity_threshold: Optional[float] = Field(None, ge=0.0, le=1.0, description="Optional override for minimum vector similarity threshold")


class Citation(BaseModel):
    """Evidence citation grounding an assertion in the generated answer."""
    document_id: str
    filename: Optional[str] = None
    chunk_id: Optional[str] = None
    page_number: Optional[int] = None
    excerpt: str = Field(..., description="Relevant text excerpt from the retrieved document chunk")
    score: float = Field(..., description="Cosine similarity score of the chunk to the query")


class RagRetrievalMetadata(BaseModel):
    """Metadata regarding retrieval quality, evidence sufficiency, and execution."""
    knowledge_base_id: str
    chunks_retrieved: int
    chunks_used: int
    model: str
    similarity_threshold: float
    insufficient_evidence: bool = False
    no_indexed_documents: bool = False
    indexed_documents: Optional[int] = None


class RagQueryResponse(BaseModel):
    """Structured response schema returned by POST /api/rag/query."""
    answer: str
    citations: list[Citation] = Field(default_factory=list)
    metadata: RagRetrievalMetadata
    conversationId: Optional[str] = None
