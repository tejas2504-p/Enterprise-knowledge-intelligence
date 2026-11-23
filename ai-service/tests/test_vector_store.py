from unittest.mock import MagicMock
import pytest
from qdrant_client import QdrantClient
from qdrant_client.http import models

from app.models.embedding import EmbeddedChunk
from app.services.vector_store import (
    CollectionNotFoundError,
    IncompatibleVectorDimensionError,
    InvalidVectorError,
    VectorStoreConnectionError,
    VectorStoreError,
    VectorStoreService,
    generate_stable_point_id,
)


def make_chunk_item(chunk_id: str, text: str, index: int = 0, dimension: int = 768) -> EmbeddedChunk:
    return EmbeddedChunk(
        chunk_id=chunk_id,
        chunk_index=index,
        embedding=[0.05] * dimension,
        dimension=dimension,
        model="text-embedding-004",
        content_hash="hash_123",
        token_count=10,
        char_count=len(text),
        start_char=0,
        end_char=len(text),
        page_number=1,
        metadata={"text": text, "start_page": 1, "end_page": 1, "total_chunks": 1},
    )


# -----------------------------------------------------------------------------
# 1. Initialization & Local Mode Tests
# -----------------------------------------------------------------------------

def test_in_memory_qdrant_client_initialization():
    service = VectorStoreService(
        url=":memory:",
        collection_name="test_mem_collection",
        dimension=768,
    )
    client = service.get_client()
    assert isinstance(client, QdrantClient)

    # Collection creation in memory
    created = service.ensure_collection()
    assert created is True

    # Calling ensure_collection again on existing collection returns False
    created_again = service.ensure_collection()
    assert created_again is False


def test_connection_failure_raises_vector_store_connection_error():
    mock_client = MagicMock()
    mock_client.get_collections.side_effect = Exception("Connection refused to Qdrant host")

    service = VectorStoreService(client=mock_client)
    with pytest.raises(VectorStoreConnectionError, match="Failed to access or configure Qdrant"):
        service.ensure_collection()


# -----------------------------------------------------------------------------
# 2. Collection Creation & Dimension Enforcement Tests
# -----------------------------------------------------------------------------

def test_collection_creation_sets_dimension_and_cosine():
    mock_client = MagicMock()
    mock_collections = MagicMock()
    mock_collections.collections = []
    mock_client.get_collections.return_value = mock_collections

    service = VectorStoreService(
        collection_name="enterprise_test",
        dimension=768,
        distance="Cosine",
        client=mock_client,
    )
    service.ensure_collection()

    mock_client.create_collection.assert_called_once()
    kwargs = mock_client.create_collection.call_args.kwargs
    assert kwargs["collection_name"] == "enterprise_test"
    assert kwargs["vectors_config"].size == 768
    assert kwargs["vectors_config"].distance == models.Distance.COSINE


def test_incompatible_vector_dimension_raises_error():
    mock_client = MagicMock()
    # Existing collection named "knowledge_chunks"
    mock_item = MagicMock()
    mock_item.name = "knowledge_chunks"
    mock_collections = MagicMock()
    mock_collections.collections = [mock_item]
    mock_client.get_collections.return_value = mock_collections

    # Collection exists with size 1536 (e.g. legacy OpenAI model)
    mock_coll_info = MagicMock()
    mock_coll_info.config.params.vectors = models.VectorParams(
        size=1536,
        distance=models.Distance.COSINE,
    )
    mock_client.get_collection.return_value = mock_coll_info

    # Service configured for 768 (text-embedding-004)
    service = VectorStoreService(
        collection_name="knowledge_chunks",
        dimension=768,
        model_name="text-embedding-004",
        client=mock_client,
    )

    with pytest.raises(IncompatibleVectorDimensionError, match="incompatible with the configured dimension 768"):
        service.ensure_collection(allow_recreate=False)


