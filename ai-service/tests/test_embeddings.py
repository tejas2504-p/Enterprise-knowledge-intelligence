import math
from unittest.mock import MagicMock, patch
import pytest

from app.models.document import ChunkItem
from app.models.embedding import ChunkEmbeddingResponse, TextEmbeddingResponse
from app.services.embedding_service import (
    EmbeddingCache,
    EmbeddingConfigurationError,
    EmbeddingProviderError,
    EmbeddingRateLimitError,
    EmbeddingValidationError,
    GeminiEmbeddingService,
    compute_content_hash,
    sanitize_error_message,
)
from app.services.embeddings import get_embedding, get_embeddings


def create_mock_embedding_response(num_items: int, dimension: int = 768, custom_values: list[float] | None = None):
    """Helper to generate a mock google.genai types.EmbedContentResponse."""
    embeddings = []
    for _ in range(num_items):
        mock_emb = MagicMock()
        mock_emb.values = custom_values if custom_values is not None else [0.01] * dimension
        embeddings.append(mock_emb)

    mock_resp = MagicMock()
    mock_resp.embeddings = embeddings
    return mock_resp


def make_chunk_item(chunk_id: str, text: str, index: int = 0) -> ChunkItem:
    return ChunkItem(
        chunk_id=chunk_id,
        text=text,
        chunk_index=index,
        token_count=len(text.split()),
        char_count=len(text),
        start_char=0,
        end_char=len(text),
        page_number=1,
        metadata={"filename": "test_doc.pdf", "department": "Engineering"},
    )


# -----------------------------------------------------------------------------
# 1. Empty Input Tests
# -----------------------------------------------------------------------------

def test_empty_chunks_returns_empty_without_api_call():
    mock_client = MagicMock()
    service = GeminiEmbeddingService(api_key="fake-key", client=mock_client)

    res = service.embed_chunks(chunks=[], document_id="doc_empty")

    assert isinstance(res, ChunkEmbeddingResponse)
    assert res.total_chunks == 0
    assert res.embeddings == []
    mock_client.models.embed_content.assert_not_called()


def test_empty_texts_returns_empty_without_api_call():
    mock_client = MagicMock()
    service = GeminiEmbeddingService(api_key="fake-key", client=mock_client)

    res = service.embed_texts(texts=[])

    assert isinstance(res, TextEmbeddingResponse)
    assert res.count == 0
    assert res.embeddings == []
    mock_client.models.embed_content.assert_not_called()


# -----------------------------------------------------------------------------
# 2. Single Chunk & Metadata Tracking Tests
# -----------------------------------------------------------------------------

def test_single_chunk_embedding_and_metadata_tracking():
    mock_client = MagicMock()
    mock_client.models.embed_content.return_value = create_mock_embedding_response(1, dimension=768)

    cache = EmbeddingCache()
    service = GeminiEmbeddingService(
        api_key="fake-key",
        model_name="text-embedding-004",
        dimension=768,
        client=mock_client,
        cache=cache,
    )

    chunk = make_chunk_item("chunk_001", "Enterprise architecture specifications for retrieval.")
    res = service.embed_chunks([chunk], document_id="doc_123", knowledge_base_id="kb_456")

    assert res.status == "success"
    assert res.total_chunks == 1
    assert res.generated_chunks == 1
    assert res.cached_chunks == 0
    assert len(res.embeddings) == 1

    embedded = res.embeddings[0]
    assert embedded.chunk_id == "chunk_001"
    assert embedded.dimension == 768
    assert embedded.model == "text-embedding-004"
    assert len(embedded.embedding) == 768
    assert embedded.content_hash == compute_content_hash(chunk.text)
    assert embedded.metadata["embedding_model"] == "text-embedding-004"
    assert embedded.metadata["embedding_dimension"] == 768
    assert embedded.metadata["knowledge_base_id"] == "kb_456"
    assert embedded.metadata["department"] == "Engineering"

    # Verify parameters passed to Google Gen AI SDK
    call_args = mock_client.models.embed_content.call_args
    assert call_args.kwargs["model"] == "text-embedding-004"
    assert call_args.kwargs["contents"] == [chunk.text]
    assert call_args.kwargs["config"].task_type == "RETRIEVAL_DOCUMENT"
    assert call_args.kwargs["config"].output_dimensionality == 768


