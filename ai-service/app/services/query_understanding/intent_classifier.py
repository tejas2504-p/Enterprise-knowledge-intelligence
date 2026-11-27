import re
from typing import Any
from app.models.query_understanding import QueryIntent

_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "must", "need", "to", "of",
    "in", "for", "on", "with", "at", "by", "from", "up", "about", "into",
    "over", "after", "beneath", "under", "above", "and", "or", "but", "if",
    "then", "else", "when", "where", "why", "how", "what", "which", "who",
    "whom", "whose", "this", "that", "these", "those", "it", "its", "they",
    "them", "their", "we", "our", "you", "your", "i", "me", "my", "please",
    "tell", "give", "show", "find", "explain", "list", "get",
}

_GREETING_PATTERN = re.compile(
    r"^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)[!.,\s]*$",
    re.IGNORECASE,
)

_COMPARISON_PATTERN = re.compile(
    r"\b(compare|comparison|difference between|differences between|versus|vs\.?|better than|pros and cons)\b",
    re.IGNORECASE,
)

_PROCEDURAL_PATTERN = re.compile(
    r"\b(how do i|how to|steps to|step-by-step|procedure|workflow|configure|setup|set up|deploy|install|rotate|enable)\b",
    re.IGNORECASE,
)

_SUMMARIZATION_PATTERN = re.compile(
    r"\b(summarize|summary|overview|high[- ]level|key takeaways|recap|briefly describe)\b",
    re.IGNORECASE,
)

_MULTI_PART_CONNECTORS = re.compile(
    r"(\?\s+\w+|\band also\b|\band what\b|\band how\b|\badditionally\b|\bas well as\b|;)",
    re.IGNORECASE,
)

_FOLLOW_UP_CUES = re.compile(
    r"(\b(it|its|they|them|their|that|those|these|this one|the same|former|latter)\b|^(what about|how about|and for|how often|why|when|where does|can you elaborate)\b)",
    re.IGNORECASE,
)


