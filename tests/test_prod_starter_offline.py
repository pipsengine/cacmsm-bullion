from __future__ import annotations

import json
import importlib.util
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from cacsms_shared.config import BaseServiceSettings, load_settings
from cacsms_shared.json_logging import configure_json_logging
from cacsms_shared.persistence import EventRecord, EventStore, OrderIdempotencyRecord, OrderIdempotencyStore, create_db_engine, init_db


class FakeRedis:
    def __init__(self):
        self._kv: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self._kv.get(key)

    def set(self, key: str, value: str, *, nx: bool = False) -> bool:
        if nx and key in self._kv:
            return False
        self._kv[key] = value
        return True

    def xadd(self, stream: str, fields: dict[str, str], **_: Any) -> str:
        key = f"stream-count:{stream}"
        count = int(self._kv.get(key, "0")) + 1
        self._kv[key] = str(count)
        return f"{count}-0"


def test_settings_yaml_plus_env_override(tmp_path, monkeypatch: pytest.MonkeyPatch):
    cfg = tmp_path / "cfg.yaml"
    cfg.write_text(
        """
global:
  environment: test
  log_level: WARNING
services:
  control-api:
    redis_url: redis://example:6379/9
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.setenv("CONFIG_FILE", str(cfg))
    monkeypatch.setenv("REDIS_URL", "redis://override:6379/0")

    class S(BaseServiceSettings):
        pass

    s = load_settings(S, service_name="control-api")
    assert s.environment == "test"
    assert s.log_level == "WARNING"
    assert s.redis_url == "redis://override:6379/0"


def test_json_logging_emits_valid_json(capsys: Any):
    configure_json_logging(service_name="unit-test", level="INFO")
    import logging

    logging.getLogger("x").info("hello", extra={"fields": {"k": "v"}})
    out = capsys.readouterr().out.strip().splitlines()
    assert out
    payload = json.loads(out[-1])
    assert payload["service"] == "unit-test"
    assert payload["msg"] == "hello"
    assert payload["k"] == "v"


def test_sqlalchemy_event_and_idempotency_offline():
    engine = create_db_engine("sqlite+pysqlite:///:memory:")
    init_db(engine)

    store = EventStore(engine, service_name="svc")
    store.append(event_type="t", payload={"a": 1}, stream="s", redis_id="1-0")

    idem = OrderIdempotencyStore(engine)
    created1, cid1, routed1, processed1 = idem.register_or_get(idempotency_key="k1", client_order_id="c1", payload={"x": 1})
    idem.mark_routed(idempotency_key="k1")
    idem.mark_processed(idempotency_key="k1")
    created2, cid2, routed2, processed2 = idem.register_or_get(idempotency_key="k1", client_order_id="c2", payload={"x": 2})

    assert created1 is True
    assert routed1 is False
    assert processed1 is False
    assert created2 is False
    assert cid1 == cid2 == "c1"
    assert routed2 is True
    assert processed2 is True

    with Session(engine) as s:
        assert s.scalar(select(func.count()).select_from(EventRecord)) == 1
        events = s.scalars(select(EventRecord)).all()
        assert len(events) == 1
        idem_rows = s.scalars(select(OrderIdempotencyRecord)).all()
        assert len(idem_rows) == 1
        assert idem_rows[0].routed is True
        assert idem_rows[0].processed is True


def test_health_endpoints_offline_no_infra(monkeypatch: pytest.MonkeyPatch):
    # Prevent log noise and make sure we don't require Redis/Postgres.
    monkeypatch.setenv("JSON_LOGS", "false")

    # "control-api" contains a hyphen, so we add its folder to sys.path and import "app.main".
    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root / "services" / "control-api"))
    from app.main import create_app as create_control_app  # type: ignore  # noqa: E402

    r = FakeRedis()
    app = create_control_app(redis_client=r)
    with TestClient(app) as c:
        assert c.get("/healthz").status_code == 200
        assert c.get("/readyz").status_code == 200


def test_control_mutations_require_admin_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JSON_LOGS", "false")
    monkeypatch.setenv("ADMIN_API_TOKEN", "secret-token")

    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root / "services" / "control-api"))
    from app.main import create_app as create_control_app  # type: ignore  # noqa: E402

    r = FakeRedis()
    app = create_control_app(redis_client=r)
    with TestClient(app) as c:
        assert c.post("/control/start").status_code == 401
        assert c.post("/control/start", headers={"x-admin-token": "secret-token"}).status_code == 200


def test_control_mutations_fail_closed_without_configured_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JSON_LOGS", "false")
    monkeypatch.delenv("ADMIN_API_TOKEN", raising=False)

    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root / "services" / "control-api"))
    from app.main import create_app as create_control_app  # type: ignore  # noqa: E402

    with TestClient(create_control_app(redis_client=FakeRedis())) as c:
        assert c.post("/control/start").status_code == 503


def test_execution_route_suppresses_duplicate_client_order_id():
    repo_root = Path(__file__).resolve().parents[1]
    engine_path = repo_root / "services" / "execution-service" / "app" / "engine.py"
    spec = importlib.util.spec_from_file_location("execution_engine_test", engine_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    r = FakeRedis()
    engine = module.ExecutionEngine(
        redis_client=r,
        route_mode="MT5",
        symbol="XAUUSD",
        stream_decisions="stream:decisions",
        stream_orders="stream:orders",
        stream_executions="stream:executions",
        key_last_exec_ts="last:exec",
        key_last_decision_id="last:decision",
        max_order_size=0.1,
        control_key="control:running",
        kill_key="control:kill",
        mode_key="control:mode",
    )
    order = {"client_order_id": "stable-1"}
    assert engine._route_order(order) is True
    assert engine._route_order(order) is False
    assert r.get("stream-count:stream:orders") == "1"


def test_monitoring_watchdog_halts_without_summary_request(tmp_path, monkeypatch: pytest.MonkeyPatch):
    repo_root = Path(__file__).resolve().parents[1]
    cfg = tmp_path / "monitoring.yaml"
    cfg.write_text(
        "services:\n  monitoring-service:\n    watchdog_interval_s: 0.01\n    feed_stale_halt_ms: 10\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("CONFIG_FILE", str(cfg))
    monkeypatch.setenv("JSON_LOGS", "false")

    api_path = repo_root / "services" / "monitoring-service" / "app" / "api.py"
    spec = importlib.util.spec_from_file_location("monitoring_api_test", api_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    r = FakeRedis()
    r.set("control:running", "1")
    r.set("telemetry:last_tick_ts", (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    with TestClient(module.create_app(redis_client=r)):
        deadline = time.time() + 1
        while time.time() < deadline and r.get("control:kill") != "1":
            time.sleep(0.01)
        assert r.get("control:kill") == "1"
        assert r.get("control:running") == "0"
