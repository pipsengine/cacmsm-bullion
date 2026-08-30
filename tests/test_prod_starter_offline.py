from __future__ import annotations

import json
import sys
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

    def set(self, key: str, value: str) -> None:
        self._kv[key] = value


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
