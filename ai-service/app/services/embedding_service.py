import hashlib
import logging
import math
import random
import re
import time
from typing import Any, Callable, Optional, Sequence

from app.core.config import settings
from app.models.document import ChunkItem
from app.models.embedding import (
    ChunkEmbeddingRequest,
    ChunkEmbeddingResponse,
    EmbeddedChunk,
    EmbeddingModelConfig,
    TextEmbeddingRequest,
    TextEmbeddingResponse,
)

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Custom Exceptions
# -----------------------------------------------------------------------------

class EmbeddingError(Exception):
    """Base exception for all embedding-related errors."""
    pass


class EmbeddingConfigurationError(EmbeddingError):
    """Raised when configuration or credentials are missing or invalid."""
    pass


class EmbeddingValidationError(EmbeddingError):
    """Raised when embedding response or vector dimensions fail validation."""
    pass


class EmbeddingProviderError(EmbeddingError):
    """Raised when the upstream provider fails or network errors persist."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class EmbeddingRateLimitError(EmbeddingProviderError):
    """Raised when rate limits (HTTP 429) persist after max retries."""
    def __init__(self, message: str):
        super().__init__(message, status_code=429)


# -----------------------------------------------------------------------------
# Sanitization & Security Utilities
# -----------------------------------------------------------------------------

def sanitize_error_message(error: Exception | str) -> str:
    """
    Sanitize error messages to ensure API keys, authorization headers,
    URI passwords, and secrets are never logged or exposed.
    """
    raw_str = str(error)
    # Mask Gemini / Google API keys (AIza...)
    sanitized = re.sub(r"AIza[0-9A-Za-z_\-]+", "[REDACTED_API_KEY]", raw_str)
    # Mask OpenAI-style keys (sk-...)
    sanitized = re.sub(r"sk-[0-9A-Za-z_\-]+", "[REDACTED_API_KEY]", sanitized)
    # Mask URI embedded credentials (e.g. mongodb+srv://user:pass@host)
    sanitized = re.sub(r"(://[^:/@\s]+:)([^@\s]+)(@)", r"\1[REDACTED]\3", sanitized)
    # Mask generic key patterns in query params, headers, or assignments
    sanitized = re.sub(r"(key|api_key|api-key|token|secret)\s*[:=]\s*([^\s&,;'\"]+)", r"\1=[REDACTED]", sanitized, flags=re.IGNORECASE)
    sanitized = re.sub(r"(bearer|authorization:\s*)([^\s]+)", r"\1[REDACTED]", sanitized, flags=re.IGNORECASE)

    # Mask active configured secrets dynamically
    for secret_attr in ("GEMINI_API_KEY", "QDRANT_API_KEY", "SERVICE_API_KEY", "OPENAI_API_KEY"):
        secret_val = getattr(settings, secret_attr, None)
        if secret_val and isinstance(secret_val, str) and len(secret_val) > 4 and secret_val in sanitized:
            sanitized = sanitized.replace(secret_val, "[REDACTED]")

    return sanitized


def compute_content_hash(text: str) -> str:
    """Compute deterministic SHA-256 hash for chunk text to support caching and version tracking."""
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


# -----------------------------------------------------------------------------
# In-Memory Deduplication / Embedding Cache
# -----------------------------------------------------------------------------

class EmbeddingCache:
    """
    In-memory cache for generated embeddings to avoid redundant API calls
    for unchanged document chunks.
    Keyed by: (model_name, dimension, content_hash)
    """

    def __init__(self, max_size: int = 10000):
        self._cache: dict[tuple[str, int, str], list[float]] = {}
        self.max_size = max_size
        self.hits = 0
        self.misses = 0

    def _make_key(self, model: str, dimension: int, content_hash: str) -> tuple[str, int, str]:
        return (model, dimension, content_hash)

    def get(self, model: str, dimension: int, content_hash: str) -> Optional[list[float]]:
        key = self._make_key(model, dimension, content_hash)
        if key in self._cache:
            self.hits += 1
            return self._cache[key]
        self.misses += 1
        return None

    def set(self, model: str, dimension: int, content_hash: str, embedding: list[float]) -> None:
        if len(self._cache) >= self.max_size:
            # Simple eviction of oldest item if max size reached
            first_key = next(iter(self._cache))
            del self._cache[first_key]
        key = self._make_key(model, dimension, content_hash)
        self._cache[key] = embedding

    def clear(self) -> None:
        self._cache.clear()
        self.hits = 0
        self.misses = 0

    @property
    def size(self) -> int:
        return len(self._cache)


default_embedding_cache = EmbeddingCache()


# -----------------------------------------------------------------------------
# Gemini Embedding Service
# -----------------------------------------------------------------------------

class GeminiEmbeddingService:
    """
    Production-grade embedding generation service using the official Google Gen AI SDK
    (`google-genai`).

    Features:
    - Configurable Gemini embedding model (default: text-embedding-004)
    - Document chunk embedding with metadata enrichment
    - Batching with bounded size limits
    - Rate limit (429) & transient error retries with exponential backoff & jitter
    - Embedding dimension validation (rejects invalid vectors, NaNs, Infs)
    - Content hash caching to avoid re-embedding unchanged chunks
    - Security: zero leakage of API keys or sensitive text content in logs/errors
    - Safe empty input handling
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        dimension: Optional[int] = None,
        task_type: Optional[str] = None,
        batch_size: Optional[int] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        backoff_factor: Optional[float] = None,
        min_backoff: Optional[float] = None,
        max_backoff: Optional[float] = None,
        cache: Optional[EmbeddingCache] = None,
        client: Optional[Any] = None,
    ):
        self.api_key = api_key or getattr(settings, "GEMINI_API_KEY", None)
        self.model_name = model_name or getattr(settings, "EMBEDDING_MODEL", "text-embedding-004")
        self.dimension = dimension if dimension is not None else getattr(settings, "EMBEDDING_DIMENSION", 768)
        self.default_task_type = task_type or getattr(settings, "EMBEDDING_TASK_TYPE", "RETRIEVAL_DOCUMENT")
        self.batch_size = batch_size if batch_size is not None else getattr(settings, "EMBEDDING_BATCH_SIZE", 64)
        self.timeout = timeout if timeout is not None else getattr(settings, "EMBEDDING_TIMEOUT", 30.0)
        self.max_retries = max_retries if max_retries is not None else getattr(settings, "EMBEDDING_MAX_RETRIES", 4)
        self.backoff_factor = backoff_factor if backoff_factor is not None else getattr(settings, "EMBEDDING_BACKOFF_FACTOR", 1.5)
        self.min_backoff = min_backoff if min_backoff is not None else getattr(settings, "EMBEDDING_MIN_BACKOFF", 0.5)
        self.max_backoff = max_backoff if max_backoff is not None else getattr(settings, "EMBEDDING_MAX_BACKOFF", 10.0)
        self.cache = cache if cache is not None else default_embedding_cache
        self._client = client

    def _get_client(self) -> Any:
        """Lazily initialize and return the official Google Gen AI Client."""
        if self._client is not None:
            return self._client

        if not self.api_key:
            raise EmbeddingConfigurationError(
                "Gemini API key is not configured. Please set GEMINI_API_KEY environment variable."
            )

        try:
            from google import genai
            from google.genai import types

            http_options = types.HttpOptions(timeout=int(self.timeout * 1000)) if hasattr(types, "HttpOptions") else None
            self._client = genai.Client(api_key=self.api_key, http_options=http_options)
            return self._client
        except ImportError as e:
            raise EmbeddingConfigurationError(
                "The official google-genai SDK is not installed. Please install 'google-genai'."
            ) from e
        except Exception as e:
            safe_msg = sanitize_error_message(e)
            logger.error("Failed to initialize Google Gen AI Client: %s", safe_msg)
            raise EmbeddingConfigurationError(f"Failed to initialize Gemini Client: {safe_msg}") from e

    def get_config(self) -> EmbeddingModelConfig:
        """Return the current embedding service configuration."""
        return EmbeddingModelConfig(
            provider="gemini",
            model_name=self.model_name,
            dimension=self.dimension,
            task_type=self.default_task_type,
            batch_size=self.batch_size,
            timeout=self.timeout,
        )

    def validate_embedding_vector(self, vector: Sequence[float], expected_dim: int) -> list[float]:
        """
        Validate vector dimension and assert that all values are valid finite floats.
        Rejects invalid dimensions, NaNs, and Infs.
        """
        if not isinstance(vector, (list, tuple)):
            raise EmbeddingValidationError(f"Expected embedding to be a list/tuple, got {type(vector).__name__}")

        if len(vector) != expected_dim:
            raise EmbeddingValidationError(
                f"Embedding dimension mismatch: expected {expected_dim}, but provider returned {len(vector)}"
            )

        validated: list[float] = []
        for idx, val in enumerate(vector):
            if not isinstance(val, (int, float)):
                raise EmbeddingValidationError(f"Invalid non-numeric value at index {idx}: {type(val).__name__}")
            if not math.isfinite(val):
                raise EmbeddingValidationError(f"Invalid non-finite embedding value at index {idx}: {val}")
            validated.append(float(val))

        return validated

    def _call_provider_with_retry(
        self,
        texts: list[str],
        model: str,
        dimension: int,
        task_type: Optional[str] = None,
        title: Optional[str] = None,
    ) -> list[list[float]]:
        """
        Execute API call to Gemini embed_content with bounded retries and exponential backoff.
        Handles rate limits (429) and transient errors (5xx/timeouts).
        """
        client = self._get_client()
        from google.genai import types

        # Build EmbedContentConfig
        config_kwargs: dict[str, Any] = {}
        if task_type:
            config_kwargs["task_type"] = task_type
        if title:
            config_kwargs["title"] = title
        if dimension:
            config_kwargs["output_dimensionality"] = dimension

        embed_config = types.EmbedContentConfig(**config_kwargs) if config_kwargs else None

        last_exception: Optional[Exception] = None
        attempt = 0

        while attempt <= self.max_retries:
            try:
                # Log non-sensitive telemetry only
                logger.debug(
                    "Calling Gemini embed_content: model=%s, batch_size=%d, attempt=%d",
                    model, len(texts), attempt + 1
                )

                response = client.models.embed_content(
                    model=model,
                    contents=texts,
                    config=embed_config,
                )

                if not response or not hasattr(response, "embeddings") or response.embeddings is None:
                    raise EmbeddingValidationError("Gemini API returned empty response without embeddings")

                embeddings_list = response.embeddings
                if len(embeddings_list) != len(texts):
                    raise EmbeddingValidationError(
                        f"Expected {len(texts)} embeddings from provider, but received {len(embeddings_list)}"
                    )

                results: list[list[float]] = []
                for emb in embeddings_list:
                    values = getattr(emb, "values", None)
                    if values is None:
                        raise EmbeddingValidationError("Provider response chunk missing 'values' vector")
                    validated = self.validate_embedding_vector(values, expected_dim=dimension)
                    results.append(validated)

                return results

            except EmbeddingValidationError:
                # Validation errors indicate corrupted provider responses, do not retry
                raise

            except Exception as exc:
                last_exception = exc
                safe_msg = sanitize_error_message(exc)
                status_code: Optional[int] = getattr(exc, "code", None)

                # Identify if this is a retryable transient failure
                is_rate_limit = (
                    status_code == 429
                    or "resource_exhausted" in safe_msg.lower()
                    or "rate_limit" in safe_msg.lower()
                    or "quota" in safe_msg.lower()
                )
                is_server_error = (
                    status_code in (500, 502, 503, 504)
                    or "deadline" in safe_msg.lower()
                    or "timeout" in safe_msg.lower()
                    or "connection" in safe_msg.lower()
                    or "unavailable" in safe_msg.lower()
                )

                if (is_rate_limit or is_server_error) and attempt < self.max_retries:
                    # Exponential backoff with jitter
                    backoff = min(
                        self.max_backoff,
                        self.min_backoff * (self.backoff_factor ** attempt)
                    )
                    jitter = random.uniform(0, 0.1 * self.min_backoff)
                    total_delay = backoff + jitter

                    logger.warning(
                        "Gemini embedding call failed (status=%s, attempt %d/%d). Retrying in %.2fs. Error: %s",
                        status_code or "transient",
                        attempt + 1,
                        self.max_retries,
                        total_delay,
                        safe_msg,
                    )
                    time.sleep(total_delay)
                    attempt += 1
                else:
                    # Non-retryable error or exhausted retries
                    if is_rate_limit:
                        raise EmbeddingRateLimitError(
                            f"Gemini API rate limit exceeded after {attempt + 1} attempts: {safe_msg}"
                        ) from exc
                    raise EmbeddingProviderError(
                        f"Gemini API call failed after {attempt + 1} attempts: {safe_msg}",
                        status_code=status_code,
                    ) from exc

        # Fallback if loop exits without return/raise
        raise EmbeddingProviderError(
            f"Embedding request failed: {sanitize_error_message(last_exception)}"
        )

    def embed_texts(
        self,
        texts: list[str],
        model: Optional[str] = None,
        dimension: Optional[int] = None,
        task_type: Optional[str] = None,
        title: Optional[str] = None,
    ) -> TextEmbeddingResponse:
        """
        Generate embeddings for a list of raw text strings (e.g., search queries).
        Handles batching, empty inputs, and response validation.
        """
        target_model = model or self.model_name
        target_dim = dimension if dimension is not None else self.dimension
        target_task_type = task_type or "RETRIEVAL_QUERY"

        if not texts:
            return TextEmbeddingResponse(
                status="success",
                model=target_model,
                dimension=target_dim,
                count=0,
                embeddings=[],
            )

        # Filter and validate texts
        clean_texts = [t if (t and t.strip()) else " " for t in texts]

        all_embeddings: list[list[float]] = []

        # Batch texts to respect provider limits
        for i in range(0, len(clean_texts), self.batch_size):
            batch = clean_texts[i : i + self.batch_size]
            batch_vectors = self._call_provider_with_retry(
                texts=batch,
                model=target_model,
                dimension=target_dim,
                task_type=target_task_type,
                title=title,
            )
            all_embeddings.extend(batch_vectors)

        return TextEmbeddingResponse(
            status="success",
            model=target_model,
            dimension=target_dim,
            count=len(all_embeddings),
            embeddings=all_embeddings,
        )

    def embed_chunks(
        self,
        chunks: list[ChunkItem],
        document_id: str,
        knowledge_base_id: Optional[str] = None,
        model: Optional[str] = None,
        dimension: Optional[int] = None,
        task_type: Optional[str] = None,
        title: Optional[str] = None,
    ) -> ChunkEmbeddingResponse:
        """
        Generate embeddings for document chunks with:
        - Content-hash based deduplication & caching to avoid re-embedding unchanged chunks
        - Sliced batching according to configured batch_size
        - Dimension and schema validation
        - Rich metadata and model tracking
        """
        target_model = model or self.model_name
        target_dim = dimension if dimension is not None else self.dimension
        target_task_type = task_type or self.default_task_type

        if not chunks:
            return ChunkEmbeddingResponse(
                status="success",
                document_id=document_id,
                model=target_model,
                dimension=target_dim,
                total_chunks=0,
                cached_chunks=0,
                generated_chunks=0,
                embeddings=[],
            )

        # 1. Identify cached vs missing embeddings
        cached_vectors: dict[int, list[float]] = {}
        missing_indices: list[int] = []
        missing_texts: list[str] = []
        chunk_hashes: list[str] = []

        for idx, chunk in enumerate(chunks):
            content_hash = compute_content_hash(chunk.text)
            chunk_hashes.append(content_hash)
            cached_vec = self.cache.get(target_model, target_dim, content_hash)
            if cached_vec is not None:
                cached_vectors[idx] = cached_vec
            else:
                missing_indices.append(idx)
                missing_texts.append(chunk.text if chunk.text.strip() else " ")

        cached_count = len(cached_vectors)
        generated_count = len(missing_indices)

        # 2. Generate embeddings for missing chunks in batches
        generated_vectors: dict[int, list[float]] = {}

        if missing_texts:
            for b_idx in range(0, len(missing_texts), self.batch_size):
                batch_texts = missing_texts[b_idx : b_idx + self.batch_size]
                batch_indices = missing_indices[b_idx : b_idx + self.batch_size]

                batch_embeddings = self._call_provider_with_retry(
                    texts=batch_texts,
                    model=target_model,
                    dimension=target_dim,
                    task_type=target_task_type,
                    title=title,
                )

                for orig_idx, vec in zip(batch_indices, batch_embeddings):
                    generated_vectors[orig_idx] = vec
                    # Store in cache for future idempotent runs
                    h = chunk_hashes[orig_idx]
                    self.cache.set(target_model, target_dim, h, vec)

        # 3. Assemble full embedded chunks in original chunk order
        embedded_chunks: list[EmbeddedChunk] = []
        for idx, chunk in enumerate(chunks):
            vector = cached_vectors.get(idx) or generated_vectors.get(idx)
            if vector is None:
                raise EmbeddingValidationError(f"Missing embedding vector for chunk at index {idx}")

            enriched_meta = dict(chunk.metadata)
            enriched_meta.update({
                "embedding_model": target_model,
                "embedding_dimension": target_dim,
                "content_hash": chunk_hashes[idx],
            })
            if knowledge_base_id:
                enriched_meta["knowledge_base_id"] = knowledge_base_id

            embedded_chunks.append(
                EmbeddedChunk(
                    chunk_id=chunk.chunk_id,
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    embedding=vector,
                    dimension=target_dim,
                    model=target_model,
                    content_hash=chunk_hashes[idx],
                    token_count=chunk.token_count,
                    char_count=chunk.char_count,
                    start_char=chunk.start_char,
                    end_char=chunk.end_char,
                    page_number=chunk.page_number,
                    metadata=enriched_meta,
                )
            )

        return ChunkEmbeddingResponse(
            status="success",
            document_id=document_id,
            model=target_model,
            dimension=target_dim,
            total_chunks=len(embedded_chunks),
            cached_chunks=cached_count,
            generated_chunks=generated_count,
            embeddings=embedded_chunks,
        )


# Global default instance
gemini_embedding_service = GeminiEmbeddingService()
