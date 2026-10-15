from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    SERVICE_API_KEY: str = "internal_service_key_dev"
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str | None = None
    EMBEDDING_PROVIDER: str = "openai"
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str | None = None
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


