import re
from typing import Optional
from app.core.config import settings

try:
    import tiktoken
    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False


class Tokenizer:
    """
    Tokenizer utility supporting both BPE token counting (via tiktoken)
    and word-based fallback token estimation.
    """

    def __init__(
        self,
        strategy: Optional[str] = None,
        encoding_name: Optional[str] = None
    ):
        self.strategy = strategy or getattr(settings, "TOKENIZER_STRATEGY", "tiktoken")
        self.encoding_name = encoding_name or getattr(settings, "TIKTOKEN_ENCODING", "cl100k_base")
        self._tiktoken_encoder = None

        if self.strategy == "tiktoken" and HAS_TIKTOKEN:
            try:
                self._tiktoken_encoder = tiktoken.get_encoding(self.encoding_name)
            except Exception:
                self._tiktoken_encoder = None
                self.strategy = "words"

    def count_tokens(self, text: str) -> int:
        """Count the number of tokens in the given text."""
        if not text:
            return 0
        if self.strategy == "tiktoken" and self._tiktoken_encoder is not None:
            return len(self._tiktoken_encoder.encode(text, disallowed_special=()))
        # Word-based token estimation (average ~1.3 tokens per word)
        words = re.findall(r"\w+|[^\w\s]", text)
        return len(words)

    def encode(self, text: str) -> list[int]:
        """Encode text into a list of token IDs."""
        if not text:
            return []
        if self.strategy == "tiktoken" and self._tiktoken_encoder is not None:
            return self._tiktoken_encoder.encode(text, disallowed_special=())
        words = re.findall(r"\w+|[^\w\s]", text)
        return list(range(len(words)))

    def decode(self, tokens: list[int]) -> str:
        """Decode a list of token IDs back into text."""
        if not tokens:
            return ""
        if self.strategy == "tiktoken" and self._tiktoken_encoder is not None:
            return self._tiktoken_encoder.decode(tokens)
        return ""

    def get_overlap_text(self, text: str, max_overlap_tokens: int) -> str:
        """
        Extract the trailing portion of text containing at most max_overlap_tokens.
        Prefers sentence and word boundaries so chunks do not begin mid-token or mid-word.
        """
        if not text or max_overlap_tokens <= 0:
            return ""

        total_tokens = self.count_tokens(text)
        if total_tokens <= max_overlap_tokens:
            return text

        if self.strategy == "tiktoken" and self._tiktoken_encoder is not None:
            tokens = self._tiktoken_encoder.encode(text, disallowed_special=())
            slice_tokens = tokens[-max_overlap_tokens:]
            raw_overlap = self._tiktoken_encoder.decode(slice_tokens)
        else:
            words = text.split()
            slice_words = words[-max_overlap_tokens:]
            raw_overlap = " ".join(slice_words)

        # Seek the first clean sentence or paragraph boundary in the overlap window
        # to avoid starting the subsequent chunk with an awkward fragment
        sentence_match = re.search(r"(?:[\.\?!]\s+|\n+)([A-Z0-9\"'].*)$", raw_overlap, re.DOTALL)
        if sentence_match:
            candidate = sentence_match.group(1).strip()
            if candidate and self.count_tokens(candidate) >= max(10, max_overlap_tokens // 4):
                return candidate

        # Fallback to word boundary
        first_space = raw_overlap.find(" ")
        if first_space != -1 and first_space < len(raw_overlap) - 1:
            candidate = raw_overlap[first_space + 1:].strip()
            if candidate:
                return candidate

        return raw_overlap.strip()


default_tokenizer = Tokenizer()
