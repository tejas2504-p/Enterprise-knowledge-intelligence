# Text Chunking Engine: Architecture, Strategy & Tradeoffs

The **Enterprise Knowledge Intelligence Platform** employs a decoupled text chunking engine implemented within the Python AI service. This service processes extracted document texts into semantically coherent, token-budgeted chunks optimized for downstream vector retrieval and Retrieval-Augmented Generation (RAG).

---

## 1. System Architecture & Pipeline Integration

The platform maintains a strict separation of concerns between raw document extraction and AI/NLP processing:

```
+-------------------------------------------------------------+
|                     Node.js Backend                         |
|                                                             |
|  1. Upload Document (PDF, DOCX, TXT/MD)                     |
|  2. DocumentProcessingService extracts text & page count    |
|  3. Preserves paragraph/line structure                      |
|  4. Persists extractedText & metadata in MongoDB            |
|  5. Calls AI Service Client                                 |
+------------------------------+------------------------------+
                               |
            [Consumption Option A: HTTP Payload]
            [Consumption Option B: Direct Mongo Document ID]
                               |
                               v
+-------------------------------------------------------------+
|                     Python AI Service                       |
|                                                             |
|  Internal Service Interfaces:                               |
|   - POST /api/internal/documents/chunk                      |
|   - POST /api/internal/documents/{document_id}/chunk        |
|   - chunking_service.chunk_document_from_db(db, doc_id)     |
|                                                             |
|  Chunking Pipeline:                                         |
|   - Tokenizer (tiktoken cl100k_base / fallback)             |
|   - Hierarchical Boundary Partitioning                      |
|   - Sliding Window Token Accumulator with Overlap           |
|   - PageTracker & Exact Character Coordinate Resolver       |
|   - Deterministic Stable ID Generator                       |
|   - Metadata Enrichment                                     |
+-------------------------------------------------------------+
```

### Data Storage in MongoDB
In the `Document` collection:
- `extractedText` (`String`): The raw text extracted from uploaded files.
- `originalFileName` (`String`): The source file name.
- `pageCount` (`Number`): Total pages (for PDFs).
- `department` (`String`): Department ownership.
- `knowledgeBase` (`ObjectId`): Reference to `KnowledgeBase`.
- `metadata` (`Mixed`): Custom enterprise metadata attributes.

In the `KnowledgeBase` collection:
- `organization` (`String`): Multi-tenant organization identifier.
- `department` (`String`): Default department.

The AI service consumes this data either by direct HTTP payload or by querying MongoDB directly via `chunk_document_from_db(db, document_id)`. **Document extraction is never duplicated.**

---

## 2. Chunking Strategy & Algorithms

### 2.1 Configurable Defaults
- **Default Chunk Size**: `800` tokens (adjustable via environment variable `CHUNK_SIZE` or runtime payload).
- **Default Chunk Overlap**: `120` tokens (15% overlap window, adjustable via `CHUNK_OVERLAP`).
- **Minimum Chunk Size**: `20` tokens (avoids orphan fragments).
- **Validation**: Enforces `0 <= chunk_overlap < chunk_size` and `chunk_size > 0`.

### 2.2 Hierarchical Separator Cascade
Text is recursively partitioned using a prioritized hierarchy of structural and semantic boundaries:

1. **Page Breaks (`\f`)**: Preserves document pagination emitted by PDF extractors.
2. **Paragraph Breaks (`\n\n`, `\r\n\r\n`)**: Retains complete paragraphs as semantic units.
3. **Line Breaks (`\n`, `\r\n`)**: Preserves lists, code snippets, and poetry/tabular layouts.
4. **Sentence Endings (`. `, `! `, `? `, `; `)**: Ensures sentences are never severed mid-thought.
5. **Clause Delimiters (`, `, ` - `, `: `)**: Splits compound sentences when sentences exceed token budget.
6. **Word Boundaries (` `)**: Splits clauses into individual words.
7. **Character Fallback (`""`)**: Handles unbroken strings (long URLs, hexadecimal hashes) without overflow.

