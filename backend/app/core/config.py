"""Application settings loaded from environment variables (Pydantic v2)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central typed configuration for the whole backend."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- General ---
    PROJECT_NAME: str = "Assistant IA PHOSBOUCRAA"
    ENVIRONMENT: str = "development"
    API_V1_PREFIX: str = "/api/v1"

    # --- Database ---
    DATABASE_URL: str = "postgresql+psycopg://phosboucraa:phosboucraa@db:5432/phosboucraa"
    # Set true when connecting through a transaction-mode pooler (e.g. Supabase
    # port 6543 / pgbouncer) which does not support prepared statements.
    DB_DISABLE_PREPARED_STATEMENTS: bool = False

    # --- Redis / Celery ---
    REDIS_URL: str = "redis://redis:6379/0"
    CELERY_BROKER_URL: str = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND: str = "redis://redis:6379/2"

    # --- MinIO / object storage ---
    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_ROOT_USER: str = "minioadmin"
    MINIO_ROOT_PASSWORD: str = "minioadmin"
    MINIO_BUCKET: str = "documents"
    MINIO_SECURE: bool = False

    # --- Security ---
    SECRET_KEY: str = "CHANGE_ME_super_secret_key_for_jwt_signing_min_32_chars"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # --- AI / NLP ---
    LLM_PROVIDER: str = "none"  # mistral | openai | none
    OPENAI_API_KEY: str = ""
    MISTRAL_API_KEY: str = ""
    SPACY_MODEL_FR: str = "fr_core_news_md"
    SPACY_MODEL_EN: str = "en_core_web_sm"
    EMBEDDING_MODEL: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    EMBEDDING_DIM: int = 384

    # --- Embedding cache (Redis DB2) ---
    # Cache CV-text embeddings keyed by SHA-256 to skip the model call on repeats.
    REDIS_CACHE_URL: str = "redis://redis:6379/2"
    EMBEDDING_CACHE_ENABLED: bool = True
    EMBEDDING_CACHE_TTL_SECONDS: int = 60 * 60 * 24 * 30  # 30 days

    # --- Bootstrap admin ---
    FIRST_ADMIN_EMAIL: str = "admin@phosboucraa.ma"
    FIRST_ADMIN_PASSWORD: str = "Admin@1234"

    # --- CORS ---
    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:5173",
        ]
    )


@lru_cache
def get_settings() -> Settings:
    """Return a cached singleton of the application settings."""
    return Settings()


settings = get_settings()
