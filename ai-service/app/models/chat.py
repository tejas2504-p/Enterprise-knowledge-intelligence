from pydantic import BaseModel

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    query: str
    knowledge_base_ids: list[str]
    chat_history: list[ChatMessage] = []

class SourceSnippet(BaseModel):
    document_id: str
    title: str
    score: float
    text_snippet: str

class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceSnippet]
