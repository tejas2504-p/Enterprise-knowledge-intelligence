from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from main import app
from app.core.config import settings
from app.models.document import (
    BatchIndexDocumentRequest,
    IndexDocumentRequest,
)
from app.services.rag import RagService
from app.services.vector_store import VectorStoreService


def create_mock_embedding_response(num_items: int, dimension: int = 768):
    """Helper to generate a mock google.genai types.EmbedContentResponse."""
    embeddings = []
    for _ in range(num_items):
        mock_emb = MagicMock()
        mock_emb.values = [0.02] * dimension
        embeddings.append(mock_emb)

    mock_resp = MagicMock()
    mock_resp.embeddings = embeddings
    return mock_resp


# -----------------------------------------------------------------------------
# 1. Single Document End-to-End Ingestion Test
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_single_document_ingestion_end_to_end():
    mock_gemini = MagicMock()
    mock_gemini.models.embed_content.side_effect = (
        lambda model, contents, **kwargs: create_mock_embedding_response(len(contents), 768)
    )

    # Use in-memory Qdrant client for integration testing
    mem_vector_store = VectorStoreService(
        url=":memory:",
        collection_name="ingest_test_col",
        dimension=768,
    )
    mem_vector_store.ensure_collection()

    rag = RagService()

    with patch("app.services.embedding_service.gemini_embedding_service._client", mock_gemini), \
         patch("app.services.rag.vector_store_service", mem_vector_store):

        req = IndexDocumentRequest(
            document_id="doc_ingest_001",
            knowledge_base_id="kb_finance_001",
            title="Q3 Financial Overview",
            text="First paragraph detailing quarterly revenue growth and expenses.\n\nSecond paragraph outlining forward-looking revenue guidance.",
            filename="q3_report.pdf",
            department="Finance",
            organization_id="org_enterprise",
            page_count=2,
            metadata={"confidentiality": "internal"},
        )

        resp = await rag.index_document(req)

        assert resp.status == "success"
        assert resp.document_id == "doc_ingest_001"
        assert resp.chunks_indexed >= 1
        assert resp.indexed_at is not None

        # Verify search retrieves with tenant and department boundary
        query_vec = [0.02] * 768
        search_res = mem_vector_store.search(
            query_vector=query_vec,
            organization_id="org_enterprise",
            knowledge_base_ids=["kb_finance_001"],
            department="Finance",
        )
        assert len(search_res) >= 1
        hit = search_res[0]
        assert hit.document_id == "doc_ingest_001"
        assert hit.organization_id == "org_enterprise"
        assert hit.department == "Finance"
        assert hit.filename == "q3_report.pdf"
        assert hit.title == "Q3 Financial Overview"


# -----------------------------------------------------------------------------
# 2. Re-indexing Purges Stale Chunks & Produces Stable IDs
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_reindex_purges_stale_chunks_and_maintains_idempotency():
    mock_gemini = MagicMock()
    mock_gemini.models.embed_content.side_effect = (
        lambda model, contents, **kwargs: create_mock_embedding_response(len(contents), 768)
    )

    mem_vector_store = VectorStoreService(
        url=":memory:",
        collection_name="reindex_test_col",
        dimension=768,
    )
    mem_vector_store.ensure_collection()

    rag = RagService()

    with patch("app.services.embedding_service.gemini_embedding_service._client", mock_gemini), \
         patch("app.services.rag.vector_store_service", mem_vector_store):

        # Initial indexing with 3 paragraphs
        req1 = IndexDocumentRequest(
            document_id="doc_reindex_test",
            knowledge_base_id="kb_test",
            text="Paragraph one with detailed content.\n\nParagraph two with more content.\n\nParagraph three with additional content.",
            filename="policy.txt",
        )
        resp1 = await rag.index_document(req1)
        assert resp1.chunks_indexed >= 1

        # Re-index with shorter document (only 1 paragraph)
        req2 = IndexDocumentRequest(
            document_id="doc_reindex_test",
            knowledge_base_id="kb_test",
            text="Single consolidated paragraph replacing all previous content.",
            filename="policy.txt",
        )
        resp2 = await rag.index_document(req2)
        assert resp2.chunks_indexed == 1

        # Verify search only returns the single updated chunk (no orphan chunks)
        results = mem_vector_store.search(
            query_vector=[0.02] * 768,
            knowledge_base_ids=["kb_test"],
        )
        assert len(results) == 1
        assert "Single consolidated paragraph" in results[0].text