All delimiters are retained during segmentation to guarantee **no meaningful text is silently discarded**.

### 2.3 Sliding Window Accumulation with Boundary-Aware Overlap
- Segments are packaged iteratively into a chunk until adding the next segment would exceed `chunk_size` tokens.
- For consecutive chunks, the overlap text is calculated using `tokenizer.get_overlap_text(chunk_text, chunk_overlap)`.
- The overlap window scans backwards for clean sentence boundaries (`. `, `! `, `? `) or word boundaries, preventing chunks from starting with fragmented words or broken syntax.

### 2.4 Page Tracking & Source Location
- **Exact Coordinates**: Every chunk records `start_char` and `end_char` within the complete document text.
- **Explicit Page Detection**: `PageTracker` scans for `\f` (form feed characters) and marker headers (e.g. `[Page 1]`).
- **Interpolated Page Detection**: When explicit page breaks are absent but `page_count` is provided from MongoDB, page numbers are interpolated proportionally:
  $$\text{page} = \min\left(\text{page\_count}, \left\lfloor\frac{\text{start\_char}}{\text{text\_len}} \times \text{page\_count}\right\rfloor + 1\right)$$
- Each chunk metadata carries:
  - `page_number`: Primary page of the chunk's new content.
  - `start_page`: First page covered by the chunk.
  - `end_page`: Last page covered by the chunk.

### 2.5 Deterministic Stable Identifiers (Idempotency)
Each chunk is assigned a deterministic identifier:
$$\text{chunk\_id} = \{\text{document\_id}\}\_\text{c}\{\text{chunk\_index:04d}\}\_\{\text{sha256(chunk\_text)[:8]}\}$$

*Example*: `670f1a2b3c4d5e6f7a8b9c0d_c0003_a1b2c3d4`

**Idempotency Guarantee**:
Reprocessing the same document with identical text and configuration yields the exact same chunk count, identical chunk texts, matching token counts, and identical chunk IDs. Downstream vector indices can safely upsert without duplicate point sprawl.

### 2.6 Metadata Enrichment
Every chunk is enriched with:
- `document_id`: Source document identifier.
- `knowledge_base_id`: Associated knowledge base.
- `organization_id`: Multi-tenant organization identifier (if available).
- `department`: Department ownership.
- `filename`: Original document filename.
- `chunk_index`: 0-indexed position within the document.
- `total_chunks`: Total chunks generated for the document.
- `token_count`: Accurate BPE token count.
- `char_count`: Character length.
- `start_char` / `end_char`: 0-indexed character offsets.
- `page_number` / `start_page` / `end_page`: Source location pagination.
- `custom_metadata`: Preserved custom key-value pairs.

---

## 3. Tradeoffs Analysis

| Strategy Dimension | Chosen Approach | Alternative | Tradeoffs & Justification |
| :--- | :--- | :--- | :--- |
| **Chunk Size** | **800 Tokens** | 200–300 Tokens | **800 tokens** captures full paragraphs, code blocks, and multi-step procedures with rich contextual integrity for modern LLMs (context windows $\ge 8\text{k}$). Small chunks (200 tokens) fragment ideas and require higher retrieval $K$, while 800 tokens strikes the optimal balance between specificity and complete context. |
| **Chunk Overlap** | **120 Tokens (15%)** | 0% or $\ge 30\%$ | Overlap prevents boundary information loss where a crucial fact spans across two chunks. **15% (120 tokens)** is sufficient to bridge sentence context without inflating vector storage and embedding costs by more than 15–20%. |
| **Tokenization** | **BPE (`tiktoken cl100k_base`) with Regex Fallback** | Pure Character Length (`len(text)`) | Character counting assumes 1 token $\approx$ 4 characters, which can deviate by 30–50% on technical text, code, or non-English scripts. `tiktoken` ensures strict compliance with embedding model limits, while the regex fallback prevents hard failures in air-gapped environments. |
| **Boundary Strategy** | **Hierarchical Semantic Cascade** | Fixed Token Window | Fixed-size splitting chops sentences and words arbitrarily, harming embedding semantic coherence. The hierarchical cascade respects paragraph, line, sentence, and clause boundaries. |
| **Consumption Interface** | **Dual HTTP Payload + Direct MongoDB Access** | Pure HTTP or Pure DB polling | Providing both HTTP JSON payloads and direct MongoDB access (`/documents/{id}/chunk`) allows lightweight Node.js callers to avoid buffering large payloads while offering flexible standalone API testing. |

