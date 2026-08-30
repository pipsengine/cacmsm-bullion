from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any
from fastapi import FastAPI, Response, status
from redis import Redis

from cacsms_shared.config import BaseServiceSettings, load_settings
from cacsms_shared.json_logging import configure_json_logging
from cacsms_shared.redis_streams import xadd_json
from cacsms_shared.retry import with_retry


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
log = logging.getLogger(__name__)


class Settings(BaseServiceSettings):
    symbol: str = "XAUUSD"
    feed_mode: str = "SIMULATOR"  # SIMULATOR|MT5
    tick_ms: int = 250

    stream_market: str = "stream:market"
    key_last_tick_ts: str = "telemetry:last_tick_ts"

    control_key: str = "control:running"
    kill_key: str = "control:kill"


class _SimulatorWorker:
    def __init__(self, *, r: Redis, settings: Settings):
        self._r = r
        self._s = settings
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        import random

        mid = 2400.0
        spread = 0.20

        while not self._stop.is_set():
            running = self._r.get(self._s.control_key) == "1"
            kill = self._r.get(self._s.kill_key) == "1"
            if (not running) or kill:
                time.sleep(0.5)
                continue

            # regime-ish behaviour: occasional volatility bursts
            if random.random() < 0.01:
                spread = min(1.2, spread * 1.8)
            else:
                spread = max(0.15, spread * 0.98)

            step = random.gauss(0, 0.08)
            mid = max(10.0, mid + step)

            bid = mid - spread / 2
            ask = mid + spread / 2
            payload = {
                "ts": utc_now().isoformat(),
                "symbol": self._s.symbol,
                "bid": round(bid, 5),
                "ask": round(ask, 5),
                "spread": round(spread, 5),
                "source": "SIM",
            }
            xadd_json(self._r, self._s.stream_market, payload)
            self._r.set(self._s.key_last_tick_ts, payload["ts"])
            time.sleep(max(10, self._s.tick_ms) / 1000.0)


def create_app(*, redis_client: Any | None = None) -> FastAPI:
    settings = load_settings(Settings, service_name="market-data-service")
    if settings.json_logs:
        configure_json_logging(service_name=settings.service_name, level=settings.log_level)

    app = FastAPI(title="Cacsms-Bullion Market Data Service", version="0.2.0")
    app.state.settings = settings
    app.state.redis = redis_client
    app.state.worker = None

    @app.on_event("startup")
    def _startup() -> None:
        if app.state.redis is None:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)

        if settings.feed_mode.upper() == "SIMULATOR":
            app.state.worker = _SimulatorWorker(r=app.state.redis, settings=settings)
            app.state.worker.start()
            log.info("market-data simulator started", extra={"fields": {"tick_ms": settings.tick_ms}})
        else:
            # In MT5 mode, market feed should be published by the MT5 connector (outside this container).
            log.warning("FEED_MODE != SIMULATOR; this service will not generate ticks")

    @app.on_event("shutdown")
    def _shutdown() -> None:
        if app.state.worker:
            app.state.worker.stop()

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

    @app.get("/market/latest")
    def latest(limit: int = 10):
        r = app.state.redis
        entries = r.xrevrange(settings.stream_market, max="+", min="-", count=max(1, min(limit, 50)))
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
