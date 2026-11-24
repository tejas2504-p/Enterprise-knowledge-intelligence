import logging
import re
from typing import Any, Optional

from app.core.config import settings
from app.prompts.rag_prompts import INSUFFICIENT_EVIDENCE_RESPONSE, RAG_SYSTEM_INSTRUCTION, build_rag_user_prompt
from app.services.embedding_service import sanitize_error_message

logger = logging.getLogger(__name__)


class GenerationError(Exception):
    """Base exception for text generation errors."""
    pass


class GenerationProviderError(GenerationError):
    """Raised when the LLM provider fails, returns an error, or times out."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class GeminiGenerationService:
    """
    Dedicated LLM Generation Service using the official Google Gen AI SDK (`google-genai`).

    Features:
    - Configurable Gemini model (default: gemini-2.5-flash)
    - Prompt grounding & untrusted evidence isolation
    - Provider error handling and bounded timeouts
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
        client: Optional[Any] = None,
    ):
        self.api_key = api_key or getattr(settings, "GEMINI_API_KEY", None)
        self.model_name = model_name or getattr(settings, "GEMINI_GENERATION_MODEL", "gemini-2.5-flash")
        self.temperature = temperature if temperature is not None else getattr(settings, "RAG_TEMPERATURE", 0.0)
        self.max_output_tokens = max_output_tokens or getattr(settings, "RAG_MAX_OUTPUT_TOKENS", 2048)
        self.timeout = timeout if timeout is not None else getattr(settings, "RAG_GENERATION_TIMEOUT", 30.0)
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
        Generate grounded answer from retrieved evidence using configured Gemini model.
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

        # Explicitly disable or suppress thinking tokens if supported by SDK version
        if hasattr(types, "ThinkingConfig"):
            try:
                config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
            except Exception:
                pass

        config = types.GenerateContentConfig(**config_kwargs)

        try:
            logger.debug(
                "Calling Gemini generate_content with model=%s, evidence_count=%d",
                self.model_name, len(evidence_items)
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
            logger.error("Gemini generation failed for model %s: %s", self.model_name, safe_err)
            raise GenerationProviderError(
                f"LLM generation failed: {safe_err}",
                status_code=getattr(exc, "code", 500)
            ) from exc


# Global instance
gemini_generation_service = GeminiGenerationService()
