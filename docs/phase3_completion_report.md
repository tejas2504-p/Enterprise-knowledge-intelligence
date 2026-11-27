# Phase 3 Technical Review & Completion Report

**Platform:** Enterprise Knowledge Intelligence Platform  
**Status:** Verified & Complete (with documented test/eval harness scopes)  

---

## 1. Phase 3 Architecture

```
+-------------------------------------------------------------------------+
| React Frontend (Vite + Tailwind + React Router)                         |
| - Pages: /assistant (AiAssistant.jsx), CitationCard, CitationDetailModal|
| - Auth: HttpOnly JWT cookie / Bearer session via Axios (withCredentials)|
+------------------------------------+------------------------------------+
                                     | HTTPS / JSON (NO AI keys or secrets)
                                     v
+-------------------------------------------------------------------------+
| Node.js Backend Gateway (Express 5 + Mongoose)                          |
| - JWT Auth middleware (protect) populates verified req.user             |
| - Pre-retrieval RBAC (accessControl.js): KB & Document visibility       |
| - HMAC-SHA256 User Context Signer (x-user-context-token, 60s TTL)       |
| - Conversation Persistence (Conversation.js) & Citation Filtering       |
+------------------------------------+------------------------------------+
                                     | Internal Service Auth (x-api-key +
                                     | HMAC x-user-context-token)
                                     v
+-------------------------------------------------------------------------+
| Python AI Service (FastAPI)                                             |
| - Token-aware Chunker (TextChunker: tiktoken/words + PageTracker)       |
| - Embedding Service (GeminiEmbeddingService + SHA-256 EmbeddingCache)   |
| - Vector Store Service (Qdrant: Cosine, UUIDv5 IDs, pre-retrieval ACL)  |
| - Generation Service (GeminiGenerationService + <untrusted_evidence>)   |
| - Anti-Fabrication Citation Guard ([Evidence N] bounds validation)      |
+-------------------+----------------------------------+------------------+
                    |                                  |
                    v                                  v
+------------------------------------+  +---------------------------------+
| Qdrant Vector DB                   |  | Google Gen AI SDK               |
| - Filtered by organization_id,     |  | - text-embedding-004 (768-dim)  |
|   knowledge_base_id, document_ids  |  | - gemini-2.5-flash (temp=0.0)   |
+------------------------------------+  +---------------------------------+
```

### End-to-End Ingestion & Query Flow

1. **Upload & Text Extraction (Phase 2)**: File uploaded to `POST /api/knowledge-bases/:knowledgeBaseId/documents` -> `documentProcessingService.processDocument()` extracts PDF/DOCX/TXT/Markdown text, saves `extractedText`, `pageCount`, `wordCount`, and sets `processingStatus: 'processed'`.
2. **Ingestion (Phase 3)**: Node triggers `indexDocumentInAI()` -> `POST /api/internal/documents/index` -> `TextChunker` splits into ~800-token chunks with 120-token overlap -> `GeminiEmbeddingService` embeds uncached chunks in batches with bounded exponential backoff -> `VectorStoreService.reindex_document()` purges stale points and idempotently upserts deterministic UUIDv5 points into Qdrant -> updates `indexingStatus: 'indexed'`, `indexedAt`, and `chunksCount`.
3. **RAG Query**: User submits question on `/assistant` -> Node.js `POST /api/rag/query` verifies JWT, KB access (`canUserViewKB`), archived check, and conversation ownership -> forwards HMAC-signed user context to Python `POST /api/rag/query` -> Python validates `x-api-key` + `x-user-context-token`, re-verifies KB & readable documents, embeds query (`RETRIEVAL_QUERY`), searches Qdrant with mandatory authorization filters, applies `similarity_threshold` & `top_k`, encapsulates surviving chunks in `<untrusted_evidence>` tags, calls Gemini generation (`temperature=0.0`), validates `[Evidence N]` citations against retrieved chunks, and returns structured citations -> Node.js double-filters citations against authorized MongoDB documents, persists conversation turn, and returns JSON to React.

