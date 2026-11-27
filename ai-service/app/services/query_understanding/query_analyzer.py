from typing import Any, Optional
from pydantic import BaseModel, Field

from app.core.config import settings
from app.models.query_understanding import ConversationTurn, QueryAnalysis, QueryIntent
from app.services.query_understanding.intent_classifier import IntentClassifier


class GeminiStructuredQuerySchema(BaseModel):
    """
    Strict JSON output schema requested from Gemini during query understanding.
    Deliberately excludes any 'answer', 'reasoning', or 'thought' fields.
    """

    intent: str = Field(description="Primary intent label from allowed QueryIntent values")
    secondary_intents: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    entities: list[str] = Field(default_factory=list)
    is_ambiguous: bool = False
    ambiguity_reason: Optional[str] = None
    clarification_needed: bool = False
    suggested_clarifications: list[str] = Field(default_factory=list)
    is_multi_part: bool = False
    sub_questions: list[str] = Field(default_factory=list)
    is_follow_up: bool = False
    requires_context_resolution: bool = False
    is_clear_standalone: bool = True
    language: str = "en"
    confidence: float = Field(default=0.95, ge=0.0, le=1.0)
    primary_retrieval_query: str
    alternative_queries: list[str] = Field(default_factory=list)
    was_rewritten: bool = False
    rewrite_strategy: str = "unchanged"


def _dedupe_preserve_order(items: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, str):
            continue
        clean = item.strip()
        if not clean:
            continue
        key = clean.lower()
        if key not in seen:
            seen.add(key)
            out.append(clean)
            if len(out) >= limit:
                break
    return out


class QueryAnalyzer:
    """
    Builds normalized, validated QueryAnalysis objects from either structured Gemini
    responses or deterministic fallback analysis.
    """

    def __init__(self, max_sub_queries: Optional[int] = None):
        self.max_sub_queries = (
            max_sub_queries
            if max_sub_queries is not None
            else getattr(settings, "QUERY_MAX_SUB_QUERIES", 4)
        )

    def build_analysis_from_structured(
        self,
        question: str,
        raw_payload: GeminiStructuredQuerySchema,
        context_turns: list[ConversationTurn],
    ) -> QueryAnalysis:
        heuristic_kw, heuristic_ent = IntentClassifier.extract_keywords_and_entities(question)
        primary_intent = IntentClassifier.normalize_intent(raw_payload.intent)

        secondary: list[QueryIntent] = []
        for sec in raw_payload.secondary_intents:
            norm = IntentClassifier.normalize_intent(sec)
            if norm != primary_intent and norm not in secondary:
                secondary.append(norm)

        merged_keywords = _dedupe_preserve_order(
            list(raw_payload.keywords) + heuristic_kw,
            limit=12,
        )
        merged_entities = _dedupe_preserve_order(
            list(raw_payload.entities) + heuristic_ent,
            limit=10,
        )

        sub_questions = _dedupe_preserve_order(raw_payload.sub_questions, limit=self.max_sub_queries)
        is_multi_part = bool(raw_payload.is_multi_part or len(sub_questions) >= 2)
        if is_multi_part and not sub_questions:
            sub_questions = IntentClassifier.split_multi_part_heuristically(
                question,
                max_sub_queries=self.max_sub_queries,
            )

        is_follow_up = bool(raw_payload.is_follow_up and context_turns)
        requires_context = bool((raw_payload.requires_context_resolution or is_follow_up) and context_turns)

        clarifications = _dedupe_preserve_order(raw_payload.suggested_clarifications, limit=3)

        return QueryAnalysis(
            intent=primary_intent,
            secondary_intents=secondary,
            keywords=merged_keywords,
            entities=merged_entities,
            is_ambiguous=bool(raw_payload.is_ambiguous),
            ambiguity_reason=(
                raw_payload.ambiguity_reason.strip()
                if raw_payload.is_ambiguous and isinstance(raw_payload.ambiguity_reason, str) and raw_payload.ambiguity_reason.strip()
                else None
            ),
            clarification_needed=bool(raw_payload.clarification_needed or (raw_payload.is_ambiguous and len(clarifications) > 0)),
            suggested_clarifications=clarifications if raw_payload.is_ambiguous else [],
            is_multi_part=is_multi_part,
            sub_questions=sub_questions,
            is_follow_up=is_follow_up,
            requires_context_resolution=requires_context,
            is_clear_standalone=bool(
                raw_payload.is_clear_standalone
                and not raw_payload.is_ambiguous
                and not is_follow_up
                and not is_multi_part
            ),
            language=(raw_payload.language or "en").strip()[:12],
            confidence=float(max(0.0, min(1.0, raw_payload.confidence))),
        )

    def build_fallback_analysis(
        self,
        question: str,
        context_turns: list[ConversationTurn],
    ) -> QueryAnalysis:
        """Build deterministic QueryAnalysis cleanly when Gemini cannot be invoked."""
        keywords, entities = IntentClassifier.extract_keywords_and_entities(question)
        heur = IntentClassifier.classify_heuristically(
            question,
            has_history=bool(context_turns),
            max_sub_queries=self.max_sub_queries,
        )

        clarifications: list[str] = []
        if heur["is_ambiguous"]:
            clarifications = ["Please specify the exact policy, system, or timeframe you are asking about."]

        return QueryAnalysis(
            intent=heur["intent"],
            secondary_intents=[],
            keywords=keywords,
            entities=entities,
            is_ambiguous=heur["is_ambiguous"],
            ambiguity_reason=heur["ambiguity_reason"],
            clarification_needed=heur["is_ambiguous"],
            suggested_clarifications=clarifications,
            is_multi_part=heur["is_multi_part"],
            sub_questions=heur["sub_questions"],
            is_follow_up=heur["is_follow_up"],
            requires_context_resolution=heur["is_follow_up"],
            is_clear_standalone=heur["is_clear_standalone"],
            language="en",
            confidence=0.7,
        )