def test_incompatible_dimension_recreates_when_allowed():
    mock_client = MagicMock()
    mock_item = MagicMock()
    mock_item.name = "knowledge_chunks"
    mock_client.get_collections.return_value = MagicMock(collections=[mock_item])

    # Existing has size 1536
    mock_client.get_collection.return_value = MagicMock(
        config=MagicMock(params=MagicMock(vectors=models.VectorParams(size=1536, distance=models.Distance.COSINE)))
    )

    service = VectorStoreService(
        collection_name="knowledge_chunks",
        dimension=768,
        client=mock_client,
    )

    recreated = service.ensure_collection(allow_recreate=True)
    assert recreated is True
    mock_client.delete_collection.assert_called_once_with("knowledge_chunks")
    mock_client.create_collection.assert_called_once()


# -----------------------------------------------------------------------------
# 3. Stable Point ID & Idempotency Tests
# -----------------------------------------------------------------------------

def test_stable_point_id_is_deterministic_uuid():
    p1 = generate_stable_point_id("doc_100", "chunk_0001")
    p2 = generate_stable_point_id("doc_100", "chunk_0001")
    p3 = generate_stable_point_id("doc_100", "chunk_0002")

    assert p1 == p2, "Point IDs for identical document and chunk identifiers must be strictly equal"
    assert p1 != p3, "Point IDs for different chunks must be distinct"


# -----------------------------------------------------------------------------
# 4. Upsert & Reindexing Tests
# -----------------------------------------------------------------------------

def test_upsert_chunks_builds_points_and_calls_qdrant():
    mock_client = MagicMock()
    mock_client.get_collections.return_value = MagicMock(collections=[MagicMock(name="test_col")])
    mock_client.get_collection.return_value = MagicMock(
        config=MagicMock(params=MagicMock(vectors=models.VectorParams(size=768, distance=models.Distance.COSINE)))
    )

    service = VectorStoreService(
        collection_name="test_col",
        dimension=768,
        client=mock_client,
    )

    chunks = [
        make_chunk_item("c0", "Enterprise security compliance protocols.", index=0, dimension=768),
        make_chunk_item("c1", "Access control and audit logging requirements.", index=1, dimension=768),
    ]

    count = service.upsert_chunks(
        chunks=chunks,
        document_id="doc_audit",
        knowledge_base_id="kb_security",
        organization_id="org_acme",
        department="SecOps",
        filename="security_audit.pdf",
        title="Security Audit",
    )

    assert count == 2
    mock_client.upsert.assert_called_once()
    kwargs = mock_client.upsert.call_args.kwargs
    points = kwargs["points"]
    assert len(points) == 2

    # Check payload contents
    pt0 = points[0]
    assert pt0.payload["document_id"] == "doc_audit"
    assert pt0.payload["knowledge_base_id"] == "kb_security"
    assert pt0.payload["organization_id"] == "org_acme"
    assert pt0.payload["department"] == "SecOps"
    assert pt0.payload["filename"] == "security_audit.pdf"
    assert pt0.payload["title"] == "Security Audit"
    assert pt0.payload["chunk_index"] == 0
    assert pt0.payload["page_number"] == 1


def test_upsert_rejects_vector_with_invalid_dimension():
    mock_client = MagicMock()
    mock_client.get_collections.return_value = MagicMock(collections=[MagicMock(name="test_col")])
    mock_client.get_collection.return_value = MagicMock(
        config=MagicMock(params=MagicMock(vectors=models.VectorParams(size=768, distance=models.Distance.COSINE)))
    )

    service = VectorStoreService(
        collection_name="test_col",
        dimension=768,
        client=mock_client,
    )

    # Chunk has 512 dimensions instead of 768
    chunk = make_chunk_item("c_wrong", "Invalid dimension chunk.", dimension=512)
    with pytest.raises(InvalidVectorError, match="does not match collection dimension 768"):
        service.upsert_chunks([chunk], document_id="doc_err", knowledge_base_id="kb_err")


