import logging
import random
import re
import time
from typing import Any, Optional

from app.core.config import settings
from app.prompts.rag_prompts import INSUFFICIENT_EVIDENCE_RESPONSE, RAG_SYSTEM_INSTRUCTION, build_rag_user_prompt
from app.services.embedding_service import sanitize_error_message

logger = logging.getLogger(__name__)


class GenerationError(Exception):
    """Base exception for text generation errors."""
    pass


class GenerationProviderError(GenerationError):
    """Raised when the LLM provider fails or returns a non-retryable error."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class GenerationRateLimitError(GenerationProviderError):
    """Raised when Gemini generation hits rate limits (HTTP 429) after retries."""
    def __init__(self, message: str):
        super().__init__(message, status_code=429)


class GenerationTimeoutError(GenerationProviderError):
    """Raised when Gemini generation times out after bounded retries."""
    def __init__(self, message: str):
        super().__init__(message, status_code=504)


class GeminiGenerationService:
    """
    Dedicated LLM Generation Service using the official Google Gen AI SDK (`google-genai`).

    Features:
    - Configurable Gemini model (default: gemini-2.5-flash)
    - Prompt grounding & untrusted evidence isolation
    - Bounded exponential backoff retries for 429 rate limits and transient errors/timeouts
    - Chain-of-thought / internal reasoning suppression
    - Zero sensitive credential leakage in telemetry and exceptions
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
        min_backoff: Optional[float] = None,
        backoff_factor: Optional[float] = None,
        client: Optional[Any] = None,
    ):
        self.api_key = api_key or getattr(settings, "GEMINI_API_KEY", None)
        self.model_name = model_name or getattr(settings, "GEMINI_GENERATION_MODEL", "gemini-2.5-flash")
        self.temperature = temperature if temperature is not None else getattr(settings, "RAG_TEMPERATURE", 0.0)
        self.max_output_tokens = max_output_tokens or getattr(settings, "RAG_MAX_OUTPUT_TOKENS", 2048)
        self.timeout = timeout if timeout is not None else getattr(settings, "RAG_GENERATION_TIMEOUT", 30.0)
        self.max_retries = max_retries if max_retries is not None else getattr(settings, "RAG_GENERATION_MAX_RETRIES", 2)
        self.min_backoff = min_backoff if min_backoff is not None else getattr(settings, "EMBEDDING_MIN_BACKOFF", 0.5)
        self.backoff_factor = backoff_factor if backoff_factor is not None else getattr(settings, "EMBEDDING_BACKOFF_FACTOR", 1.5)
        self._client = client

    def get_client(self) -> Any:
        """Lazily initialize Google Gen AI Client."""
        if self._client is not None:
            return self._client

        if not self.api_key:
            raise GenerationProviderError(
                "Gemini API key is not configured. Please set GEMINI_API_KEY environment variable."
            )

        try:
            from google import genai
            from google.genai import types

            http_options = types.HttpOptions(timeout=int(self.timeout * 1000)) if hasattr(types, "HttpOptions") else None
            self._client = genai.Client(api_key=self.api_key, http_options=http_options)
            return self._client
        except Exception as exc:
            safe_msg = sanitize_error_message(exc)
            logger.error("Failed to initialize Google Gen AI generation client: %s", safe_msg)
            raise GenerationProviderError(f"Failed to initialize Gemini Client: {safe_msg}") from exc

    def _strip_internal_reasoning(self, raw_text: str) -> str:
        """
        Ensure hidden thinking, chain-of-thought, or internal scratchpads
        (e.g., <thought>...</thought> or <thinking>...</thinking>) are never exposed to users.
        """
        cleaned = re.sub(r"<(thought|thinking)>[\s\S]*?</\1>", "", raw_text, flags=re.IGNORECASE)
        return cleaned.strip()

    def generate_rag_answer(
        self,
        question: str,
        evidence_items: list[dict[str, Any]],
        system_instruction: Optional[str] = None,
    ) -> str:
        """
        Generate grounded answer from retrieved evidence using configured Gemini model,
        with bounded exponential backoff retries for 429 rate limits and transient errors.
        """
        if not evidence_items:
            return INSUFFICIENT_EVIDENCE_RESPONSE

        client = self.get_client()
        from google.genai import types

        sys_inst = system_instruction or RAG_SYSTEM_INSTRUCTION
        user_prompt = build_rag_user_prompt(question, evidence_items)

        config_kwargs: dict[str, Any] = {
            "system_instruction": sys_inst,
            "temperature": self.temperature,
            "max_output_tokens": self.max_output_tokens,
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
                logger.debug(
                    "Calling Gemini generate_content with model=%s, evidence_count=%d, attempt=%d",
                    self.model_name, len(evidence_items), attempt + 1
                )

                response = client.models.generate_content(
                    model=self.model_name,
                    contents=user_prompt,
                    config=config,
                )

                if not response or not hasattr(response, "text") or not response.text:
                    logger.warning("Gemini returned empty text response for question")
                    return INSUFFICIENT_EVIDENCE_RESPONSE

                final_text = self._strip_internal_reasoning(response.text)
                return final_text if final_text else INSUFFICIENT_EVIDENCE_RESPONSE

            except Exception as exc:
                safe_err = sanitize_error_message(exc)
                status_code: Optional[int] = getattr(exc, "code", None) or getattr(exc, "status_code", None)
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
                    delay = min(10.0, self.min_backoff * (self.backoff_factor ** attempt))
                    jitter = random.uniform(0, 0.1 * self.min_backoff)
                    logger.warning(
                        "Gemini generation transient error (status=%s, attempt %d/%d). Retrying in %.2fs: %s",
                        status_code or "transient",
                        attempt + 1,
                        self.max_retries,
                        delay + jitter,
                        safe_err,
                    )
                    time.sleep(delay + jitter)
                    attempt += 1
                    continue

                logger.error("Gemini generation failed for model %s: %s", self.model_name, safe_err)
                if is_rate_limit:
                    raise GenerationRateLimitError(
                        f"Gemini API rate limit exceeded: {safe_err}"
                    ) from exc
                if is_timeout:
                    raise GenerationTimeoutError(
                        f"Gemini API generation timed out: {safe_err}"
                    ) from exc
                raise GenerationProviderError(
                    f"LLM generation failed: {safe_err}",
                    status_code=status_code if isinstance(status_code, int) else 502,
                ) from exc

        raise GenerationProviderError("LLM generation failed after bounded retries", status_code=502)


# Global instance
gemini_generation_service = GeminiGenerationService()