---

## 4. API Specification

### Endpoint: `POST /api/internal/documents/chunk`
**Headers**: `x-api-key: <SERVICE_API_KEY>`
**Request Body**:
```json
{
  "document_id": "doc_670f1a2b",
  "knowledge_base_id": "kb_finance_01",
  "text": "Extracted document text...",
  "filename": "q3_report.pdf",
  "department": "Finance",
  "organization_id": "org_enterprise",
  "page_count": 12,
  "chunk_size": 800,
  "chunk_overlap": 120
}
```

**Response Body**:
```json
{
  "status": "success",
  "document_id": "doc_670f1a2b",
  "knowledge_base_id": "kb_finance_01",
  "total_chunks": 3,
  "chunks": [
    {
      "chunk_id": "doc_670f1a2b_c0000_28fbc01e",
      "text": "Extracted document text segment...",
      "chunk_index": 0,
      "token_count": 782,
      "char_count": 3910,
      "start_char": 0,
      "end_char": 3910,
      "page_number": 1,
      "metadata": {
        "document_id": "doc_670f1a2b",
        "knowledge_base_id": "kb_finance_01",
        "organization_id": "org_enterprise",
        "department": "Finance",
        "filename": "q3_report.pdf",
        "chunk_index": 0,
        "total_chunks": 3,
        "token_count": 782,
        "char_count": 3910,
        "start_char": 0,
        "end_char": 3910,
        "page_number": 1,
        "start_page": 1,
        "end_page": 2
      }
    }
  ]
}
```

### Endpoint: `POST /api/internal/documents/{document_id}/chunk`
Queries MongoDB for the document by `_id`, retrieves `extractedText`, looks up associated `KnowledgeBase` for tenant and department context, and performs idempotent chunking.

---

## 5. Test Suite Verification

The chunking engine is thoroughly validated by `pytest` in `ai-service/tests/test_chunking.py`:
- `test_empty_text_returns_no_chunks`: Validates `""` and whitespace inputs.
- `test_short_text_single_chunk`: Validates single-chunk processing and metadata fidelity.
- `test_long_text_chunks_respect_token_limit_and_boundaries`: Confirms chunk size ceilings and semantic boundaries.
- `test_extremely_long_document_handles_without_recursion_limit`: Validates linear performance on large text (300+ paragraphs, 25k+ words).
- `test_overlap_continuity_between_consecutive_chunks`: Proves lexical and semantic continuity between sequential chunks.
- `test_metadata_fields_attached_correctly`: Asserts propagation of tenant, department, filename, and custom attributes.
- `test_page_tracking_with_form_feed`: Validates PDF `\f` page transitions.
- `test_interpolated_page_tracking_with_page_count`: Tests proportional page progression.
- `test_repeated_processing_is_deterministic_and_idempotent`: Proves identical chunk IDs and texts across multiple runs.
- `test_tokenizer_strategy_words_fallback`: Validates the regex word-based tokenizer fallback.
- `test_invalid_chunk_overlap_raises_error`: Enforces configuration bounds.
- `test_api_chunk_document_endpoint_with_text`: Validates FastAPI HTTP endpoint and API key auth.
- `test_chunk_document_from_db_consumption`: Verifies direct MongoDB consumption without raw file re-extraction.
