from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


def configure_json_logging(*, service_name: str, level: str = "INFO") -> None:
    """
    Configure stdlib logging to emit one-line JSON to stdout.

    This intentionally avoids extra dependencies (structlog, etc.).
    """
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level.upper())

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter(service_name=service_name))
    root.addHandler(handler)


class _JsonFormatter(logging.Formatter):
    def __init__(self, *, service_name: str):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "service": self.service_name,
            "msg": record.getMessage(),
        }

        # Useful context (kept small to avoid log bloat)
        payload["src"] = {"file": record.pathname, "line": record.lineno, "fn": record.funcName}

        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)

        # Attach arbitrary structured fields via logger extra={"fields": {...}}
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            payload.update(fields)

        return json.dumps(payload, ensure_ascii=False)

