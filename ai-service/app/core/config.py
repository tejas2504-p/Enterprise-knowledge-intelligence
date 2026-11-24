from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    SERVICE_API_KEY: str = "internal_service_key_dev"
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str | None = None
    QDRANT_LOCAL_PATH: str | None = None
    QDRANT_COLLECTION_NAME: str = "knowledge_chunks"
    QDRANT_DISTANCE: str = "Cosine"
    QDRANT_TIMEOUT: float = 20.0
    QDRANT_PREFER_GRPC: bool = False
    EMBEDDING_PROVIDER: str = "gemini"
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str | None = None
    GEMINI_API_KEY: str | None = None
    EMBEDDING_MODEL: str = "text-embedding-004"
    EMBEDDING_DIMENSION: int = 768
    EMBEDDING_TASK_TYPE: str = "RETRIEVAL_DOCUMENT"
    EMBEDDING_BATCH_SIZE: int = 64
    EMBEDDING_TIMEOUT: float = 30.0
    EMBEDDING_MAX_RETRIES: int = 4
    EMBEDDING_BACKOFF_FACTOR: float = 1.5
    EMBEDDING_MIN_BACKOFF: float = 0.5
    EMBEDDING_MAX_BACKOFF: float = 10.0
    
    # RAG Generation Configuration
    GEMINI_GENERATION_MODEL: str = "gemini-2.5-flash"
    RAG_TOP_K: int = 5
    RAG_SIMILARITY_THRESHOLD: float = 0.65
    RAG_TEMPERATURE: float = 0.0
    RAG_MAX_OUTPUT_TOKENS: int = 2048
    RAG_GENERATION_TIMEOUT: float = 30.0
    
    MONGODB_URI: str | None = None
    
    # Text Chunking Engine Configuration
    CHUNK_SIZE: int = 800
    CHUNK_OVERLAP: int = 120
    CHUNK_MIN_SIZE: int = 20
    CHUNK_ID_PREFIX: str = "chunk"
    TOKENIZER_STRATEGY: str = "tiktoken"  # "tiktoken" or "words"
    TIKTOKEN_ENCODING: str = "cl100k_base"
    CHUNK_SEPARATORS: list[str] = [
        "\f",         # Form feed / PDF page break
        "\n\n",       # Paragraph break
        "\n",         # Line break
        ". ",         # Sentence break
        "! ", 
        "? ", 
        "; ", 
        ", ",         # Clause break
        " ",          # Word break
        ""            # Character fallback
    ]
    CHUNK_KEEP_SEPARATORS: bool = True
    MONGODB_DB_NAME: str = "enterprise_knowledge"
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()


