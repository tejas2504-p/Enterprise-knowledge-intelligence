import inspect
import re
from typing import Any, Optional
from bson import ObjectId
from fastapi import HTTPException, status

from app.core.config import settings
from app.models.query_understanding import ConversationTurn


class ContextAwareQueryProcessor:
    """
    Safely prepares conversation history for context-aware query resolution:
    - Enforces user ownership when resolving conversationId directly from MongoDB
    - Strips internal reasoning tags and truncates turns cleanly
    - Bounds context window to configured max history turns
    """

    def __init__(
        self,
        max_history_turns: Optional[int] = None,
        max_turn_chars: int = 500,
    ):
        self.max_history_turns = (
            max_history_turns
            if max_history_turns is not None
            else getattr(settings, "QUERY_MAX_HISTORY_TURNS", 6)
        )
        self.max_turn_chars = max_turn_chars

    @staticmethod
    def _clean_turn_content(text: str, max_chars: int) -> str:
        # Remove any hidden reasoning tags and normalize whitespace
        cleaned = re.sub(r"<(thought|thinking)>[\s\S]*?</\1>", "", text or "", flags=re.IGNORECASE)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if len(cleaned) > max_chars:
            cleaned = cleaned[:max_chars].rstrip() + "..."
        return cleaned

    def sanitize_turns(self, turns: list[ConversationTurn]) -> list[ConversationTurn]:
        """Keep at most the most recent N bounded conversation turns."""
        if not turns:
            return []

        bounded = turns[-self.max_history_turns :]
        cleaned: list[ConversationTurn] = []
        for t in bounded:
            txt = self._clean_turn_content(t.content, self.max_turn_chars)
            if txt:
                cleaned.append(ConversationTurn(role=t.role, content=txt))
        return cleaned

    async def resolve_context(
        self,
        provided_history: Optional[list[ConversationTurn]] = None,
        conversation_id: Optional[str] = None,
        db: Any = None,
        user_id: Optional[str] = None,
        user_role: str = "user",
    ) -> list[ConversationTurn]:
        """
        Return sanitized conversation history either from explicit turns or
        authorized MongoDB Conversation lookup.
        """
        if provided_history:
            return self.sanitize_turns(provided_history)

        if not conversation_id or db is None:
            return []

        conv_coll = db["conversations"]
        find_one_fn = getattr(conv_coll, "find_one", None)
        if not callable(find_one_fn):
            return []

        query = {"_id": ObjectId(conversation_id)} if ObjectId.is_valid(conversation_id) else {"_id": conversation_id}
        conv_result = find_one_fn(query)
        conv = await conv_result if inspect.isawaitable(conv_result) else conv_result

        if not isinstance(conv, dict):
            return []

        conv_owner = str(conv.get("user", ""))
        if user_role != "admin" and user_id and conv_owner and conv_owner != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to access conversation context",
            )

        raw_messages = conv.get("messages") or []
        parsed_turns: list[ConversationTurn] = []
        for msg in raw_messages:
            if not isinstance(msg, dict):
                continue
            role = msg.get("role")
            content = msg.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                parsed_turns.append(ConversationTurn(role=role, content=content[:2000]))

        return self.sanitize_turns(parsed_turns)
