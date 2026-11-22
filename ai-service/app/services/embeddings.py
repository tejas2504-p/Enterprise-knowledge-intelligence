from typing import Optional
from app.core.config import settings
from app.services.embedding_service import (
    EmbeddingCache,
    EmbeddingConfigurationError,
    EmbeddingError,
    EmbeddingProviderError,
    EmbeddingRateLimitError,
    EmbeddingValidationError,
    GeminiEmbeddingService,
    gemini_embedding_service,
)

# Export primary service class and default instance
embedding_service = gemini_embedding_service

__all__ = [
    "embedding_service",
    "gemini_embedding_service",
    "GeminiEmbeddingService",
    "EmbeddingCache",
    "EmbeddingError",
    "EmbeddingConfigurationError",
    "EmbeddingValidationError",
    "EmbeddingProviderError",
    "EmbeddingRateLimitError",
    "get_embeddings",
    "get_embedding",
]


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """
    Generate embeddings for a list of text strings.
    Uses the configured provider (defaults to Gemini 'text-embedding-004').
    Maintains backward compatibility with existing callers.
    """
    if not texts:
        return []

    if settings.EMBEDDING_PROVIDER == "openai":
        from openai import OpenAI
        if not settings.OPENAI_API_KEY:
            raise ValueError("OpenAI API key not configured")
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        response = client.embeddings.create(
            input=texts,
            model=settings.EMBEDDING_MODEL or "text-embedding-ada-002"
        )
        return [data.embedding for data in response.data]

    # Default: Google Gen AI / Gemini embedding service
    res = gemini_embedding_service.embed_texts(texts=texts)
    return res.embeddings


def get_embedding(text: str) -> list[float]:
    """Generate embedding for a single text string."""
    results = get_embeddings([text])
    if not results:
        return []
    return results[0]
