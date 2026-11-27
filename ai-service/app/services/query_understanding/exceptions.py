from typing import Optional


class QueryUnderstandingError(Exception):
    """Base exception for Phase 4 query understanding and rewriting errors."""
    pass


class QueryUnderstandingValidationError(QueryUnderstandingError):
    """Raised when input query or structured model output fails validation."""
    pass


class QueryUnderstandingProviderError(QueryUnderstandingError):
    """Raised when Gemini query analysis fails or returns provider errors."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class QueryUnderstandingRateLimitError(QueryUnderstandingProviderError):
    """Raised when Gemini rate limits (HTTP 429) persist after retries."""

    def __init__(self, message: str):
        super().__init__(message, status_code=429)


class QueryUnderstandingTimeoutError(QueryUnderstandingProviderError):
    """Raised when Gemini query understanding times out."""

    def __init__(self, message: str):
        super().__init__(message, status_code=504)
