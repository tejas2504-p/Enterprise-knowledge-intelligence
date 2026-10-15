import pytest
from app.services.chunking import TextChunker, ChunkingService, split_text
from app.services.tokenizer import Tokenizer
from app.models.document import ChunkDocumentRequest, ChunkDocumentResponse
from fastapi.testclient import TestClient
from main import app
from app.core.config import settings


# ---------------------------------------------------------------------------
# 1. Empty Text Tests
# ---------------------------------------------------------------------------

def test_empty_text_returns_no_chunks():
    chunker = TextChunker()
    chunks = chunker.chunk_text(
        text="",
        document_id="doc_empty",
        knowledge_base_id="kb_empty",
    )
    assert chunks == []


def test_whitespace_only_text_returns_no_chunks():
    chunker = TextChunker()
    chunks = chunker.chunk_text(
        text="   \n\t  \r\n   ",
        document_id="doc_ws",
        knowledge_base_id="kb_ws",
    )
    assert chunks == []


def test_split_text_backward_compatibility_empty():
    assert split_text("") == []
    assert split_text("   \n\n  ") == []


# ---------------------------------------------------------------------------
# 2. Short Text Tests (fits in single chunk)
# ---------------------------------------------------------------------------

def test_short_text_single_chunk():
    chunker = TextChunker(chunk_size=800, chunk_overlap=120)
    short_text = "This is an enterprise document with valuable architectural guidance."
    chunks = chunker.chunk_text(
        text=short_text,
        document_id="doc_short",
        knowledge_base_id="kb_short",
        filename="short.txt",
        department="Engineering",
        organization_id="org_1",
    )
    assert len(chunks) == 1
    c = chunks[0]
    assert c.chunk_index == 0
    assert c.text == short_text
    assert c.token_count > 0
    assert c.token_count <= 800
    assert c.char_count == len(short_text)
    assert c.start_char == 0
    assert c.end_char == len(short_text)
    assert c.metadata["total_chunks"] == 1
    assert c.metadata["document_id"] == "doc_short"
    assert c.metadata["filename"] == "short.txt"
    assert c.metadata["department"] == "Engineering"
    assert c.metadata["organization_id"] == "org_1"


# ---------------------------------------------------------------------------
# 3. Long Text & Boundary Preservation Tests
# ---------------------------------------------------------------------------

def test_long_text_chunks_respect_token_limit_and_boundaries():
    # Set a small chunk size to verify splitting across paragraphs and sentences
    chunk_size = 60
    chunk_overlap = 15
    chunker = TextChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    paragraph_1 = "Enterprise search systems require robust text chunking. When documents are ingested, they must be parsed accurately."
    paragraph_2 = "Retrieval-Augmented Generation relies heavily on chunk quality. Poor chunking degrades semantic search relevance."
    paragraph_3 = "Chunk overlap ensures context is preserved across chunk boundaries. This prevents information loss at segment boundaries."
    paragraph_4 = "Metadata enrichment attaches crucial tenant, department, and origin information to every indexed segment."
    paragraph_5 = "Idempotent processing allows reprocessing without creating duplicate chunks or conflicting vector IDs."

    full_text = f"{paragraph_1}\n\n{paragraph_2}\n\n{paragraph_3}\n\n{paragraph_4}\n\n{paragraph_5}"

    chunks = chunker.chunk_text(
        text=full_text,
        document_id="doc_long",
        knowledge_base_id="kb_long",
    )

    assert len(chunks) > 1

    # Check each chunk respects chunk_size
    for i, c in enumerate(chunks):
        assert c.token_count <= chunk_size, f"Chunk {i} exceeded chunk_size: {c.token_count} > {chunk_size}"
        assert c.chunk_index == i
        assert c.metadata["total_chunks"] == len(chunks)

    # Check that meaningful text from each paragraph is preserved across the chunks
    all_chunk_text = " ".join([c.text for c in chunks])
    for kw in ["Enterprise search", "Retrieval-Augmented", "Chunk overlap", "Metadata enrichment", "Idempotent processing"]:
        assert kw in all_chunk_text, f"Keyword '{kw}' was discarded during chunking!"


