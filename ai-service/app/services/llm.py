from app.core.config import settings
from app.models.chat import ChatMessage
from app.services.generation_service import gemini_generation_service

def generate_answer(query: str, context_snippets: list[str], chat_history: list[ChatMessage]) -> str:
    """
    Backward-compatible answer generation using configured Gemini generation service.
    """
    if settings.LLM_PROVIDER == "openai" and settings.OPENAI_API_KEY:
        from openai import OpenAI
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        context_text = "\n\n---\n\n".join(context_snippets)
        system_prompt = (
            "You are a helpful enterprise AI assistant.\n"
            "Use the provided document context to answer accurately.\n"
            "If the answer is not in the context, say that you don't know based on the provided documents.\n\n"
            f"CONTEXT:\n{context_text}"
        )
        messages = [{"role": "system", "content": system_prompt}]
        for msg in chat_history:
            messages.append({"role": msg.role, "content": msg.content})
        messages.append({"role": "user", "content": query})
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.0
        )
        return response.choices[0].message.content

    evidence_items = [{"text": snippet, "document_id": "context", "filename": "context"} for snippet in context_snippets]
    return gemini_generation_service.generate_rag_answer(question=query, evidence_items=evidence_items)