# -----------------------------------------------------------------------------
# 3. Batch Ingestion with Partial Failures Test
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_batch_ingestion_handles_partial_failures():
    mock_gemini = MagicMock()
    mock_gemini.models.embed_content.side_effect = (
        lambda model, contents, **kwargs: create_mock_embedding_response(len(contents), 768)
    )

    mem_vector_store = VectorStoreService(
        url=":memory:",
        collection_name="batch_test_col",
        dimension=768,
    )
    mem_vector_store.ensure_collection()

    rag = RagService()

    doc_valid = IndexDocumentRequest(
        document_id="doc_valid_001",
        knowledge_base_id="kb_valid",
        text="Valid enterprise document ready for vector storage.",
    )

    doc_failing = IndexDocumentRequest(
        document_id="doc_fail_002",
        knowledge_base_id="kb_fail",
        text="This document will trigger an embedding failure.",
    )

    # Simulate failure on doc_fail_002
    async def mock_index_dispatch(req, db=None):
        if req.document_id == "doc_fail_002":
            raise ValueError("Upstream embedding quota exceeded")
        return await RagService.index_document(rag, req, db=db)

    with patch.object(rag, "index_document", side_effect=mock_index_dispatch):
        batch_req = BatchIndexDocumentRequest(documents=[doc_valid, doc_failing])
        resp = await rag.batch_index_documents(batch_req)

        assert resp.status == "partial_success"
        assert resp.total_documents == 2
        assert resp.successful_documents == 1
        assert resp.failed_documents == 1

        statuses = {r.document_id: r.status for r in resp.results}
        assert statuses["doc_valid_001"] == "indexed"
        assert statuses["doc_fail_002"] == "failed"


# -----------------------------------------------------------------------------
# 4. Deletion of Document & Knowledge Base Vectors Test
# -----------------------------------------------------------------------------

def test_deletion_removes_indexed_vectors():
    mock_store = MagicMock()
    rag = RagService()

    with patch("app.services.rag.vector_store_service", mock_store):
        del_doc_resp = rag.delete_document("doc_to_delete")
        assert del_doc_resp.status == "success"
        mock_store.delete_by_document.assert_called_once_with("doc_to_delete")

        del_kb_resp = rag.delete_knowledge_base("kb_to_delete")
        assert del_kb_resp.status == "success"
        mock_store.delete_by_knowledge_base.assert_called_once_with("kb_to_delete")


# -----------------------------------------------------------------------------
# 5. Service-to-Service Authentication Test
# -----------------------------------------------------------------------------

def test_service_to_service_auth_enforcement():
    client = TestClient(app)

    # 1. Missing API Key
    resp_no_auth = client.post(
        "/api/internal/documents/index",
        json={"document_id": "1", "knowledge_base_id": "1", "text": "test"},
    )
    assert resp_no_auth.status_code in (401, 403)

    # 2. Invalid API Key
    resp_bad_auth = client.post(
        "/api/internal/documents/index",
        json={"document_id": "1", "knowledge_base_id": "1", "text": "test"},
        headers={"x-api-key": "unauthorized_secret_key"},
    )
    assert resp_bad_auth.status_code in (401, 403)

    # 3. Valid Service Key
    with patch("app.services.rag.rag_service.index_document", new_callable=AsyncMock) as mock_index:
        mock_index.return_value = MagicMock(status="success", document_id="1", chunks_indexed=2, indexed_at="2026-11-23T00:00:00Z")
        resp_good_auth = client.post(
            "/api/internal/documents/index",
            json={"document_id": "1", "knowledge_base_id": "1", "text": "test"},
            headers={"x-api-key": settings.SERVICE_API_KEY},
        )
        assert resp_good_auth.status_code == 200
        data = resp_good_auth.json()
        assert data["status"] == "success"


# -----------------------------------------------------------------------------
# 6. Direct MongoDB Consumption & Status Update Test
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_mongodb_direct_consumption_updates_indexing_status():
    mock_gemini = MagicMock()
    mock_gemini.models.embed_content.side_effect = (
        lambda model, contents, **kwargs: create_mock_embedding_response(len(contents), 768)
    )

    mem_vector_store = VectorStoreService(url=":memory:", dimension=768)
    mem_vector_store.ensure_collection()

    rag = RagService()

    # Mock MongoDB Document & KnowledgeBase
    mock_doc = {
        "_id": "6741b0000000000000000001",
        "extractedText": "Extracted text already saved by Phase 2 Node.js pipeline. Reusing without re-extraction.",
        "originalFileName": "annual_review.docx",
        "knowledgeBase": "6741b0000000000000000002",
        "department": "HR",
        "organization": "EnterpriseCorp",
        "pageCount": 4,
        "metadata": {"visibility": "restricted"},
    }

    mock_db = MagicMock()
    mock_db["documents"].find_one = AsyncMock(return_value=mock_doc)
    mock_db["documents"].update_one = AsyncMock()

    with patch("app.services.embedding_service.gemini_embedding_service._client", mock_gemini), \
         patch("app.services.rag.vector_store_service", mem_vector_store):

        req = IndexDocumentRequest(
            document_id="6741b0000000000000000001",
            knowledge_base_id="6741b0000000000000000002",
            # text is None! Tests that it fetches from MongoDB without re-extracting file
        )

        resp = await rag.index_document(req, db=mock_db)

        assert resp.status == "success"
        assert resp.chunks_indexed >= 1

        # Verify update_one was called on MongoDB to mark indexingStatus='indexed'
        mock_db["documents"].update_one.assert_called()
        update_calls = mock_db["documents"].update_one.call_args_list
        # Last call sets indexingStatus to 'indexed'
        last_update = update_calls[-1][0][1]["$set"]
        assert last_update["indexingStatus"] == "indexed"
        assert last_update["chunksCount"] >= 1
        assert last_update["indexingError"] is None