---

## 2. API Endpoints

### Node.js Backend (`server/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/rag/query` | JWT (`protect`) | Execute access-controlled RAG query & persist conversation turn |
| `POST` | `/api/chat` | JWT (`protect`) | Legacy chat route delegating to unified `ragController.queryRag` |
| `GET` | `/api/conversations` | JWT (`protect`) | List authenticated user's conversation history (optional `knowledgeBaseId`) |
| `GET` | `/api/conversations/:id` | JWT (`protect`) | Fetch conversation messages & citations (checks owner & KB/doc permissions) |
| `DELETE` | `/api/conversations/:id` | JWT (`protect`) | Delete user's own conversation |
| `POST` | `/api/documents/:id/index` | JWT (`protect`) | Re-index an already processed document without re-extracting file |
| `POST` | `/api/documents/batch-index` | JWT (`protect`) | Batch index multiple authorized processed documents |
| `POST` | `/api/knowledge-bases/:id/index` | JWT (`protect`) | Trigger batch indexing for all processed docs in a Knowledge Base |

### Python AI Service (`ai-service/`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/rag/query` | `x-api-key` + signed `x-user-context-token` | Execute 9-step RAG pipeline with KB/document RBAC & citation checks |
| `POST` | `/api/internal/chat` | `x-api-key` + signed `x-user-context-token` | Legacy adapter delegating strictly through `rag_query_service` |
| `POST` | `/api/internal/documents/index` | `x-api-key` | Chunk, embed, and idempotently index single document |
| `POST` | `/api/internal/documents/batch-index` | `x-api-key` | Batch ingest with partial failure handling |
| `POST` | `/api/internal/documents/{id}/index` | `x-api-key` | Index existing processed document from MongoDB (`404` if missing) |
| `POST` | `/api/internal/documents/chunk` | `x-api-key` | Standalone reusable chunking service |
| `DELETE` | `/api/internal/documents/{id}` | `x-api-key` | Purge all vector points belonging to document |
| `DELETE` | `/api/internal/knowledge-bases/{id}` | `x-api-key` | Purge all vector points belonging to entire knowledge base |

---

## 3. Environment Variables

### Client (`client/.env`)
- `VITE_API_URL`: Node.js API base URL (default: `http://localhost:5000/api` or `/api` via Vite proxy).

### Node.js Server (`server/.env`)
- `PORT`: API server port (default `5000`).
- `NODE_ENV`: Runtime mode (`development` / `production` / `test`).
- `MONGODB_URI`: MongoDB connection string.
- `JWT_SECRET`: Secret for signing/verifying browser JWT session tokens.
- `SERVICE_API_KEY`: Shared secret used for `x-api-key` and HMAC-SHA256 `x-user-context-token` signing.
- `AI_SERVICE_URL`: Python internal API URL (default `http://localhost:8000/api/internal`).
- `AI_RAG_URL` *(optional)*: Explicit Python RAG API URL (defaults to `AI_SERVICE_URL` origin + `/api/rag`).

