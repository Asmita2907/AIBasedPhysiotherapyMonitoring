import os
from dataclasses import dataclass, field


def _origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "*")
    return [o.strip() for o in raw.split(",") if o.strip()]


@dataclass(frozen=True)
class Settings:
    supabase_url: str = field(default_factory=lambda: os.environ.get("SUPABASE_URL", "").rstrip("/"))
    supabase_service_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
    cors_origins: list[str] = field(default_factory=_origins)


def get_settings() -> Settings:
    return Settings()
