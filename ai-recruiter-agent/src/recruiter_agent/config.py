"""Runtime configuration, read from environment variables prefixed with ``RA_``."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RA_", env_file=".env", extra="ignore")

    # "heuristic" needs no model at all; "llm" uses the provider below.
    engine: Literal["heuristic", "llm"] = "heuristic"
    llm_provider: Literal["ollama", "bedrock"] = "ollama"
    llm_model: str = "llama3.2:3b"
    ollama_base_url: str = "http://localhost:11434"
    aws_region: str = "us-east-1"
    temperature: float = 0.0
    max_concurrency: int = 4

    retrieval_k: int = 4
    advance_threshold: float = 75.0
    hold_threshold: float = 50.0

    store: Literal["memory", "dynamodb"] = "memory"
    dynamodb_table: str = "recruiter-agent-screenings"

    # When set, every /v1 request must send it in the X-API-Key header.
    api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
