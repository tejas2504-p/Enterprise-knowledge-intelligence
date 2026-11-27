import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from app.core.config import settings
from app.core.security import sign_user_context_token
from app.models.query_understanding import (
    ConversationTurn,
    QueryIntent,
    QueryUnderstandingRequest,
    QueryUnderstandingResult,
)
from app.models.rag import RagQueryRequest
from app.prompts.query_understanding_prompts import (
    QUERY_UNDERSTANDING_SYSTEM_INSTRUCTION,
    build_query_understanding_prompt,
)
from app.services.query_understanding import (
    ContextAwareQueryProcessor,
    GeminiStructuredQuerySchema,
    IntentClassifier,
    QueryAnalyzer,
    QueryRewriter,
    QueryUnderstandingProviderError,
    QueryUnderstandingRateLimitError,
    QueryUnderstandingService,
    QueryUnderstandingTimeoutError,
    QueryUnderstandingValidationError,
)
from app.services.rag_query_service import RagQueryService
from app.services.vector_store import VectorSearchResult


def make_gemini_client_with_json(payload: dict):
    mock_client = MagicMock()
    mock_client.models.generate_content.return_value = SimpleNamespace(
        text=json.dumps(payload)
    )
    return mock_client


# -----------------------------------------------------------------------------
# 1. Intent Classification & Keyword/Entity Extraction Unit Tests
# -----------------------------------------------------------------------------

def test_intent_classifier_recognizes_intents_and_extracts_entities():
    kw, ent = IntentClassifier.extract_keywords_and_entities(
        "Is AES-256 or TLS 1.3 required by Security Engineering for Kubernetes clusters?"
    )
    assert "aes-256" in kw or "tls" in kw
    assert "kubernetes" in kw
    assert any("AES-256" in e or "TLS" in e for e in ent)
    assert any("Security Engineering" in e for e in ent)

    assert IntentClassifier.classify_heuristically("Compare OAuth2 vs SAML 2.0")["intent"] == QueryIntent.COMPARISON
    assert IntentClassifier.classify_heuristically("How do I configure VPN MFA setup?")["intent"] == QueryIntent.PROCEDURAL
    assert IntentClassifier.classify_heuristically("Summarize the Q3 compliance audit")["intent"] == QueryIntent.SUMMARIZATION
    assert IntentClassifier.classify_heuristically("hi!")["intent"] == QueryIntent.OUT_OF_SCOPE

    amb = IntentClassifier.classify_heuristically("the limit?", has_history=False)
    assert amb["is_ambiguous"] is True
    assert amb["intent"] == QueryIntent.AMBIGUOUS

    fup = IntentClassifier.classify_heuristically("How often does it apply?", has_history=True)
    assert fup["is_follow_up"] is True
    assert fup["intent"] == QueryIntent.FOLLOW_UP


# -----------------------------------------------------------------------------
# 2. Avoid Unnecessary Rewriting of Already-Clear Questions
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_clear_standalone_question_avoids_unnecessary_rewriting():
    question = "What TLS version is mandatory for production microservices?"

    # Even if LLM suggests a slightly paraphrased retrieval query while marking clear standalone,
    # QueryRewriter preserves the exact original question without unnecessary rewriting.
    client = make_gemini_client_with_json(
        {
            "intent": "factual_lookup",
            "secondary_intents": [],
            "keywords": ["TLS", "microservices", "mandatory", "production"],
            "entities": ["TLS"],
            "is_ambiguous": False,
            "clarification_needed": False,
            "suggested_clarifications": [],
            "is_multi_part": False,
            "sub_questions": [],
            "is_follow_up": False,
            "requires_context_resolution": False,
            "is_clear_standalone": True,
            "language": "en",
            "confidence": 0.96,
            "primary_retrieval_query": "Required TLS protocol version for production microservices",
            "alternative_queries": [],
            "was_rewritten": True,
            "rewrite_strategy": "expanded",
        }
    )

    service = QueryUnderstandingService(api_key="test_key", client=client)
    res = await service.process_query(QueryUnderstandingRequest(question=question))

    assert res.original_question == question
    assert res.analysis.intent == QueryIntent.FACTUAL_LOOKUP
    assert res.analysis.is_clear_standalone is True
    assert res.rewrite.primary_retrieval_query == question
    assert res.rewrite.was_rewritten is False
    assert res.rewrite.rewrite_strategy == "unchanged"
    assert res.retrieval_queries == [question]
    assert res.fallback_used is False


