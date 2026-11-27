from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field


class QueryIntent(str, Enum):
    """Supported semantic intent categories for enterprise knowledge queries."""

    FACTUAL_LOOKUP = "factual_lookup"
    PROCEDURAL = "procedural"
    COMPARISON = "comparison"
    SUMMARIZATION = "summarization"
    MULTI_PART = "multi_part"
    FOLLOW_UP = "follow_up"
    AMBIGUOUS = "ambiguous"
    OUT_OF_SCOPE = "out_of_scope"


class ConversationTurn(BaseModel):
    """Bounded conversation turn used strictly for resolving follow-up context."""

    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=2000)


class QueryAnalysis(BaseModel):
    """Structured semantic analysis of the user's question without answer generation or CoT."""

    intent: QueryIntent = QueryIntent.FACTUAL_LOOKUP
    secondary_intents: list[QueryIntent] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    is_ambiguous: bool = False
    ambiguity_reason: Optional[str] = None
    clarification_needed: bool = False
    suggested_clarifications: list[str] = Field(default_factory=list)
    is_multi_part: bool = False
    sub_questions: list[str] = Field(default_factory=list)
    is_follow_up: bool = False
    requires_context_resolution: bool = False
    is_clear_standalone: bool = True
    language: str = "en"
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class QueryRewriteResult(BaseModel):
    """Retrieval-optimized query rewrites while strictly preserving original_question."""

    original_question: str
    primary_retrieval_query: str
    alternative_queries: list[str] = Field(default_factory=list)
    sub_queries: list[str] = Field(default_factory=list)
    was_rewritten: bool = False
    rewrite_strategy: Literal[
        "unchanged",
        "contextualized",
        "clarified",
        "decomposed",
        "expanded",
    ] = "unchanged"


class QueryUnderstandingRequest(BaseModel):
    """Input schema for standalone or pipeline query understanding & rewriting."""

    question: str = Field(..., min_length=1, max_length=4000)
    conversation_history: list[ConversationTurn] = Field(default_factory=list)
    conversationId: Optional[str] = None
    knowledgeBaseId: Optional[str] = None
    knowledge_base_name: Optional[str] = None


class QueryUnderstandingResult(BaseModel):
    """Complete query analysis, rewrite output, and effective deduplicated retrieval queries."""

    original_question: str
    analysis: QueryAnalysis
    rewrite: QueryRewriteResult
    retrieval_queries: list[str] = Field(default_factory=list)
    used_conversation_context: bool = False
    fallback_used: bool = False
    model: str
    error: Optional[str] = None


class QueryUnderstandingSummary(BaseModel):
    """Compact telemetry metadata attached to RagRetrievalMetadata without exposing CoT."""

    intent: QueryIntent
    keywords: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    is_ambiguous: bool = False
    clarification_needed: bool = False
    suggested_clarifications: list[str] = Field(default_factory=list)
    is_multi_part: bool = False
    is_follow_up: bool = False
    was_rewritten: bool = False
    rewrite_strategy: str = "unchanged"
    original_question: str
    primary_retrieval_query: str
    alternative_queries: list[str] = Field(default_factory=list)
    sub_queries: list[str] = Field(default_factory=list)
    retrieval_queries_used: list[str] = Field(default_factory=list)
    used_conversation_context: bool = False
    fallback_used: bool = False
