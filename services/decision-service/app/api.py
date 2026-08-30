from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Response, status
from pydantic import BaseModel
from redis import Redis

from cacsms_shared.config import BaseServiceSettings, load_settings
from cacsms_shared.json_logging import configure_json_logging
from cacsms_shared.persistence import EventStore, create_db_engine, init_db
from cacsms_shared.retry import with_retry

log = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Settings(BaseServiceSettings):
    symbol: str = "XAUUSD"
    stream_market: str = "stream:market"
    stream_decisions: str = "stream:decisions"
    key_last_decision_ts: str = "telemetry:last_decision_ts"
    key_last_market_id: str = "telemetry:last_market_id:decision-service"
    control_key: str = "control:running"
    mode_key: str = "control:mode"
    kill_key: str = "control:kill"


class ServiceStatus(BaseModel):
    ts: datetime
    engine_running: bool
    last_decision_ts: str | None


def create_app(*, redis_client: Any | None = None) -> FastAPI:
    settings = load_settings(Settings, service_name="decision-service")
    if settings.json_logs:
        configure_json_logging(service_name=settings.service_name, level=settings.log_level)

    app = FastAPI(title="Cacsms-Bullion Decision Service", version="0.2.0")
    app.state.settings = settings
    app.state.redis = redis_client
    app.state.engine = None
    app.state.event_store = None

    @app.on_event("startup")
    def _startup() -> None:
        if app.state.redis is None:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)

        if settings.db_enabled and settings.database_url:
            db = create_db_engine(settings.database_url)
            init_db(db)
            app.state.event_store = EventStore(db, service_name=settings.service_name)

        from .engine import DecisionEngine  # local import

        app.state.engine = DecisionEngine(
            redis_client=app.state.redis,
            symbol=settings.symbol,
            stream_market=settings.stream_market,
            stream_decisions=settings.stream_decisions,
            key_last_decision_ts=settings.key_last_decision_ts,
            key_last_market_id=settings.key_last_market_id,
            control_key=settings.control_key,
            mode_key=settings.mode_key,
            kill_key=settings.kill_key,
            event_store=app.state.event_store,
        )
        app.state.engine.start()
        log.info("decision-service started", extra={"fields": {"db_enabled": settings.db_enabled}})

    @app.on_event("shutdown")
    def _shutdown() -> None:
        if app.state.engine:
            app.state.engine.stop()

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

    @app.get("/health", response_model=ServiceStatus)
    def health():
        last_ts = app.state.redis.get(settings.key_last_decision_ts)
        running = bool(app.state.engine and app.state.engine._thread and app.state.engine._thread.is_alive())  # noqa: SLF001
        return ServiceStatus(ts=utc_now(), engine_running=running, last_decision_ts=last_ts)

    @app.get("/decisions/latest")
    def latest(limit: int = 10):
        r = app.state.redis
        entries = r.xrevrange(settings.stream_decisions, max="+", min="-", count=max(1, min(limit, 50)))
        out = []
        for _id, fields in entries:
            if "json" in fields:
                out.append(json.loads(fields["json"]))
        return {"items": out}

    return app


@with_retry(attempts=3, base_delay_s=0.05, max_delay_s=0.3)
def _ping_redis(r: Any) -> None:
    r.get("__cacsms_ready__")


app = create_app()