def test_extremely_long_document_handles_without_recursion_limit():
    # Simulate an extremely long document (500 paragraphs, ~25,000 words)
    chunker = TextChunker(chunk_size=400, chunk_overlap=50)
    paragraphs = [
        f"Section {i}: Enterprise compliance mandates strict verification of knowledge assets. "
        f"Paragraph {i} establishes protocol {i * 7} for secure ingestion and retrieval."
        for i in range(300)
    ]
    huge_text = "\n\n".join(paragraphs)

    chunks = chunker.chunk_text(
        text=huge_text,
        document_id="doc_huge",
        knowledge_base_id="kb_huge",
    )

    assert len(chunks) > 10
    for c in chunks:
        assert c.token_count <= 400


# ---------------------------------------------------------------------------
# 4. Overlap Tests
# ---------------------------------------------------------------------------

def test_overlap_continuity_between_consecutive_chunks():
    chunk_size = 50
    chunk_overlap = 15
    chunker = TextChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    sentences = [
        "Alpha provides foundational knowledge architecture for enterprise search.",
        "Beta manages retrieval across multi-tenant knowledge bases and silos.",
        "Gamma evaluates LLM generation quality using strict context grounding.",
        "Delta synchronizes vector index state with MongoDB persistence records.",
        "Epsilon handles rate limits and streaming response generation."
    ]
    text = " ".join(sentences)

    chunks = chunker.chunk_text(
        text=text,
        document_id="doc_overlap",
        knowledge_base_id="kb_overlap",
    )

    assert len(chunks) >= 2

    # Verify overlap exists between consecutive chunks
    tokenizer = Tokenizer()
    for i in range(len(chunks) - 1):
        c1 = chunks[i].text
        c2 = chunks[i + 1].text

        # The end of c1 should share words with the beginning of c2
        words_c1 = c1.split()
        words_c2 = c2.split()

        # At least the last few words of c1 appear in the first half of c2
        common_words = set(words_c1[-8:]).intersection(set(words_c2[:12]))
        assert len(common_words) > 0, f"No overlap found between chunk {i} and {i+1}"


# ---------------------------------------------------------------------------
# 5. Metadata Attachment Tests
# ---------------------------------------------------------------------------

def test_metadata_fields_attached_correctly():
    chunker = TextChunker(chunk_size=500, chunk_overlap=50)
    text = "Enterprise Knowledge Intelligence metadata attachment test."

    chunks = chunker.chunk_text(
        text=text,
        document_id="doc_meta_123",
        knowledge_base_id="kb_legal_456",
        organization_id="org_acme_corp",
        department="Legal",
        filename="contract_nda_2026.pdf",
        page_count=1,
        custom_metadata={"confidentiality": "strictly_confidential", "author": "Alice"},
    )

    assert len(chunks) == 1
    c = chunks[0]

    assert c.metadata["document_id"] == "doc_meta_123"
    assert c.metadata["knowledge_base_id"] == "kb_legal_456"
    assert c.metadata["organization_id"] == "org_acme_corp"
    assert c.metadata["department"] == "Legal"
    assert c.metadata["filename"] == "contract_nda_2026.pdf"
    assert c.metadata["chunk_index"] == 0
    assert c.metadata["total_chunks"] == 1
    assert c.metadata["confidentiality"] == "strictly_confidential"
    assert c.metadata["author"] == "Alice"
    assert c.page_number == 1
    assert c.metadata["start_page"] == 1
    assert c.metadata["end_page"] == 1


# ---------------------------------------------------------------------------
# 6. Page Tracking Tests (Explicit Form Feed & Interpolated)
# ---------------------------------------------------------------------------

def test_page_tracking_with_form_feed():
    chunker = TextChunker(chunk_size=20, chunk_overlap=5)
    # 3 distinct pages separated by standard \f
    p1 = "First page content covering executive overview of enterprise platform architecture and roadmap."
    p2 = "Second page content covering detailed financial analysis, budget allocation, and revenue projections."
    p3 = "Third page content covering regulatory compliance certifications, security audit results, and appendices."
    text_with_ff = f"{p1}\f{p2}\f{p3}"

    chunks = chunker.chunk_text(
        text=text_with_ff,
        document_id="doc_ff",
        knowledge_base_id="kb_ff",
    )

    assert len(chunks) >= 3
    # First chunk should be on page 1
    assert chunks[0].page_number == 1
    # Last chunk should be on page 3
    assert chunks[-1].page_number == 3


