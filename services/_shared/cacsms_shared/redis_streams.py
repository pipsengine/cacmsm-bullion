from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

import redis


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ms_since(dt: Optional[datetime]) -> Optional[int]:
    if dt is None:
        return None
    return int((utc_now() - dt).total_seconds() * 1000)


def redis_client(redis_url: str) -> redis.Redis:
    return redis.Redis.from_url(redis_url, decode_responses=True)


def xadd_json(r: redis.Redis, stream: str, payload: dict[str, Any], maxlen: int = 5000) -> str:
    return r.xadd(stream, {"json": json.dumps(payload)}, maxlen=maxlen, approximate=True)


def xread_json(
    r: redis.Redis,
    streams: dict[str, str],
    block_ms: int = 2000,
    count: int = 25,
) -> list[tuple[str, list[tuple[str, dict[str, str]]]]]:
    return r.xread(streams=streams, block=block_ms, count=count) or []


def xread_entries_json(
    r: redis.Redis,
    *,
    stream: str,
    last_id: str,
    block_ms: int = 2000,
    count: int = 25,
) -> tuple[list[tuple[str, dict[str, Any]]], str]:
    """
    Convenience helper returning parsed entries with their redis stream IDs.
    """
    res = r.xread(streams={stream: last_id}, block=block_ms, count=count) or []
    if not res:
        return [], last_id

    _, entries = res[0]
    out: list[tuple[str, dict[str, Any]]] = []
    new_last = last_id
    for entry_id, fields in entries:
        new_last = entry_id
        out.append((entry_id, parse_json_field(fields)))
    return out, new_last


def parse_json_field(fields: dict[str, str]) -> dict[str, Any]:
    raw = fields.get("json")
    if not raw:
        return {}
    return json.loads(raw)
