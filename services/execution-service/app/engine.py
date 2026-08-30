from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

from pydantic import ValidationError
from redis import Redis

from cacsms_shared.persistence import EventStore, OrderIdempotencyStore
from cacsms_shared.redis_streams import xadd_json, xread_entries_json
from cacsms_shared.schemas import DecisionIntent

log = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ExecutionEngine:
    def __init__(
        self,
        *,
        redis_client: Redis,
        route_mode: str,
        symbol: str,
        stream_decisions: str,
        stream_orders: str,
        stream_executions: str,
        key_last_exec_ts: str,
        key_last_decision_id: str,
        max_order_size: float,
        control_key: str,
        kill_key: str,
        mode_key: str,
        event_store: EventStore | None = None,
        idempotency_store: OrderIdempotencyStore | None = None,
    ):
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._last_id = "$"
        self._r = redis_client
        self._route_mode = route_mode.upper()
        self._symbol = symbol
        self._stream_decisions = stream_decisions
        self._stream_orders = stream_orders
        self._stream_executions = stream_executions
        self._key_last_exec_ts = key_last_exec_ts
        self._key_last_decision_id = key_last_decision_id
        self._max_order_size = max_order_size
        self._control_key = control_key
        self._kill_key = kill_key
        self._mode_key = mode_key
        self._event_store = event_store
        self._idempotency = idempotency_store

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _emit_execution(self, client_order_id: str, status: str, message: str, fill_price: float | None = None):
        payload = {
            "ts": utc_now().isoformat(),
            "symbol": self._symbol,
            "client_order_id": client_order_id,
            "status": status,
            "message": message,
            "fill_price": fill_price,
        }
        xadd_json(self._r, self._stream_executions, payload)
        self._r.set(self._key_last_exec_ts, payload["ts"])
        if self._event_store:
            try:
                self._event_store.append(
                    event_type="execution_event",
                    payload=payload,
                    stream=self._stream_executions,
                    redis_id=None,
                )
            except Exception:  # noqa: BLE001
                log.exception("failed to persist execution_event")

    def _simulate_fill(self, order: dict):
        # Very simple fill simulation: accept + fill immediately at mid-ish.
        import random

        self._emit_execution(order["client_order_id"], "ACCEPTED", "accepted by simulator")
        time.sleep(0.05)
        base = float(order.get("ref_price") or 2400.0)
        slip = random.gauss(0, 0.05)
        fill = round(base + slip, 5)
        self._emit_execution(order["client_order_id"], "FILLED", "filled by simulator", fill_price=fill)

    def _route_order(self, order: dict):
        if self._route_mode == "SIMULATOR":
            self._simulate_fill(order)
        else:
            # In MT5 mode, we publish to stream:orders for mt5-connector-worker to consume.
            xadd_json(self._r, self._stream_orders, order)
            self._emit_execution(order["client_order_id"], "ACCEPTED", "routed to MT5 connector worker")

    def _validate_trade_decision(self, raw: dict) -> DecisionIntent | None:
        try:
            decision = DecisionIntent.model_validate(raw)
        except ValidationError as exc:
            self._emit_execution("invalid_decision", "REJECTED", f"invalid decision payload: {exc.errors()[0]['msg']}")
            return None

        if decision.symbol != self._symbol:
            return None
        if decision.action == "NO_TRADE":
            return None
        if decision.size <= 0:
            self._emit_execution("invalid_size", "REJECTED", "decision size must be greater than zero")
            return None
        if decision.size > self._max_order_size:
            self._emit_execution("size_limit", "REJECTED", f"decision size exceeds max_order_size={self._max_order_size}")
            return None
        if decision.stop_pips <= 0 or decision.take_pips <= 0:
            self._emit_execution("invalid_risk", "REJECTED", "stop_pips and take_pips must be greater than zero")
            return None
        mode = self._r.get(self._mode_key) or "demo"
        if mode == "live" and self._route_mode != "MT5":
            self._emit_execution("live_route_guard", "REJECTED", "live mode requires route_mode=MT5")
            return None
        return decision

    def _run(self):
        stored_last_id = self._r.get(self._key_last_decision_id)
        if stored_last_id:
            self._last_id = stored_last_id

        while not self._stop.is_set():
            running = self._r.get(self._control_key) == "1"
            kill = self._r.get(self._kill_key) == "1"
            if (not running) or kill:
                time.sleep(0.5)
                continue

            entries, self._last_id = xread_entries_json(
                self._r, stream=self._stream_decisions, last_id=self._last_id, block_ms=1200, count=50
            )
            if not entries:
                continue

            for decision_redis_id, d in entries:
                decision = self._validate_trade_decision(d)
                if decision is None:
                    self._r.set(self._key_last_decision_id, decision_redis_id)
                    continue

                # Idempotency:
                # - stable key based on the source redis stream ID
                # - stable client_order_id derived from that stream ID
                idempotency_key = f"decision:{decision_redis_id}"
                stable_client_order_id = f"cb_{decision_redis_id.replace('-', '')}"
                if self._idempotency:
                    created, existing_id, routed, processed = self._idempotency.register_or_get(
                        idempotency_key=idempotency_key,
                        client_order_id=stable_client_order_id,
                        payload=d,
                    )
                    if processed:
                        self._r.set(self._key_last_decision_id, decision_redis_id)
                        continue
                    if routed:
                        self._emit_execution(existing_id, "ACCEPTED", "idempotent replay: already routed")
                        self._r.set(self._key_last_decision_id, decision_redis_id)
                        continue
                    client_order_id = existing_id
                else:
                    client_order_id = stable_client_order_id

                order = {
                    "ts": utc_now().isoformat(),
                    "symbol": self._symbol,
                    "side": decision.action,
                    "size": float(decision.size),
                    "order_type": "MARKET",
                    "stop_pips": float(decision.stop_pips),
                    "take_pips": float(decision.take_pips),
                    "client_order_id": client_order_id,
                    "mode": self._r.get(self._mode_key) or "demo",
                    "ref_price": None,
                    "idempotency_key": idempotency_key,
                }

                if self._event_store:
                    try:
                        self._event_store.append(
                            event_type="order_request",
                            payload=order,
                            stream=self._stream_orders if self._route_mode != "SIMULATOR" else None,
                            redis_id=None,
                        )
                    except Exception:  # noqa: BLE001
                        log.exception("failed to persist order_request")

                self._route_order(order)
                if self._idempotency:
                    try:
                        self._idempotency.mark_routed(idempotency_key=idempotency_key)
                        self._idempotency.mark_processed(idempotency_key=idempotency_key)
                    except Exception:  # noqa: BLE001
                        log.exception("failed to mark idempotency processed")
                self._r.set(self._key_last_decision_id, decision_redis_id)