def test_reindex_document_purges_stale_chunks_before_upsert():
    mock_client = MagicMock()
    mock_client.get_collections.return_value = MagicMock(collections=[MagicMock(name="test_col")])
    mock_client.get_collection.return_value = MagicMock(
        config=MagicMock(params=MagicMock(vectors=models.VectorParams(size=768, distance=models.Distance.COSINE)))
    )

    service = VectorStoreService(
        collection_name="test_col",
        dimension=768,
        client=mock_client,
    )

    chunks = [make_chunk_item("c0", "New updated document text.", dimension=768)]
    count = service.reindex_document(
        document_id="doc_update",
        chunks=chunks,
        knowledge_base_id="kb_general",
    )

    assert count == 1
    # Must have called delete with document_id filter first
    mock_client.delete.assert_called_once()
    del_kwargs = mock_client.delete.call_args.kwargs
    assert del_kwargs["points_selector"].must[0].key == "document_id"
    assert del_kwargs["points_selector"].must[0].match.value == "doc_update"

    # Then upserted new points
    mock_client.upsert.assert_called_once()


# -----------------------------------------------------------------------------
# 5. Filtered Search & Boundary Authorization Tests
# -----------------------------------------------------------------------------

def test_filtered_search_enforces_organization_and_kb_boundaries():
    mock_client = MagicMock()
    mock_client.get_collections.return_value = MagicMock(collections=[MagicMock(name="test_col")])
    mock_client.get_collection.return_value = MagicMock(
        config=MagicMock(params=MagicMock(vectors=models.VectorParams(size=768, distance=models.Distance.COSINE)))
    )

    # Mock search hit
    mock_hit = MagicMock()
    mock_hit.id = "point_123"
    mock_hit.score = 0.89
    mock_hit.payload = {
        "text": "Relevant retrieved passage.",
        "document_id": "doc_1",
        "knowledge_base_id": "kb_alpha",
        "organization_id": "org_global",
        "department": "Engineering",
    }
    mock_client.search.return_value = [mock_hit]
    mock_client.query_points.return_value = MagicMock(points=[mock_hit])

    service = VectorStoreService(
        collection_name="test_col",
        dimension=768,
        client=mock_client,
    )

    query_vec = [0.01] * 768
    results = service.search(
        query_vector=query_vec,
        organization_id="org_global",
        knowledge_base_ids=["kb_alpha", "kb_beta"],
        department="Engineering",
        limit=5,
    )

    assert len(results) == 1
    res = results[0]
    assert res.score == 0.89
    assert res.document_id == "doc_1"
    assert res.organization_id == "org_global"

    # Verify query filter passed to Qdrant enforces boundaries
    call_args = mock_client.query_points.call_args or mock_client.search.call_args
    search_kwargs = call_args.kwargs
    query_filter = search_kwargs["query_filter"]
    assert query_filter is not None

    filter_keys = {c.key for c in query_filter.must}
    assert "organization_id" in filter_keys
    assert "knowledge_base_id" in filter_keys
    assert "department" in filter_keys


def test_search_with_empty_kb_list_returns_empty_immediately():
    mock_client = MagicMock()
    service = VectorStoreService(dimension=768, client=mock_client)

    # If caller has 0 authorized KBs, search must return [] without touching Qdrant
    query_vec = [0.01] * 768
    results = service.search(query_vector=query_vec, knowledge_base_ids=[])

    assert results == []
    mock_client.search.assert_not_called()


def test_search_rejects_invalid_query_vector_dimension():
    service = VectorStoreService(dimension=768)

    # Query vector has 512 dims instead of 768
    with pytest.raises(InvalidVectorError, match="Query vector dimension 512 does not match"):
        service.search(query_vector=[0.01] * 512)


# -----------------------------------------------------------------------------
# 6. Deletion Tests
# -----------------------------------------------------------------------------

def test_delete_by_document_and_knowledge_base():
    mock_client = MagicMock()
    mock_client.get_collections.return_value = MagicMock(collections=[MagicMock(name="test_col")])
    mock_client.get_collection.return_value = MagicMock(
        config=MagicMock(params=MagicMock(vectors=models.VectorParams(size=768, distance=models.Distance.COSINE)))
    )

    service = VectorStoreService(collection_name="test_col", dimension=768, client=mock_client)

    # Delete by document
    res_doc = service.delete_by_document("doc_999")
    assert res_doc is True
    assert mock_client.delete.call_args.kwargs["points_selector"].must[0].key == "document_id"

    # Delete by knowledge base
    res_kb = service.delete_by_knowledge_base("kb_888")
    assert res_kb is True
    assert mock_client.delete.call_args.kwargs["points_selector"].must[0].key == "knowledge_base_id"