# -----------------------------------------------------------------------------
# 3. Batching Tests
# -----------------------------------------------------------------------------

def test_batching_respects_configured_batch_size():
    mock_client = MagicMock()
    # 7 items with batch_size=3 -> 3 calls (sizes: 3, 3, 1)
    mock_client.models.embed_content.side_effect = [
        create_mock_embedding_response(3, dimension=768),
        create_mock_embedding_response(3, dimension=768),
        create_mock_embedding_response(1, dimension=768),
    ]

    cache = EmbeddingCache()
    service = GeminiEmbeddingService(
        api_key="fake-key",
        batch_size=3,
        client=mock_client,
        cache=cache,
    )

    chunks = [make_chunk_item(f"chunk_{i}", f"Text segment number {i}", index=i) for i in range(7)]
    res = service.embed_chunks(chunks, document_id="doc_batch")

    assert res.total_chunks == 7
    assert len(res.embeddings) == 7
    assert mock_client.models.embed_content.call_count == 3


# -----------------------------------------------------------------------------
# 4. Rate Limits & Transient Failures (Retries & Backoff)
# -----------------------------------------------------------------------------

def test_rate_limit_429_retries_and_succeeds():
    mock_client = MagicMock()

    # Simulate 429 rate limit error on first call, success on second
    rate_limit_err = Exception("Resource has been exhausted (e.g. check quota).")
    setattr(rate_limit_err, "code", 429)

    success_resp = create_mock_embedding_response(1, dimension=768)
    mock_client.models.embed_content.side_effect = [rate_limit_err, success_resp]

    service = GeminiEmbeddingService(
        api_key="fake-key",
        max_retries=2,
        min_backoff=0.01,
        max_backoff=0.05,
        client=mock_client,
        cache=EmbeddingCache(),
    )

    chunk = make_chunk_item("chunk_retry", "Testing retry with exponential backoff.")
    res = service.embed_chunks([chunk], document_id="doc_retry")

    assert res.total_chunks == 1
    assert mock_client.models.embed_content.call_count == 2


def test_transient_error_exhausts_retries_and_raises_provider_error():
    mock_client = MagicMock()

    server_err = Exception("503 Service Unavailable")
    setattr(server_err, "code", 503)
    mock_client.models.embed_content.side_effect = server_err

    service = GeminiEmbeddingService(
        api_key="fake-key",
        max_retries=2,
        min_backoff=0.01,
        max_backoff=0.05,
        client=mock_client,
        cache=EmbeddingCache(),
    )

    chunk = make_chunk_item("chunk_fail", "Testing failure behavior.")
    with pytest.raises(EmbeddingProviderError) as exc_info:
        service.embed_chunks([chunk], document_id="doc_fail")

    assert exc_info.value.status_code == 503
    assert mock_client.models.embed_content.call_count == 3  # initial + 2 retries


def test_non_retryable_400_error_fails_immediately():
    mock_client = MagicMock()

    client_err = Exception("400 Bad Request: Invalid input argument")
    setattr(client_err, "code", 400)
    mock_client.models.embed_content.side_effect = client_err

    service = GeminiEmbeddingService(
        api_key="fake-key",
        max_retries=3,
        min_backoff=0.01,
        client=mock_client,
        cache=EmbeddingCache(),
    )

    chunk = make_chunk_item("chunk_bad", "Bad input test.")
    with pytest.raises(EmbeddingProviderError):
        service.embed_chunks([chunk], document_id="doc_bad")

    # Should not retry 400 client errors
    assert mock_client.models.embed_content.call_count == 1


# -----------------------------------------------------------------------------
# 5. Embedding Dimension & Integrity Validation Tests
# -----------------------------------------------------------------------------

def test_dimension_validation_rejects_mismatch():
    mock_client = MagicMock()
    # Mock returns dimension 512, but service is configured for 768
    mock_client.models.embed_content.return_value = create_mock_embedding_response(1, dimension=512)

    service = GeminiEmbeddingService(
        api_key="fake-key",
        dimension=768,
        client=mock_client,
        cache=EmbeddingCache(),
    )

    chunk = make_chunk_item("chunk_dim", "Testing dimension mismatch rejection.")
    with pytest.raises(EmbeddingValidationError, match="Embedding dimension mismatch"):
        service.embed_chunks([chunk], document_id="doc_dim")


