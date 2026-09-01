from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Response, status
from pydantic import BaseModel
from redis import Redis

from cacsms_shared.config import BaseServiceSettings, load_settings
from cacsms_shared.json_logging import configure_json_logging
from cacsms_shared.retry import with_retry


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


log = logging.getLogger(__name__)


class Settings(BaseServiceSettings):
    control_key: str = "control:running"
    mode_key: str = "control:mode"
    kill_key: str = "control:kill"
    key_last_tick_ts: str = "telemetry:last_tick_ts"
    key_last_decision_ts: str = "telemetry:last_decision_ts"
    watchdog_interval_s: float = 1.0
    feed_stale_halt_ms: int = 15000


def ms_since(ts_iso: Optional[str]) -> Optional[int]:
    if not ts_iso:
        return None
    try:
        ts = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
        return int((utc_now() - ts).total_seconds() * 1000)
    except Exception:
        return None


class Summary(BaseModel):
    ts: datetime
    running: bool
    mode: str
    kill: bool
    last_tick_age_ms: Optional[int]
    last_decision_age_ms: Optional[int]
    notes: list[str]


def create_app(*, redis_client: Redis | None = None) -> FastAPI:
    settings = load_settings(Settings, service_name="monitoring-service")
    if settings.json_logs:
        configure_json_logging(service_name=settings.service_name, level=settings.log_level)

    app = FastAPI(title="Cacsms-Bullion Monitoring Service", version="0.2.0")
    app.state.settings = settings
    app.state.redis = redis_client
    app.state.watchdog_stop = threading.Event()
    app.state.watchdog_thread = None

    def enforce_feed_safety() -> bool:
        r = app.state.redis
        running = r.get(settings.control_key) == "1"
        tick_age = ms_since(r.get(settings.key_last_tick_ts))
        if running and tick_age is not None and tick_age > settings.feed_stale_halt_ms:
            r.set(settings.kill_key, "1")
            r.set(settings.control_key, "0")
            log.error("kill switch triggered by stale market feed", extra={"fields": {"tick_age_ms": tick_age}})
            return True
        return False

    def watchdog() -> None:
        while not app.state.watchdog_stop.wait(settings.watchdog_interval_s):
            try:
                enforce_feed_safety()
            except Exception:  # noqa: BLE001
                log.exception("monitoring watchdog check failed")

    @app.on_event("startup")
    def _startup() -> None:
        if app.state.redis is None:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        app.state.watchdog_stop.clear()
        app.state.watchdog_thread = threading.Thread(target=watchdog, name="feed-safety-watchdog", daemon=True)
        app.state.watchdog_thread.start()
        log.info("monitoring-service started")

    @app.on_event("shutdown")
    def _shutdown() -> None:
        app.state.watchdog_stop.set()
        if app.state.watchdog_thread:
            app.state.watchdog_thread.join(timeout=max(1.0, settings.watchdog_interval_s * 2))

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "ts": utc_now().isoformat(), "service": settings.service_name}

    @app.get("/readyz")
    def readyz(resp: Response):
        try:
            _ping_redis(app.state.redis)
            return {"status": "ready", "ts": utc_now().isoformat()}
        except Exception as e:  # noqa: BLE001
            resp.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "not_ready", "error": str(e), "ts": utc_now().isoformat()}

    @app.get("/health/summary", response_model=Summary)
    def summary() -> Summary:
        r = app.state.redis
        running = r.get(settings.control_key) == "1"
        mode = r.get(settings.mode_key) or "demo"
        kill = r.get(settings.kill_key) == "1"

        tick_age = ms_since(r.get(settings.key_last_tick_ts))
        decision_age = ms_since(r.get(settings.key_last_decision_ts))

        notes: list[str] = []
        if tick_age is None:
            notes.append("No market ticks observed yet.")
        elif tick_age > 5000:
            notes.append("Market feed stale (>5s). Consider reconnect.")

        if decision_age is None:
            notes.append("No decisions observed yet.")
        elif decision_age > 8000:
            notes.append("Decision engine appears stalled (>8s).")

        # MVP auto-halt rule: if tick feed is stale for too long while running, trigger kill switch.
        if enforce_feed_safety():
            notes.append("Kill switch triggered: feed stale for >15s.")
            kill = True
            running = False

        return Summary(
            ts=utc_now(),
            running=running,
            mode=mode,
            kill=kill,
            last_tick_age_ms=tick_age,
            last_decision_age_ms=decision_age,
            notes=notes,
        )

    return app


@with_retry(attempts=3, base_delay_s=0.05, max_delay_s=0.3)
def _ping_redis(r: Redis) -> None:
    r.get("__cacsms_ready__")


app = create_app()