def test_interpolated_page_tracking_with_page_count():
    chunker = TextChunker(chunk_size=40, chunk_overlap=10)
    long_doc = " ".join([f"Sentence number {i} providing detailed documentation." for i in range(50)])

    chunks = chunker.chunk_text(
        text=long_doc,
        document_id="doc_interpolated",
        knowledge_base_id="kb_interpolated",
        page_count=5,
    )

    assert len(chunks) >= 3
    pages = [c.page_number for c in chunks]
    # Page numbers should progress from 1 up to 5
    assert pages[0] == 1
    assert pages[-1] <= 5
    assert pages[-1] >= pages[0]


# ---------------------------------------------------------------------------
# 7. Repeated Processing & Idempotency Tests
# ---------------------------------------------------------------------------

def test_repeated_processing_is_deterministic_and_idempotent():
    chunker = TextChunker(chunk_size=30, chunk_overlap=8)
    sample_text = (
        "Idempotency is a crucial requirement for enterprise knowledge systems. "
        "When an indexing pipeline is re-run due to network retries or system restarts, "
        "the resulting chunk identifiers and chunk boundaries must match the previous run exactly. "
        "This ensures that downstream vector databases do not accumulate orphan chunks or duplicates."
    )

    # First run
    chunks_run_1 = chunker.chunk_text(
        text=sample_text,
        document_id="doc_idempotent",
        knowledge_base_id="kb_test",
        filename="test.txt",
    )

    # Second run
    chunks_run_2 = chunker.chunk_text(
        text=sample_text,
        document_id="doc_idempotent",
        knowledge_base_id="kb_test",
        filename="test.txt",
    )

    assert len(chunks_run_1) == len(chunks_run_2)
    assert len(chunks_run_1) > 1

    for c1, c2 in zip(chunks_run_1, chunks_run_2):
        assert c1.chunk_id == c2.chunk_id, "Chunk IDs must be completely stable across repeated runs"
        assert c1.text == c2.text, "Chunk texts must be identical"
        assert c1.token_count == c2.token_count, "Token counts must be identical"
        assert c1.start_char == c2.start_char
        assert c1.end_char == c2.end_char
        assert c1.metadata == c2.metadata


# ---------------------------------------------------------------------------
# 8. Tokenizer Strategy & Validation Tests
# ---------------------------------------------------------------------------

def test_tokenizer_strategy_words_fallback():
    tok = Tokenizer(strategy="words")
    chunker = TextChunker(chunk_size=8, chunk_overlap=2, tokenizer=tok)
    text = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho Sigma Tau"
    chunks = chunker.chunk_text(
        text=text,
        document_id="doc_tok",
        knowledge_base_id="kb_tok",
    )
    assert len(chunks) > 1
    for c in chunks:
        assert c.token_count <= 8



def test_invalid_chunk_overlap_raises_error():
    with pytest.raises(ValueError, match="strictly less than"):
        TextChunker(chunk_size=100, chunk_overlap=100)

    with pytest.raises(ValueError, match="strictly less than"):
        TextChunker(chunk_size=100, chunk_overlap=120)

    with pytest.raises(ValueError, match="cannot be negative"):
        TextChunker(chunk_size=100, chunk_overlap=-5)

    with pytest.raises(ValueError, match="positive"):
        TextChunker(chunk_size=0, chunk_overlap=0)


# ---------------------------------------------------------------------------
# 9. FastAPI HTTP API Endpoint Tests
# ---------------------------------------------------------------------------

def test_api_chunk_document_endpoint_with_text():
    client = TestClient(app)
    payload = {
        "document_id": "doc_api_001",
        "knowledge_base_id": "kb_api_001",
        "text": "The Enterprise Knowledge Intelligence API provides high-performance text chunking.",
        "filename": "api_guide.md",
        "department": "Infrastructure",
        "organization_id": "org_global",
        "chunk_size": 800,
        "chunk_overlap": 120,
    }

    response = client.post(
        "/api/internal/documents/chunk",
        json=payload,
        headers={"x-api-key": settings.SERVICE_API_KEY},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["document_id"] == "doc_api_001"
    assert data["knowledge_base_id"] == "kb_api_001"
    assert data["total_chunks"] == 1
    assert len(data["chunks"]) == 1
    assert data["chunks"][0]["metadata"]["department"] == "Infrastructure"
    assert data["chunks"][0]["metadata"]["filename"] == "api_guide.md"


def test_api_chunk_document_unauthorized():
    client = TestClient(app)
    response = client.post(
        "/api/internal/documents/chunk",
        json={"document_id": "1", "knowledge_base_id": "2", "text": "hello"},
        headers={"x-api-key": "invalid_key"},
    )
    assert response.status_code in (401, 403)
