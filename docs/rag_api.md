# RAG Query API Specification

The Enterprise Knowledge Intelligence Platform provides a dedicated, high-performance Retrieval-Augmented Generation (RAG) query endpoint. It retrieves relevant, access-authorized document chunks from Qdrant vector storage, evaluates similarity thresholds, isolates untrusted document evidence, and invokes Google Gemini to produce factual, citation-grounded answers.

---

## 1. Endpoint Overview

- **Route:** `POST /api/rag/query`
- **Protected By:** Service-to-service API key (`x-api-key` header)
- **Content-Type:** `application/json`

### Authentication & Authorization Headers

| Header Name | Type | Required | Description |
|---|---|---|---|
| `x-api-key` | String | **Yes** | AI Service internal API key matching `SERVICE_API_KEY`. |
| `x-user-context-token` | String | **Yes** | HMAC-SHA256 signed server context (`user_id`, `role`, `department`, `organization_id`, `exp`) generated exclusively by the Node.js backend from the verified JWT user session. |

> [!IMPORTANT]
> **Browser-facing Node.js Gateway (`POST /api/rag/query`, `POST /api/chat`, `GET /api/conversations`)**:
> Clients authenticate strictly via Node.js JWT cookies / `Authorization: Bearer <token>`. Node.js verifies KB & document access before forwarding the signed `x-user-context-token` to Python. Service keys and LLM credentials are never sent to the browser.

---

## 2. Request Schema

### Schema Definition (`RagQueryRequest`)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `question` | `string` | **Yes** | — | User's question or search query (must be non-empty, min length 1, max length 4000). |
| `knowledgeBaseId` | `string` | **Yes** | — | Target knowledge base identifier to query within. |
| `conversationId` | `string` | Optional | `None` | Optional client or session conversation tracker for logging or multi-turn reference. |
| `conversation_history` | `array` | Optional | `[]` | Optional bounded list of prior turns (`{ "role": "user" \| "assistant", "content": "..." }`) used to resolve follow-up questions (automatically forwarded by Node.js when continuing a `conversationId`). |
| `enable_query_understanding` | `boolean` | Optional | `True` | Optional override for Phase 4 query analysis, rewriting, and multi-query fusion. |
| `top_k` | `integer` | Optional | `5` | Maximum number of chunks to feed into the generation prompt (1 to 20). |
| `similarity_threshold` | `float` | Optional | `0.65` | Minimum cosine similarity score (0.0 to 1.0) required for a chunk to be considered evidence. |

### Sample Request Payload

```json
{
  "question": "What is the company policy regarding password rotation?",
  "knowledgeBaseId": "65b91a24e2c81d0012345678",
  "conversationId": "conv_abc123",
  "top_k": 5,
  "similarity_threshold": 0.65
}
```

---

## 3. Response Schema

### Schema Definition (`RagQueryResponse`)

```json
{
  "answer": "string",
  "citations": [
    {
      "document_id": "string",
      "filename": "string",
      "chunk_id": "string",
      "page_number": 1,
      "excerpt": "string",
      "score": 0.8421
    }
  ],
  "metadata": {
    "knowledge_base_id": "string",
    "chunks_retrieved": 5,
    "chunks_used": 2,
    "model": "gemini-2.5-flash",
    "similarity_threshold": 0.65,
    "insufficient_evidence": false
  },
  "conversationId": "string"
}
```

### Field Definitions

#### Root Object

- `answer` (*string*): The synthesized answer grounded exclusively in retrieved evidence, or the standardized insufficient evidence statement if unanswerable.
- `citations` (*array of Citation*): List of verified, non-fabricated citations corresponding to the chunks used as evidence.
- `metadata` (*RagRetrievalMetadata*): Execution telemetry including chunk counts, model used, and evidence status.
- `conversationId` (*string, optional*): Echoed conversation ID from the request.

#### `Citation` Object