### Python AI Service (`ai-service/.env`)
- `SERVICE_API_KEY`: Shared internal API & HMAC context verification secret.
- `MONGODB_URI`: MongoDB connection string (connected via `get_default_database(default="test")`).
- `GEMINI_API_KEY`: Google Gemini API key (server-side only).
- `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / `EMBEDDING_DIMENSION`: Defaults to `gemini`, `text-embedding-004`, `768`.
- `EMBEDDING_BATCH_SIZE` / `EMBEDDING_TIMEOUT` / `EMBEDDING_MAX_RETRIES`: Defaults `64`, `30.0s`, `4`.
- `GEMINI_GENERATION_MODEL`: Defaults to `gemini-2.5-flash`.
- `RAG_TOP_K` / `RAG_SIMILARITY_THRESHOLD` / `RAG_TEMPERATURE` / `RAG_MAX_OUTPUT_TOKENS` / `RAG_GENERATION_TIMEOUT` / `RAG_GENERATION_MAX_RETRIES`: Defaults `5`, `0.65`, `0.0`, `2048`, `30.0s`, `2`.
- `QDRANT_URL` / `QDRANT_API_KEY` / `QDRANT_LOCAL_PATH` / `QDRANT_COLLECTION_NAME` / `QDRANT_DISTANCE` / `QDRANT_TIMEOUT`: Qdrant connection & collection configuration.
- `CHUNK_SIZE` / `CHUNK_OVERLAP` / `CHUNK_MIN_SIZE` / `TOKENIZER_STRATEGY` / `TIKTOKEN_ENCODING`: Defaults `800`, `120`, `20`, `tiktoken`, `cl100k_base`.

---

## 4. Security Hardening Verified During Phase 3 Review

Findings identified and resolved during the technical audit:
1. **Closed unauthenticated `/api/internal/chat` bypass**: Protected `/api/internal/chat` with `get_verified_user_context` and routed it through `rag_query_service.execute_query`.
2. **Removed HTTP stack trace & secret leakage**: Updated `server/src/middleware/errorMiddleware.js` so `err.stack` is never returned in JSON responses regardless of `NODE_ENV`, and sanitized server console logs and HTTP error messages. Added a global 500 exception handler in `ai-service/main.py` and expanded `sanitize_error_message` across `vector_store.py`, `rag_query_service.py`, `generation_service.py`, and `routes.py` to redact `GEMINI_API_KEY`, `QDRANT_API_KEY`, `SERVICE_API_KEY`, Bearer tokens, and URI passwords.
3. **Anti-Fabrication Citation Guard**: Added `[Evidence N]` bounds verification in `rag_query_service.py` (strips out-of-range markers; rejects answers relying solely on fabricated citations; clears citations when insufficient evidence is returned) and strict `authorizedDocMap` membership validation in `server/src/controllers/ragController.js`.
4. **Incorrect Document ID & Resilience Handling**: Missing MongoDB document IDs on `/api/internal/documents/{id}/index` now raise `DocumentNotFoundError` (`404` instead of `200`), and failure modes map cleanly (`429` rate limit, `504` timeout, `503` Qdrant unavailable, `422`/`502` invalid dimensions/provider failure).
5. **MongoDB Database Alignment**: Updated `ai-service/main.py` to use `get_default_database(default="test")` so Python connects to the same database as Mongoose when URI omits a path.

---

## 5. Tests Executed & Observed Results

| Component | Command | Suites / Tests | Scope & Notes |
|---|---|---|---|
| **Python AI Service** | `..\.venv\Scripts\pytest.exe tests/ -v -s` | **68 passed** | `test_chunking.py` (16), `test_embeddings.py` (14), `test_ingestion_pipeline.py` (6), `test_rag.py` (1), `test_rag_pipeline.py` (10), `test_vector_store.py` (13), `test_phase3_review.py` (8). Uses Qdrant `:memory:` and mocked Gemini/MongoDB clients. |
| **Node.js Backend** | `npx cross-env NODE_OPTIONS=--experimental-vm-modules jest tests/knowledgeBaseApi.test.js tests/knowledgeBaseModel.test.js tests/ragApi.test.js tests/phase3E2EReview.test.js --forceExit` | **4 suites, 71 passed** | Unit & Supertest API tests with mocked Mongoose models and `aiClient`/`ragClient` (`knowledgeBaseModel.test.js` 18, `knowledgeBaseApi.test.js` 35, `ragApi.test.js` 13, `phase3E2EReview.test.js` 5). *Note: `tests/api.test.js` requires live MongoDB Atlas connectivity and was not executed offline.* |
| **React Frontend** | `npm test` (`vitest run`) | **1 file, 7 passed** | [AiAssistant.test.jsx](file:///c:/Users/tejas/OneDrive/文件/Projects/enterprise-knowledge-intelligence/client/src/pages/assistant/__tests__/AiAssistant.test.jsx) using mocked Axios (`api`) responses covering empty KBs, unindexed/processing docs, query submission, loading, citations, clickable detail modal, `403` error handling, and conversation history. |
| **React Lint & Build** | `npm run lint` (`oxlint`), `npm run build` (`vite build`) | **0 errors** | Build succeeded (`dist/index.html`, JS & CSS bundles generated). |

---

## 6. Quality & Performance Benchmark Results

Executed via `test_phase3_retrieval_citation_faithfulness_and_performance_evaluation` inside `ai-service/tests/test_phase3_review.py` over a 4-document multi-topic corpus in Qdrant `:memory:` and 6 labeled queries (4 answerable, 2 unanswerable), using deterministic stopword-filtered 768-dim BoW projection embeddings and a faithful deterministic synthesizer (offline harness without live Gemini API latency/embeddings):

- **Retrieval Relevance (`Recall@3`)**: `1.00` (4/4 answerable queries retrieved expected ground-truth document)
- **Mean Reciprocal Rank (`MRR@3`)**: `1.00`
- **Citation Accuracy**: `1.00` (4/4 top citations matched expected `document_id` with non-empty source excerpt)
- **Answer Faithfulness (key-fact match)**: `1.00`
- **Out-of-Scope / Unanswerable Refusal Rate**: `1.00` (2/2 out-of-scope queries rejected with `insufficient_evidence=True`, `citations=[]`)
- **Ingestion Latency (4 docs chunk + embed + Qdrant `:memory:` upsert)**: `28.5 ms` (excluding external network/API latency)
- **Large Document Chunking Latency (~50 KB, 600 paragraphs, `tiktoken`)**: `48.3 ms`

---

## 7. Known Limitations & Failure Modes

1. **In-Memory Embedding Cache (`EmbeddingCache`)**: Currently single-process in-memory (`max_size=10000`). Cache resets on worker restart and is not shared across horizontal Python replicas.
2. **Legacy Non-Sync `Document.find` Filter Scaling**: Qdrant `document_ids` (`MatchAny`) pre-filtering works efficiently up to medium-sized Knowledge Bases; KBs with >5,000 documents should store document visibility/owner fields directly in Qdrant payloads so ACL filtering runs natively without passing large `document_ids` lists.
3. **Multi-Turn Coreference**: Node.js stores full conversation messages in MongoDB (`Conversation`), while `RagQueryRequest` currently retrieves vectors using the standalone current `question` without query rewriting/coreference resolution over prior turns.
4. **Offline Evaluation Harness**: Automated quality benchmarks validate chunking, Qdrant cosine filtering, threshold logic, and citation integrity deterministically without live `GEMINI_API_KEY` API calls; live semantic recall/latency should be benchmarked once staging keys are provisioned.
5. **Vector/DB Consistency Window**: Transient failures during asynchronous Phase 3 ingestion after Phase 2 extraction keep `processingStatus: 'processed'` and mark `indexingStatus: 'failed'`, requiring manual/scheduled retry via `/api/documents/:id/index`.

---

## 8. Recommended Next Phase (Phase 4)

1. **Live Hybrid Retrieval & Reranking**: Combine dense Gemini embeddings with sparse keyword/BM25 (or Qdrant hybrid vectors) and cross-encoder reranking for higher precision on exact acronyms/IDs.
2. **Qdrant Payload ACL Sync**: Store `visibility`, `uploaded_by`, and `department` in Qdrant point payloads and sync metadata updates cleanly so very large KBs do not depend on `document_ids` allow-lists.
3. **Multi-Turn Query Contextualization & Streaming**: Add Server-Sent Events (SSE) token streaming from Gemini through Node.js to the React UI and bounded query condensation for follow-up questions.
4. **Distributed Cache & Async Job Queue**: Move ingestion jobs off background Promise catches into Redis/BullMQ (or Celery) with dead-letter retry and shared Redis embedding cache.
5. **Production Live E2E & Observability**: Provision staging `GEMINI_API_KEY` + managed Qdrant + Prometheus/OpenTelemetry tracing to evaluate real LLM faithfulness and token cost budgets.
