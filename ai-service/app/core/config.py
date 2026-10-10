from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    SERVICE_API_KEY: str
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: str | None = None
    EMBEDDING_PROVIDER: str = "openai"
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str | None = None
    MONGODB_URI: str | None = None
    
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

settings = Settings()