def test_dimension_validation_rejects_nan_and_inf():
    service = GeminiEmbeddingService(api_key="fake-key")

    with pytest.raises(EmbeddingValidationError, match="Invalid non-finite embedding value"):
        service.validate_embedding_vector([0.1, float("nan"), 0.3], expected_dim=3)

    with pytest.raises(EmbeddingValidationError, match="Invalid non-finite embedding value"):
        service.validate_embedding_vector([0.1, float("inf"), 0.3], expected_dim=3)


# -----------------------------------------------------------------------------
# 6. Unchanged Chunk Caching / Deduplication Tests
# -----------------------------------------------------------------------------

def test_caching_avoids_re_embedding_unchanged_chunks():
    mock_client = MagicMock()
    mock_client.models.embed_content.return_value = create_mock_embedding_response(1, dimension=768)

    cache = EmbeddingCache()
    service = GeminiEmbeddingService(
        api_key="fake-key",
        client=mock_client,
        cache=cache,
    )

    chunk = make_chunk_item("chunk_cache", "Deterministic chunk content that will be processed twice.")

    # Run 1: Cache Miss
    res1 = service.embed_chunks([chunk], document_id="doc_cache")
    assert res1.generated_chunks == 1
    assert res1.cached_chunks == 0
    assert mock_client.models.embed_content.call_count == 1

    # Run 2: Cache Hit (Unchanged chunk)
    res2 = service.embed_chunks([chunk], document_id="doc_cache")
    assert res2.generated_chunks == 0
    assert res2.cached_chunks == 1
    # API call count should still be 1 (no second call made!)
    assert mock_client.models.embed_content.call_count == 1
    assert res1.embeddings[0].embedding == res2.embeddings[0].embedding


# -----------------------------------------------------------------------------
# 7. Security: Zero API Key & Sensitive Content Leakage Tests
# -----------------------------------------------------------------------------

def test_security_sanitization_removes_api_keys():
    leaky_message = "Failed to connect using key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6 and token=secret_token_12345"
    sanitized = sanitize_error_message(leaky_message)

    assert "AIzaSy" not in sanitized
    assert "secret_token_12345" not in sanitized
    assert "[REDACTED_API_KEY]" in sanitized
    assert "token=[REDACTED]" in sanitized


def test_missing_api_key_raises_configuration_error():
    service = GeminiEmbeddingService(api_key=None, client=None)
    with patch("app.services.embedding_service.settings.GEMINI_API_KEY", None):
        with pytest.raises(EmbeddingConfigurationError, match="Gemini API key is not configured"):
            service.embed_texts(["hello"])


# -----------------------------------------------------------------------------
# 8. Query Embedding & Backward Compatibility Tests
# -----------------------------------------------------------------------------

def test_text_embedding_supports_retrieval_query_task_type():
    mock_client = MagicMock()
    mock_client.models.embed_content.return_value = create_mock_embedding_response(1, dimension=768)

    service = GeminiEmbeddingService(api_key="fake-key", client=mock_client)
    res = service.embed_texts(["What is the corporate compliance policy?"], task_type="RETRIEVAL_QUERY")

    assert res.count == 1
    assert len(res.embeddings[0]) == 768
    call_kwargs = mock_client.models.embed_content.call_args.kwargs
    assert call_kwargs["config"].task_type == "RETRIEVAL_QUERY"


def test_backward_compatible_get_embeddings_helper():
    mock_client = MagicMock()
    mock_client.models.embed_content.side_effect = (
        lambda model, contents, config=None, **kw: create_mock_embedding_response(len(contents), dimension=768)
    )

    with patch("app.services.embeddings.gemini_embedding_service._client", mock_client):
        embeddings = get_embeddings(["First query", "Second query"])
        assert len(embeddings) == 2
        assert len(embeddings[0]) == 768

        single = get_embedding("Single query")
        assert len(single) == 768