# -----------------------------------------------------------------------------
# 3. Ambiguous / Vague Query Detection & Clarifying Rewrite
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_ambiguous_vague_question_is_detected_and_clarified():
    question = "What is the retention rule?"

    client = make_gemini_client_with_json(
        {
            "intent": "ambiguous",
            "keywords": ["retention", "rule", "policy"],
            "entities": [],
            "is_ambiguous": True,
            "ambiguity_reason": "Missing data category (logs, backups, employee records, or financial files)",
            "clarification_needed": True,
            "suggested_clarifications": [
                "Are you asking about security audit log retention or employee HR records?",
                "Are you referring to customer database backup retention?",
            ],
            "is_multi_part": False,
            "sub_questions": [],
            "is_follow_up": False,
            "requires_context_resolution": False,
            "is_clear_standalone": False,
            "language": "en",
            "confidence": 0.88,
            "primary_retrieval_query": "data retention policy duration rules audit logs backups records",
            "alternative_queries": [
                "document retention schedule corporate compliance period",
                "log retention policy years",
            ],
            "was_rewritten": True,
            "rewrite_strategy": "clarified",
        }
    )

    service = QueryUnderstandingService(api_key="test_key", client=client)
    res = await service.process_query(QueryUnderstandingRequest(question=question))

    assert res.original_question == question
    assert res.analysis.is_ambiguous is True
    assert res.analysis.clarification_needed is True
    assert len(res.analysis.suggested_clarifications) == 2
    assert res.rewrite.was_rewritten is True
    assert res.rewrite.rewrite_strategy == "clarified"
    assert "audit logs" in res.rewrite.primary_retrieval_query
    assert len(res.rewrite.alternative_queries) == 2
    assert res.retrieval_queries[0] == res.rewrite.primary_retrieval_query


# -----------------------------------------------------------------------------
# 4. Multi-Part Question Support & Multi-Query Retrieval Fusion
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_multi_part_question_decomposed_and_fused_while_preserving_original():
    question = "What is the API key rotation schedule and what encryption algorithm is required at rest?"

    client = make_gemini_client_with_json(
        {
            "intent": "multi_part",
            "secondary_intents": ["factual_lookup"],
            "keywords": ["API key", "rotation", "encryption", "algorithm", "at rest"],
            "entities": ["API"],
            "is_ambiguous": False,
            "is_multi_part": True,
            "sub_questions": [
                "What is the API key rotation schedule?",
                "What encryption algorithm is required for data at rest?",
            ],
            "is_follow_up": False,
            "requires_context_resolution": False,
            "is_clear_standalone": False,
            "confidence": 0.94,
            "primary_retrieval_query": question,
            "alternative_queries": ["encryption at rest cipher standard AES-256"],
            "was_rewritten": False,
            "rewrite_strategy": "decomposed",
        }
    )

    qu_service = QueryUnderstandingService(api_key="test_key", client=client)
    qu_res = await qu_service.process_query(QueryUnderstandingRequest(question=question))

    assert qu_res.analysis.is_multi_part is True
    assert len(qu_res.rewrite.sub_queries) == 2
    assert len(qu_res.retrieval_queries) == 4  # original + 2 sub_queries + 1 alternative

    # Integrate with RagQueryService & verify original question is preserved for answer generation!
    mock_embed = MagicMock()
    mock_embed.embed_texts.side_effect = lambda texts, **kw: MagicMock(
        embeddings=[[0.1 * (i + 1)] * 768 for i in range(len(texts))]
    )

    # First vector returns chunk A (rotation); sub-query returns chunk B (encryption)
    hit_rotation = VectorSearchResult(
        point_id="pt_rot",
        score=0.89,
        document_id="doc_sec",
        knowledge_base_id="kb_sec",
        text="API keys must rotate every 30 days.",
        filename="sec.pdf",
        chunk_id="c1",
        page_number=1,
    )
    hit_enc = VectorSearchResult(
        point_id="pt_enc",
        score=0.92,
        document_id="doc_sec",
        knowledge_base_id="kb_sec",
        text="Databases must use AES-256 encryption at rest.",
        filename="sec.pdf",
        chunk_id="c2",
        page_number=2,
    )

    mock_vs = MagicMock()
    mock_vs.search.side_effect = [
        [hit_rotation],
        [hit_rotation],
        [hit_enc],
        [hit_enc],
    ]

    mock_llm = MagicMock()
    mock_llm.model_name = "gemini-2.5-flash"
    mock_llm.generate_rag_answer.return_value = (
        "API keys must rotate every 30 days [Evidence 2], and AES-256 is required at rest [Evidence 1]."
    )

    rag_svc = RagQueryService(
        vector_store=mock_vs,
        embedding_service=mock_embed,
        generation_service=mock_llm,
        query_understanding=qu_service,
    )

    rag_res = await rag_svc.execute_query(
        RagQueryRequest(question=question, knowledgeBaseId="kb_sec")
    )

    # Original question MUST be preserved for answer generation
    assert mock_llm.generate_rag_answer.call_args.kwargs["question"] == question
    assert len(rag_res.citations) == 2
    assert rag_res.metadata.query_understanding is not None
    assert rag_res.metadata.query_understanding.intent == QueryIntent.MULTI_PART
    assert rag_res.metadata.query_understanding.is_multi_part is True
    assert len(rag_res.metadata.query_understanding.sub_queries) == 2


