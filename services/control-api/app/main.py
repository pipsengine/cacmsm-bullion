from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
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
    admin_api_token: str | None = None


def create_app(*, redis_client: Any | None = None) -> FastAPI:
    settings = load_settings(Settings, service_name="control-api")
    if settings.json_logs:
        configure_json_logging(service_name=settings.service_name, level=settings.log_level)

    app = FastAPI(title="Cacsms-Bullion Control API", version="0.2.0")
    app.state.settings = settings
    app.state.redis = redis_client

    @app.on_event("startup")
    def _startup() -> None:
        if app.state.redis is None:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        log.info("control-api started", extra={"fields": {"redis_url": settings.redis_url}})

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "ts": utc_now().isoformat(), "service": settings.service_name}

    @app.get("/readyz")
    def readyz(resp: Response):
        r = app.state.redis
        try:
            _ping_redis(r)
            return {"status": "ready", "ts": utc_now().isoformat()}
        except Exception as e:  # noqa: BLE001
            resp.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "not_ready", "error": str(e), "ts": utc_now().isoformat()}

    class Status(BaseModel):
        ts: datetime
        running: bool
        mode: str
        kill: bool

    @app.get("/control/status", response_model=Status)
    def status_() -> Status:
        r = app.state.redis
        running = r.get(settings.control_key) == "1"
        mode = r.get(settings.mode_key) or "demo"
        kill = r.get(settings.kill_key) == "1"
        return Status(ts=utc_now(), running=running, mode=mode, kill=kill)

    def require_admin(x_admin_token: str | None = Header(default=None)) -> None:
        if not settings.admin_api_token:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="ADMIN_API_TOKEN is not configured",
            )
        if not x_admin_token or not secrets.compare_digest(x_admin_token, settings.admin_api_token):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid admin token")

    @app.post("/control/start", dependencies=[Depends(require_admin)])
    def start():
        r = app.state.redis
        r.set(settings.control_key, "1")
        if not r.get(settings.mode_key):
            r.set(settings.mode_key, "demo")
        return {"ok": True, "running": True}

    @app.post("/control/stop", dependencies=[Depends(require_admin)])
    def stop():
        r = app.state.redis
        r.set(settings.control_key, "0")
        return {"ok": True, "running": False}

    @app.post("/control/halt", dependencies=[Depends(require_admin)])
    def halt():
        r = app.state.redis
        r.set(settings.kill_key, "1")
        r.set(settings.control_key, "0")
        return {"ok": True, "kill": True, "running": False}

    @app.post("/control/unhalt", dependencies=[Depends(require_admin)])
    def unhalt():
        r = app.state.redis
        r.set(settings.kill_key, "0")
        return {"ok": True, "kill": False}

    @app.post("/control/mode/{mode}", dependencies=[Depends(require_admin)])
    def set_mode(mode: str):
        r = app.state.redis
        mode = mode.lower()
        if mode not in ("demo", "prop", "live"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mode must be demo|prop|live")
        r.set(settings.mode_key, mode)
        return {"ok": True, "mode": mode}

    return app


@with_retry(attempts=3, base_delay_s=0.05, max_delay_s=0.3)
def _ping_redis(r: Any) -> None:
    # Use an operation supported by most redis client fakes (and avoid requiring .ping()).
    r.get("__cacsms_ready__")


app = create_app()
