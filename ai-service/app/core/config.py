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
    CHUNK_SIZE: int = 1000
    CHUNK_OVERLAP: int = 200
    CHUNK_SEPARATORS: list[str] = ["\n\n", "\n", " ", ""]
    CHUNK_KEEP_SEPARATORS: bool = True
    CHUNK_MIN_SIZE: int = 1
    CHUNK_ID_PREFIX: str = "chunk"
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()