# -----------------------------------------------------------------------------
# 5. Follow-Up Question Resolution Using Conversation Context & Auth Checks
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_follow_up_question_uses_conversation_context_and_enforces_conv_ownership():
    history = [
        ConversationTurn(role="user", content="What is the escalation SLA for P1 security incidents?"),
        ConversationTurn(
            role="assistant",
            content="<thought>secret internal</thought>Critical P1 security incidents must be escalated within 15 minutes.",
        ),
    ]
    follow_up = "And who gets notified for those?"

    client = make_gemini_client_with_json(
        {
            "intent": "follow_up",
            "secondary_intents": ["factual_lookup"],
            "keywords": ["P1", "security incidents", "escalation", "notified", "recipients"],
            "entities": ["P1"],
            "is_ambiguous": False,
            "is_multi_part": False,
            "sub_questions": [],
            "is_follow_up": True,
            "requires_context_resolution": True,
            "is_clear_standalone": False,
            "confidence": 0.93,
            "primary_retrieval_query": "Who gets notified during critical P1 security incident escalations?",
            "alternative_queries": ["P1 security incident escalation notification contacts"],
            "was_rewritten": True,
            "rewrite_strategy": "contextualized",
        }
    )

    service = QueryUnderstandingService(api_key="test_key", client=client)
    res = await service.process_query(
        QueryUnderstandingRequest(question=follow_up, conversation_history=history)
    )

    assert res.used_conversation_context is True
    assert res.analysis.intent == QueryIntent.FOLLOW_UP
    assert res.analysis.is_follow_up is True
    assert res.rewrite.original_question == follow_up
    assert res.rewrite.was_rewritten is True
    assert res.rewrite.rewrite_strategy == "contextualized"
    assert "P1 security incident" in res.rewrite.primary_retrieval_query

    # Verify prompt sent to Gemini stripped <thought> tags from prior assistant message
    prompt_sent = client.models.generate_content.call_args.kwargs["contents"]
    assert "secret internal" not in prompt_sent
    assert "<conversation_context>" in prompt_sent

    # Verify MongoDB ownership protection in ContextAwareQueryProcessor
    ctx_proc = ContextAwareQueryProcessor()
    mock_db = MagicMock()
    mock_db["conversations"].find_one = AsyncMock(
        return_value={"_id": "conv_1", "user": "alice_id", "messages": []}
    )
    with pytest.raises(Exception) as exc_403:
        await ctx_proc.resolve_context(
            provided_history=None,
            conversation_id="conv_1",
            db=mock_db,
            user_id="bob_attacker",
            user_role="user",
        )
    assert exc_403.value.status_code == 403


# -----------------------------------------------------------------------------
# 6. No Answer Generation, No CoT Exposure, Error Handling & Fallback
# -----------------------------------------------------------------------------

