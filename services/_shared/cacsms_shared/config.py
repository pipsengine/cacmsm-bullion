from __future__ import annotations

import os
from pathlib import Path
from typing import Any, TypeVar

import yaml
from pydantic import BaseModel, Field


class BaseServiceSettings(BaseModel):
    """
    Minimal, production-leaning settings model.

    Loading precedence (lowest -> highest):
      1) built-in defaults
      2) YAML config file (CONFIG_FILE)
      3) environment variables

    YAML structure:
      global:
        log_level: INFO
      services:
        execution-service:
          redis_url: redis://redis:6379/0
    """

    service_name: str = Field(default="service")
    environment: str = Field(default="local", description="e.g. local|dev|staging|prod")

    # Logging
    log_level: str = Field(default="INFO")
    json_logs: bool = Field(default=True)

    # Infra
    redis_url: str = Field(default="redis://localhost:6379/0")

    # Persistence (optional; can be disabled for local/offline)
    db_enabled: bool = Field(default=False)
    database_url: str | None = Field(default=None)

    # Config file loader
    config_file: str | None = Field(default=None, description="Path to YAML config file")


T = TypeVar("T", bound=BaseServiceSettings)


def _deep_merge(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    """Merge b into a recursively, returning a new dict."""
    out = dict(a)
    for k, v in b.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)  # type: ignore[arg-type]
        else:
            out[k] = v
    return out


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        return {}
    return data


def _resolve_config_path(raw: str) -> Path:
    p = Path(raw)
    if p.is_absolute():
        return p
    # Resolve relative paths against current working directory, which is the repo root in local usage.
    return (Path.cwd() / p).resolve()


def load_settings(model: type[T], *, service_name: str) -> T:
    """
    Load settings for a given service.

    Environment variables:
      - ENVIRONMENT, LOG_LEVEL, JSON_LOGS
      - REDIS_URL
      - DB_ENABLED, DATABASE_URL
      - ADMIN_API_TOKEN
      - CONFIG_FILE (path)
    """

    config_file = os.environ.get("CONFIG_FILE") or os.environ.get("CACSMS_CONFIG_FILE")
    base: dict[str, Any] = {}
    if config_file:
        cfg = _read_yaml(_resolve_config_path(config_file))
        base = _deep_merge(base, cfg.get("global", {}) if isinstance(cfg.get("global"), dict) else {})
        services = cfg.get("services", {}) if isinstance(cfg.get("services"), dict) else {}
        svc_cfg = services.get(service_name, {}) if isinstance(services.get(service_name), dict) else {}
        base = _deep_merge(base, svc_cfg)

    # Env overrides
    env: dict[str, Any] = {
        "service_name": service_name,
        "environment": os.environ.get("ENVIRONMENT", base.get("environment", "local")),
        "log_level": os.environ.get("LOG_LEVEL", base.get("log_level", "INFO")),
        "json_logs": _parse_bool(os.environ.get("JSON_LOGS"), default=base.get("json_logs", True)),
        "redis_url": os.environ.get("REDIS_URL", base.get("redis_url", "redis://localhost:6379/0")),
        "db_enabled": _parse_bool(os.environ.get("DB_ENABLED"), default=base.get("db_enabled", False)),
        "database_url": os.environ.get("DATABASE_URL", base.get("database_url")),
        "admin_api_token": os.environ.get("ADMIN_API_TOKEN", base.get("admin_api_token")),
        "config_file": config_file,
    }
    merged = _deep_merge(base, env)
    return model.model_validate(merged)


def _parse_bool(v: str | None, *, default: bool) -> bool:
    if v is None:
        return bool(default)
    v = v.strip().lower()
    if v in ("1", "true", "yes", "y", "on"):
        return True
    if v in ("0", "false", "no", "n", "off"):
        return False
    return bool(default)