class IntentClassifier:
    """
    Normalizes LLM-predicted intents and supplies deterministic fallback
    intent classification and keyword/entity extraction when Gemini is unavailable.
    """

    @staticmethod
    def normalize_intent(raw_intent: Any) -> QueryIntent:
        if isinstance(raw_intent, QueryIntent):
            return raw_intent
        if isinstance(raw_intent, str):
            clean = raw_intent.strip().lower().replace("-", "_").replace(" ", "_")
            for member in QueryIntent:
                if member.value == clean:
                    return member
        return QueryIntent.FACTUAL_LOOKUP

    @staticmethod
    def extract_keywords_and_entities(question: str) -> tuple[list[str], list[str]]:
        """
        Deterministically extract searchable keywords and likely entities
        (acronyms, standards, technical tokens, proper-noun phrases).
        """
        text = question.strip()
        if not text:
            return [], []

        entities: list[str] = []
        seen_entities: set[str] = set()

        # Technical codes, versions, standards, acronyms (e.g., TLS 1.3, AES-256, MFA, SOC2, P1, ISO-27001)
        entity_patterns = [
            r"\b[A-Z]{2,}(?:[- ][A-Z0-9.]+)*\b",
            r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b",
            r"\b[A-Za-z]+-\d+(?:\.\d+)?\b",
        ]
        for pattern in entity_patterns:
            for match in re.finditer(pattern, text):
                candidate = match.group(0).strip()
                if candidate.lower() in _STOPWORDS or len(candidate) < 2:
                    continue
                lower_cand = candidate.lower()
                if lower_cand not in seen_entities:
                    seen_entities.add(lower_cand)
                    entities.append(candidate)

        # Single capitalized domain words inside question (skip first word unless acronym)
        words_with_pos = list(re.finditer(r"\b[A-Za-z0-9][A-Za-z0-9._-]*\b", text))
        keywords: list[str] = []
        seen_keywords: set[str] = set()

        for idx, match in enumerate(words_with_pos):
            tok = match.group(0)
            lower_tok = tok.lower()
            if idx > 0 and tok[0].isupper() and lower_tok not in _STOPWORDS and lower_tok not in seen_entities:
                seen_entities.add(lower_tok)
                entities.append(tok)

            if lower_tok not in _STOPWORDS and len(lower_tok) >= 2 and lower_tok not in seen_keywords:
                seen_keywords.add(lower_tok)
                keywords.append(lower_tok)

        return keywords[:12], entities[:10]

    @staticmethod
    def split_multi_part_heuristically(question: str, max_sub_queries: int = 4) -> list[str]:
        """Split compound questions conservatively at explicit '?' or clause delimiters."""
        clean = question.strip()
        if "?" in clean[:-1]:
            parts = [p.strip() for p in re.split(r"\?\s+", clean) if p.strip()]
            normalized = [p if p.endswith("?") else f"{p}?" for p in parts]
            if len(normalized) >= 2:
                return normalized[:max_sub_queries]

        split_clauses = re.split(r"\s+(?:and also|and what|and how|as well as)\s+|\s*;\s*", clean, flags=re.IGNORECASE)
        if len(split_clauses) >= 2:
            cleaned: list[str] = []
            for idx, clause in enumerate(split_clauses):
                part = clause.strip().rstrip("?")
                if len(part.split()) < 2:
                    continue
                if idx > 0 and not re.match(r"^(what|how|when|where|who|why|which|is|are|do|does|can)\b", part, re.IGNORECASE):
                    part = f"what {part}" if clean.lower().startswith("what") else part
                cleaned.append(f"{part}?")
            if len(cleaned) >= 2:
                return cleaned[:max_sub_queries]

        return []

    @classmethod
    def classify_heuristically(
        cls,
        question: str,
        has_history: bool = False,
        max_sub_queries: int = 4,
    ) -> dict[str, Any]:
        """
        Produce deterministic intent/ambiguity/multi-part metadata used both as a fallback
        when Gemini is unavailable and as structural guardrails.
        """
        clean = question.strip()
        tokens = re.findall(r"[A-Za-z0-9._-]+", clean)
        keywords, _ = cls.extract_keywords_and_entities(clean)

        if _GREETING_PATTERN.match(clean):
            return {
                "intent": QueryIntent.OUT_OF_SCOPE,
                "is_ambiguous": False,
                "ambiguity_reason": None,
                "is_multi_part": False,
                "sub_questions": [],
                "is_follow_up": False,
                "is_clear_standalone": True,
            }

        is_follow_up = bool(has_history and _FOLLOW_UP_CUES.search(clean))
        sub_questions = cls.split_multi_part_heuristically(clean, max_sub_queries=max_sub_queries)
        is_multi_part = len(sub_questions) >= 2 or bool(_MULTI_PART_CONNECTORS.search(clean))

        is_ambiguous = False
        ambiguity_reason = None
        if not is_follow_up and (len(keywords) <= 1 and len(tokens) <= 4):
            is_ambiguous = True
            ambiguity_reason = "Question is too brief or lacks specific target entities"
        elif not is_follow_up and _FOLLOW_UP_CUES.search(clean) and len(tokens) <= 6:
            is_ambiguous = True
            ambiguity_reason = "Unresolved pronoun or missing referent without conversation context"

        if is_follow_up:
            intent = QueryIntent.FOLLOW_UP
        elif is_ambiguous:
            intent = QueryIntent.AMBIGUOUS
        elif is_multi_part and sub_questions:
            intent = QueryIntent.MULTI_PART
        elif _COMPARISON_PATTERN.search(clean):
            intent = QueryIntent.COMPARISON
        elif _PROCEDURAL_PATTERN.search(clean):
            intent = QueryIntent.PROCEDURAL
        elif _SUMMARIZATION_PATTERN.search(clean):
            intent = QueryIntent.SUMMARIZATION
        else:
            intent = QueryIntent.FACTUAL_LOOKUP

        return {
            "intent": intent,
            "is_ambiguous": is_ambiguous,
            "ambiguity_reason": ambiguity_reason,
            "is_multi_part": bool(sub_questions),
            "sub_questions": sub_questions,
            "is_follow_up": is_follow_up,
            "is_clear_standalone": not (is_ambiguous or is_follow_up or bool(sub_questions)),
        }