@pytest.mark.anyio
async def test_no_cot_exposure_prompt_rules_and_provider_error_handling():
    # Verify system prompt explicitly bans answering & chain-of-thought
    assert "NEVER answer the user's question" in QUERY_UNDERSTANDING_SYSTEM_INSTRUCTION
    assert "NEVER output internal reasoning" in QUERY_UNDERSTANDING_SYSTEM_INSTRUCTION

    # Simulated Gemini output wrapped in markdown fences and <thought> block -> cleanly stripped
    mock_client = MagicMock()
    raw_json = json.dumps(
        {
            "intent": "procedural",
            "keywords": ["VPN", "MFA", "configure"],
            "entities": ["VPN", "MFA"],
            "is_ambiguous": False,
            "is_clear_standalone": True,
            "primary_retrieval_query": "How do I configure VPN MFA?",
            "alternative_queries": [],
            "was_rewritten": False,
            "rewrite_strategy": "unchanged",
        }
    )
    mock_client.models.generate_content.return_value = SimpleNamespace(
        text=f"<thought>hidden reasoning step</thought>\n```json\n{raw_json}\n```"
    )

    service = QueryUnderstandingService(api_key="test_key", client=mock_client)
    res = await service.process_query(QueryUnderstandingRequest(question="How do I configure VPN MFA?"))
    serialized = res.model_dump_json()
    assert "hidden reasoning step" not in serialized
    assert "answer" not in res.model_dump()

    # Empty question raises validation error
    with pytest.raises(QueryUnderstandingValidationError):
        await service.process_query(QueryUnderstandingRequest.model_construct(question="   "))

    # Rate limit 429 raises QueryUnderstandingRateLimitError when fallback_on_error=False
    rate_limit_client = MagicMock()
    err_429 = Exception("429 Quota exceeded AIzaLeakedSecret999")
    err_429.code = 429
    rate_limit_client.models.generate_content.side_effect = err_429

    rl_service = QueryUnderstandingService(api_key="AIzaLeakedSecret999", client=rate_limit_client, max_retries=0)
    with pytest.raises(QueryUnderstandingRateLimitError) as rl_exc:
        await rl_service.process_query(
            QueryUnderstandingRequest(question="What is the SLA?"),
            fallback_on_error=False,
        )
    assert "AIzaLeakedSecret999" not in str(rl_exc.value)

    # Timeout with fallback_on_error=True degrades safely to heuristic classification preserving original question!
    timeout_client = MagicMock()
    timeout_client.models.generate_content.side_effect = TimeoutError("Deadline exceeded key=AIzaSecretTimeout")
    to_service = QueryUnderstandingService(api_key="AIzaSecretTimeout", client=timeout_client, max_retries=0)

    fallback_res = await to_service.process_query(
        QueryUnderstandingRequest(question="How do I rotate TLS certificates?"),
        fallback_on_error=True,
    )
    assert fallback_res.fallback_used is True
    assert fallback_res.original_question == "How do I rotate TLS certificates?"
    assert fallback_res.rewrite.primary_retrieval_query == "How do I rotate TLS certificates?"
    assert fallback_res.analysis.intent == QueryIntent.PROCEDURAL
    assert "AIzaSecretTimeout" not in (fallback_res.error or "")

    # Verify fallback_on_error=False raises QueryUnderstandingTimeoutError
    with pytest.raises(QueryUnderstandingTimeoutError):
        await to_service.process_query(
            QueryUnderstandingRequest(question="How do I rotate TLS certificates?"),
            fallback_on_error=False,
        )


# -----------------------------------------------------------------------------
# 7. FastAPI Endpoint Tests (POST /api/rag/analyze-query)
# -----------------------------------------------------------------------------

def test_api_analyze_query_endpoint_auth_and_response():
    client = TestClient(app)

    # 1. Rejects missing user context
    res_no_ctx = client.post(
        "/api/rag/analyze-query",
        json={"question": "What is the policy?"},
        headers={"x-api-key": settings.SERVICE_API_KEY},
    )
    assert res_no_ctx.status_code == 401

    # 2. Authorized request succeeds cleanly
    token = sign_user_context_token(user_id="usr_alice", role="user", department="Engineering")
    mock_result = QueryUnderstandingResult(
        original_question="What is the SLA?",
        analysis=QueryAnalyzer().build_fallback_analysis("What is the SLA?", []),
        rewrite=QueryRewriter().build_rewrite(
            "What is the SLA?",
            QueryAnalyzer().build_fallback_analysis("What is the SLA?", []),
        ),
        retrieval_queries=["What is the SLA?"],
        used_conversation_context=False,
        fallback_used=False,
        model="gemini-2.5-flash",
    )

    with patch(
        "app.api.rag_routes.query_understanding_service.process_query",
        new_callable=AsyncMock,
    ) as mock_proc:
        mock_proc.return_value = mock_result

        res_ok = client.post(
            "/api/rag/analyze-query",
            json={"question": "What is the SLA?"},
            headers={
                "x-api-key": settings.SERVICE_API_KEY,
                "x-user-context-token": token,
            },
        )
        assert res_ok.status_code == 200
        data = res_ok.json()
        assert data["original_question"] == "What is the SLA?"
        assert data["retrieval_queries"] == ["What is the SLA?"]
        assert "answer" not in data
