from openai import OpenAI
from app.core.config import settings
from app.models.chat import ChatMessage

client = OpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else None

def generate_answer(query: str, context_snippets: list[str], chat_history: list[ChatMessage]) -> str:
    if not client:
        raise ValueError("OpenAI API key not configured")
        
    context_text = "\n\n---\n\n".join(context_snippets)
    
    system_prompt = (
        "You are a helpful and professional enterprise AI assistant.\n"
        "Use the provided document context to answer the user's question accurately.\n"
        "If the answer is not in the context, say that you don't know based on the provided documents.\n"
        "Do not make up information.\n\n"
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
