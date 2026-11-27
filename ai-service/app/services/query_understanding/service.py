import json
import logging
import random
import re
import time
from typing import Any, Optional

from app.core.config import settings
from app.models.query_understanding import (
    ConversationTurn,
    QueryUnderstandingRequest,
    QueryUnderstandingResult,
)
from app.prompts.query_understanding_prompts import (
    QUERY_UNDERSTANDING_SYSTEM_INSTRUCTION,
    build_query_understanding_prompt,
)
from app.services.embedding_service import sanitize_error_message
from app.services.generation_service import gemini_generation_service
from app.services.query_understanding.context_processor import ContextAwareQueryProcessor
from app.services.query_understanding.exceptions import (
    QueryUnderstandingProviderError,
    QueryUnderstandingRateLimitError,
    QueryUnderstandingTimeoutError,
    QueryUnderstandingValidationError,
)
from app.services.query_understanding.query_analyzer import (
    GeminiStructuredQuerySchema,
    QueryAnalyzer,
)
from app.services.query_understanding.query_rewriter import QueryRewriter

logger = logging.getLogger(__name__)


class QueryUnderstandingService:
    """
    Phase 4 Modular Query Understanding & Rewriting Service.

    Uses Google Gemini through the existing AI service configuration to:
    - Classify intent and extract domain keywords & entities
    - Detect ambiguity and suggest clarifications
    - Resolve follow-up questions against bounded conversation history
    - Decompose multi-part questions and generate alternative retrieval queries
    - Preserve original_question untouched for answer generation
    - Avoid unnecessary rewriting of clear standalone questions
    - Never generate answers or expose chain-of-thought
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout: Optional[float] = None,
        max_tokens: Optional[int] = None,
        max_retries: Optional[int] = None,
        client: Optional[Any] = None,
        analyzer: Optional[QueryAnalyzer] = None,
        rewriter: Optional[QueryRewriter] = None,
        context_processor: Optional[ContextAwareQueryProcessor] = None,
    ):
        self.api_key = api_key if api_key is not None else getattr(settings, "GEMINI_API_KEY", None)
        configured_model = getattr(settings, "QUERY_UNDERSTANDING_MODEL", None) or getattr(
            settings, "GEMINI_GENERATION_MODEL", "gemini-2.5-flash"
        )
        self.model_name = model_name or configured_model
        self.timeout = (
            timeout
            if timeout is not None
            else getattr(settings, "QUERY_UNDERSTANDING_TIMEOUT", 15.0)
        )
        self.max_tokens = (
            max_tokens
            if max_tokens is not None
            else getattr(settings, "QUERY_UNDERSTANDING_MAX_TOKENS", 768)
        )
        self.max_retries = (
            max_retries
            if max_retries is not None
            else getattr(settings, "QUERY_UNDERSTANDING_MAX_RETRIES", 1)
        )
        self._client = client
        self.analyzer = analyzer or QueryAnalyzer()
        self.rewriter = rewriter or QueryRewriter()
        self.context_processor = context_processor or ContextAwareQueryProcessor()

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        active_key = self.api_key or getattr(gemini_generation_service, "api_key", None) or getattr(settings, "GEMINI_API_KEY", None)
        if not active_key:
            # Allow reusing an explicitly injected/mocked _client on global gemini_generation_service
            if getattr(gemini_generation_service, "_client", None) is not None:
                return gemini_generation_service.get_client()
            raise QueryUnderstandingProviderError(
                "Gemini API key is not configured for query understanding.",
                status_code=503,
            )

        try:
            from google import genai
            from google.genai import types

            http_options = (
                types.HttpOptions(timeout=int(self.timeout * 1000))
                if hasattr(types, "HttpOptions")
                else None
            )
            self._client = genai.Client(api_key=active_key, http_options=http_options)
            return self._client
        except Exception as exc:
            safe = sanitize_error_message(exc)
            logger.error("Failed to initialize Gemini client for query understanding: %s", safe)
            raise QueryUnderstandingProviderError(
                f"Failed to initialize Gemini client: {safe}",
                status_code=502,
            ) from exc

    @staticmethod
    def _parse_structured_response(raw_text: str) -> GeminiStructuredQuerySchema:
        """Parse and validate structured JSON output from Gemini, stripping fences/CoT tags."""
        if not raw_text or not isinstance(raw_text, str):
            raise QueryUnderstandingValidationError("Gemini returned empty query understanding output")

        cleaned = re.sub(r"<(thought|thinking)>[\s\S]*?</\1>", "", raw_text, flags=re.IGNORECASE).strip()
        # Strip optional markdown code fences if a mock/model returns ```json ... ```
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE | re.DOTALL).strip()

        try:
            data = json.loads(cleaned)
        except Exception as exc:
            raise QueryUnderstandingValidationError(
                f"Query understanding returned malformed JSON: {sanitize_error_message(exc)}"
            ) from exc

        try:
            return GeminiStructuredQuerySchema.model_validate(data)
        except Exception as exc:
            raise QueryUnderstandingValidationError(
                f"Query understanding output failed schema validation: {sanitize_error_message(exc)}"
            ) from exc

    def _invoke_gemini(
        self,
        question: str,
        context_turns: list[ConversationTurn],
        knowledge_base_name: Optional[str] = None,
    ) -> GeminiStructuredQuerySchema:
        client = self._get_client()
        from google.genai import types

        user_prompt = build_query_understanding_prompt(
            question=question,
            context_turns=context_turns,
            knowledge_base_name=knowledge_base_name,
        )

        config_kwargs: dict[str, Any] = {
            "system_instruction": QUERY_UNDERSTANDING_SYSTEM_INSTRUCTION,
            "temperature": 0.0,
            "max_output_tokens": self.max_tokens,
            "response_mime_type": "application/json",
            "response_schema": GeminiStructuredQuerySchema,
        }
        if hasattr(types, "ThinkingConfig"):
            try:
                config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
            except Exception:
                pass

        config = types.GenerateContentConfig(**config_kwargs)
        attempt = 0

        while attempt <= self.max_retries:
            try:
                response = client.models.generate_content(
                    model=self.model_name,
                    contents=user_prompt,
                    config=config,
                )
                raw_text = getattr(response, "text", None)
                return self._parse_structured_response(raw_text)
            except QueryUnderstandingValidationError:
                raise
            except Exception as exc:
                safe_err = sanitize_error_message(exc)
                status_code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
                lower_err = safe_err.lower()

                is_rate_limit = (
                    status_code == 429
                    or "resource_exhausted" in lower_err
                    or "rate_limit" in lower_err
                    or "rate limit" in lower_err
                    or "quota" in lower_err
                )
                is_timeout = (
                    isinstance(exc, TimeoutError)
                    or status_code in (408, 504)
                    or "timeout" in lower_err
                    or "timed out" in lower_err
                    or "deadline" in lower_err
                )
                is_transient = (
                    status_code in (500, 502, 503)
                    or "unavailable" in lower_err
                    or "connection" in lower_err
                )

                if (is_rate_limit or is_timeout or is_transient) and attempt < self.max_retries:
                    delay = min(4.0, 0.4 * (1.5**attempt)) + random.uniform(0, 0.1)
                    time.sleep(delay)
                    attempt += 1
                    continue

                logger.warning("Gemini query understanding call failed: %s", safe_err)
                if is_rate_limit:
                    raise QueryUnderstandingRateLimitError(
                        f"Query understanding rate limit exceeded: {safe_err}"
                    ) from exc
                if is_timeout:
                    raise QueryUnderstandingTimeoutError(
                        f"Query understanding timed out: {safe_err}"
                    ) from exc
                raise QueryUnderstandingProviderError(
                    f"Query understanding failed: {safe_err}",
                    status_code=status_code if isinstance(status_code, int) else 502,
                ) from exc

        raise QueryUnderstandingProviderError("Query understanding failed after bounded retries", status_code=502)

    async def process_query(
        self,
        request: QueryUnderstandingRequest,
        db: Any = None,
        user_id: Optional[str] = None,
        user_role: str = "user",
        fallback_on_error: bool = True,
    ) -> QueryUnderstandingResult:
        """
        Analyze and optimize a natural-language question for vector retrieval.
        If `fallback_on_error=True`, gracefully degrades to deterministic local
        intent/entity extraction preserving the original question on provider failure.
        """
        clean_question = (request.question or "").strip()
        if not clean_question:
            raise QueryUnderstandingValidationError("Question cannot be empty or whitespace only")

        context_turns = await self.context_processor.resolve_context(
            provided_history=request.conversation_history,
            conversation_id=request.conversationId,
            db=db,
            user_id=user_id,
            user_role=user_role,
        )

        try:
            structured = self._invoke_gemini(
                question=clean_question,
                context_turns=context_turns,
                knowledge_base_name=request.knowledge_base_name,
            )
            analysis = self.analyzer.build_analysis_from_structured(
                question=clean_question,
                raw_payload=structured,
                context_turns=context_turns,
            )
            rewrite = self.rewriter.build_rewrite(
                original_question=clean_question,
                analysis=analysis,
                raw_payload=structured,
            )
            retrieval_queries = self.rewriter.build_retrieval_queries(rewrite)

            return QueryUnderstandingResult(
                original_question=clean_question,
                analysis=analysis,
                rewrite=rewrite,
                retrieval_queries=retrieval_queries,
                used_conversation_context=bool(context_turns and analysis.requires_context_resolution),
                fallback_used=False,
                model=self.model_name,
                error=None,
            )

        except Exception as exc:
            # Propagate HTTP access errors (e.g. 403 unauthorized conversation context) immediately
            from fastapi import HTTPException
            if isinstance(exc, HTTPException):
                raise

            safe_err = sanitize_error_message(exc)
            if not fallback_on_error:
                raise

            logger.info("Query understanding falling back to local analyzer: %s", safe_err)
            fallback_analysis = self.analyzer.build_fallback_analysis(
                question=clean_question,
                context_turns=context_turns,
            )
            fallback_rewrite = self.rewriter.build_rewrite(
                original_question=clean_question,
                analysis=fallback_analysis,
                raw_payload=None,
            )
            retrieval_queries = self.rewriter.build_retrieval_queries(fallback_rewrite)

            return QueryUnderstandingResult(
                original_question=clean_question,
                analysis=fallback_analysis,
                rewrite=fallback_rewrite,
                retrieval_queries=retrieval_queries,
                used_conversation_context=False,
                fallback_used=True,
                model=self.model_name,
                error=safe_err,
            )


# Global default service instance
query_understanding_service = QueryUnderstandingService()
