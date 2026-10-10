from openai import OpenAI
from app.core.config import settings

# Initialize client if API key is present
client = OpenAI(api_key=settings.OPENAI_API_KEY) if settings.OPENAI_API_KEY else None

def get_embeddings(texts: list[str]) -> list[list[float]]:
    if not client:
        raise ValueError("OpenAI API key not configured")
        
    response = client.embeddings.create(
        input=texts,
        model="text-embedding-ada-002"
    )
    return [data.embedding for data in response.data]

def get_embedding(text: str) -> list[float]:
    return get_embeddings([text])[0]
