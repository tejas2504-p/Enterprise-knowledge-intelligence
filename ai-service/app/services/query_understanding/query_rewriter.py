import re
from typing import Literal, Optional

from app.core.config import settings
from app.models.query_understanding import QueryAnalysis, QueryIntent, QueryRewriteResult
from app.services.query_understanding.query_analyzer import GeminiStructuredQuerySchema


def _normalize_compare(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _token_similarity(a: str, b: str) -> float:
    set_a = set(_normalize_compare(a).split())
    set_b = set(_normalize_compare(b).split())
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / max(len(set_a), len(set_b))


class QueryRewriter:
    """
    Produces retrieval-optimized queries while enforcing core safeguards:
    - Always preserves original_question unmodified for answer generation
    - Avoids unnecessary rewriting of already-clear standalone questions
    - Deduplicates sub-queries and alternative queries safely
    """

    def __init__(
        self,
        max_alternative_queries: Optional[int] = None,
        max_sub_queries: Optional[int] = None,
    ):
        self.max_alternative_queries = (
            max_alternative_queries
            if max_alternative_queries is not None
            else getattr(settings, "QUERY_MAX_ALTERNATIVE_QUERIES", 3)
        )
        self.max_sub_queries = (
            max_sub_queries
            if max_sub_queries is not None
            else getattr(settings, "QUERY_MAX_SUB_QUERIES", 4)
        )

    @staticmethod
    def _clean_query_string(raw: Optional[str]) -> str:
        if not raw or not isinstance(raw, str):
            return ""
        cleaned = re.sub(r"<(thought|thinking)>[\s\S]*?</\1>", "", raw, flags=re.IGNORECASE)
        return re.sub(r"\s+", " ", cleaned).strip()

    def build_rewrite(
        self,
        original_question: str,
        analysis: QueryAnalysis,
        raw_payload: Optional[GeminiStructuredQuerySchema] = None,
    ) -> QueryRewriteResult:
        clean_original = original_question.strip()

        sub_queries = [
            self._clean_query_string(q)
            for q in analysis.sub_questions[: self.max_sub_queries]
            if self._clean_query_string(q)
        ]

        # Decide whether rewriting primary_retrieval_query is warranted
        candidate_primary = (
            self._clean_query_string(raw_payload.primary_retrieval_query)
            if raw_payload
            else clean_original
        ) or clean_original

        allowed_strategies = {"unchanged", "contextualized", "clarified", "decomposed", "expanded"}
        raw_strategy = raw_payload.rewrite_strategy if raw_payload else "unchanged"
        strategy: Literal["unchanged", "contextualized", "clarified", "decomposed", "expanded"] = (
            raw_strategy if raw_strategy in allowed_strategies else "unchanged"
        )

        # Safeguard: avoid unnecessary rewriting if question is already clear and standalone
        should_keep_original = False
        if analysis.is_clear_standalone and not analysis.is_ambiguous and not analysis.requires_context_resolution:
            # Keep original unless decomposition specifically applies
            should_keep_original = True
        elif (
            not analysis.is_ambiguous
            and not analysis.requires_context_resolution
            and not analysis.is_multi_part
            and _token_similarity(clean_original, candidate_primary) >= 0.85
        ):
            should_keep_original = True

        if should_keep_original:
            primary_query = clean_original
            was_rewritten = False
            strategy = "unchanged"
        else:
            same_text = _normalize_compare(candidate_primary) == _normalize_compare(clean_original)
            primary_query = clean_original if same_text else candidate_primary
            was_rewritten = not same_text
            if not was_rewritten:
                strategy = "decomposed" if (analysis.is_multi_part and len(sub_queries) >= 2) else "unchanged"
            elif analysis.requires_context_resolution:
                strategy = "contextualized"
            elif analysis.is_multi_part and len(sub_queries) >= 2:
                strategy = "decomposed"
            elif analysis.is_ambiguous:
                strategy = "clarified"
            elif strategy == "unchanged":
                strategy = "expanded"

        # Deduplicate alternative queries against primary, original, and sub_queries
        seen_norm: set[str] = {
            _normalize_compare(clean_original),
            _normalize_compare(primary_query),
        }
        for sq in sub_queries:
            seen_norm.add(_normalize_compare(sq))

        alt_queries: list[str] = []
        if raw_payload and raw_payload.alternative_queries and analysis.intent != QueryIntent.OUT_OF_SCOPE:
            for alt in raw_payload.alternative_queries:
                clean_alt = self._clean_query_string(alt)
                norm_alt = _normalize_compare(clean_alt)
                if not clean_alt or not norm_alt or norm_alt in seen_norm:
                    continue
                seen_norm.add(norm_alt)
                alt_queries.append(clean_alt)
                if len(alt_queries) >= self.max_alternative_queries:
                    break

        return QueryRewriteResult(
            original_question=clean_original,
            primary_retrieval_query=primary_query,
            alternative_queries=alt_queries,
            sub_queries=sub_queries,
            was_rewritten=was_rewritten,
            rewrite_strategy=strategy,
        )

    @staticmethod
    def build_retrieval_queries(rewrite: QueryRewriteResult, max_total: int = 5) -> list[str]:
        """
        Return ordered, deduplicated list of retrieval queries for vector search:
        [primary_retrieval_query, *sub_queries, *alternative_queries].
        """
        ordered: list[str] = []
        seen: set[str] = set()

        candidates = [rewrite.primary_retrieval_query, *rewrite.sub_queries, *rewrite.alternative_queries]
        for q in candidates:
            clean = q.strip()
            norm = _normalize_compare(clean)
            if clean and norm and norm not in seen:
                seen.add(norm)
                ordered.append(clean)
                if len(ordered) >= max_total:
                    break

        return ordered or [rewrite.original_question]