- `document_id` (*string*): MongoDB document `_id` owning the chunk.
- `filename` (*string*): Original filename (e.g., `Security_Policy_2026.pdf`).
- `chunk_id` (*string*): Stable, deterministic chunk identifier (e.g., `chunk_003`).
- `page_number` (*integer or null*): Source page number if available from the document processor.
- `excerpt` (*string*): Concise, most relevant excerpt from the source chunk text.
- `score` (*float*): Cosine similarity score between the query and the chunk vector (rounded to 4 decimal places).

#### `RagRetrievalMetadata` Object

- `knowledge_base_id` (*string*): Targeted knowledge base ID.
- `chunks_retrieved` (*integer*): Total candidates returned by Qdrant before threshold filtering.
- `chunks_used` (*integer*): Surviving chunks meeting or exceeding the similarity threshold.
- `model` (*string*): The generation model name (e.g., `gemini-2.5-flash`).
- `similarity_threshold` (*float*): The effective similarity threshold applied.
- `insufficient_evidence` (*boolean*): True if retrieval returned 0 qualifying chunks or if the LLM flagged lack of supporting evidence.

---

## 4. Pipeline Architecture & Security Directives

```
                                      POST /api/rag/query
                                               │
                                       [1. Validate Request]
                                               │
                                  [2. Verify Knowledge Base Access]
                                    (Checks Org ID & User ID RBAC)
                                               │
                                   [3. Query Embedding Generation]
                                  (text-embedding-004 / RETRIEVAL_QUERY)
                                               │
                                  [4. Filtered Vector Search]
                                (Qdrant: kb_id + org_id boundaries)
                                               │
                                   [5. Retrieve Candidate Chunks]
                                               │
                              [6. Threshold & Top-K Filtering]
                                (score >= similarity_threshold)
                                         /           \
                           (chunks == 0)/             \(chunks > 0)
                                       /               \
              [7a. Fast Insufficient Evidence]     [7b. Construct Untrusted Evidence Context]
              (Returns immediately; NO LLM call)   (Isolates text in <untrusted_evidence>)
                                                               │
                                                   [8. Gemini Generation]
                                                  (Strict Anti-Injection System Prompt)
                                                               │
                                                   [9. Assemble Citations & Return]
```

### Security Directives

1. **Untrusted Data Boundary & Anti-Injection**:
   - Retrieved document chunks are strictly treated as **untrusted data**, never instructions.
   - Evidence is encapsulated inside `<untrusted_evidence>...</untrusted_evidence>` XML boundaries in the prompt.
   - The system instructions explicitly forbid the model from executing commands, evaluating code, or altering its operational persona based on text found inside evidence chunks.

2. **Mandatory Authorization Filters**:
   - Vector searches in Qdrant are constrained by `knowledge_base_ids` and `organization_id` filter conditions.
   - Documents cannot be accessed cross-tenant or across private boundaries.
   - Access verification occurs **before** vector retrieval, preventing vector enumeration or timing-based data leakage.

3. **Grounded Citations (No Hallucinations)**:
   - The model is instructed: `"Every factual claim must cite its source document using [Doc: <filename>, Page: <page>] notation."`
   - Citations returned in the JSON payload are derived directly from the verified surviving chunks.
   - If the retrieved context does not contain the answer, the system returns:
     `"I do not have sufficient evidence in the provided documents to answer this question."`
   - If 0 chunks survive the similarity threshold, the pipeline returns this message immediately without incurring LLM API latency or cost.

4. **Redaction & Privacy**:
   - No API keys, credentials, or sensitive chunk contents are output in general logs.
   - Internal chain-of-thought or provider-hidden reasoning is excluded from the client response.

---

## 5. Configuration Options

Set the following environment variables in `ai-service/.env`:

| Variable | Default | Description |
|---|---|---|
| `GEMINI_GENERATION_MODEL` | `gemini-2.5-flash` | Supported Google Gen AI text generation model. |
| `RAG_TOP_K` | `5` | Default number of evidence chunks passed to the LLM. |
| `RAG_SIMILARITY_THRESHOLD` | `0.65` | Default minimum cosine similarity score. |
| `RAG_TEMPERATURE` | `0.0` | Sampling temperature (0.0 for maximum determinism). |
| `RAG_MAX_OUTPUT_TOKENS` | `2048` | Maximum tokens in the generated response. |
| `RAG_GENERATION_TIMEOUT` | `30.0` | Timeout in seconds for LLM generation API calls. |
| `QUERY_UNDERSTANDING_ENABLED` | `true` | Enable/disable Phase 4 query analysis and rewriting inside `/api/rag/query`. |
| `QUERY_UNDERSTANDING_MODEL` | `null` | Optional model override for query understanding (falls back to `GEMINI_GENERATION_MODEL`). |
| `QUERY_UNDERSTANDING_TIMEOUT` | `15.0` | Timeout in seconds for Gemini query analysis calls. |
| `QUERY_UNDERSTANDING_MAX_TOKENS` | `768` | Max JSON tokens for structured query understanding output. |
| `QUERY_MAX_ALTERNATIVE_QUERIES` | `3` | Maximum alternative search queries generated per query. |
| `QUERY_MAX_SUB_QUERIES` | `4` | Maximum decomposed sub-questions for multi-part queries. |
| `QUERY_MAX_HISTORY_TURNS` | `6` | Maximum conversation turns forwarded for follow-up resolution. |
| `AI_SERVICE_API_KEY` | `dev_internal_ai_secret_key_change_in_production` | Internal service auth key. |

---

## 6. Phase 4 Query Understanding & Rewriting (`POST /api/rag/analyze-query`)

Both Node.js and the protected Python AI Service expose a standalone endpoint to inspect query understanding without generating an answer:

- **Endpoint:** `POST /api/rag/analyze-query`
- **Request:**
  ```json
  {
    "question": "And how often does it apply?",
    "knowledgeBaseId": "65b91a24e2c81d0012345678",
    "conversationId": "conv_abc123"
  }
  ```
- **Response (`QueryUnderstandingResult`):**
  - `original_question`: Always preserved untouched for downstream answer generation.
  - `analysis`: `intent` (`factual_lookup`, `procedural`, `comparison`, `summarization`, `multi_part`, `follow_up`, `ambiguous`, `out_of_scope`), `keywords`, `entities`, `is_ambiguous`, `ambiguity_reason`, `clarification_needed`, `suggested_clarifications`, `is_multi_part`, `sub_questions`, `is_follow_up`, `requires_context_resolution`, `is_clear_standalone`.
  - `rewrite`: `primary_retrieval_query` (kept identical to `original_question` when already clear), `alternative_queries`, `sub_queries`, `was_rewritten`, `rewrite_strategy` (`unchanged` | `contextualized` | `clarified` | `decomposed` | `expanded`).
  - `retrieval_queries`: Deduplicated queries sent to embedding and Qdrant vector retrieval.
  - **Safeguards:** Never generates answers, suppresses internal chain-of-thought (`thinking_budget=0` and no reasoning schema fields), enforces KB and conversation ownership before loading context, and falls back deterministically (`fallback_used=true`) if Gemini is unavailable.

---

## 7. Testing & Usage Examples

### Example: Calling via cURL

```bash
curl -X POST "http://localhost:8000/api/rag/query" \
  -H "Content-Type: application/json" \
  -H "x-api-key: dev_internal_ai_secret_key_change_in_production" \
  -H "x-organization-id: org_alpha" \
  -H "x-user-id: usr_test123" \
  -d '{
    "question": "What is the remote work policy?",
    "knowledgeBaseId": "kb_corporate_handbook",
    "top_k": 3,
    "similarity_threshold": 0.60
  }'
```

### Example: Calling via Python (httpx)

```python
import httpx

response = httpx.post(
    "http://localhost:8000/api/rag/query",
    headers={
        "x-api-key": "dev_internal_ai_secret_key_change_in_production",
        "x-organization-id": "org_alpha",
    },
    json={
        "question": "What are our compliance requirements for data retention?",
        "knowledgeBaseId": "kb_compliance",
        "similarity_threshold": 0.70,
    },
    timeout=30.0,
)

data = response.json()
print("Answer:", data["answer"])
print("Citations:", [c["filename"] for c in data["citations"]])
```
