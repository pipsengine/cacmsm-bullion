from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

from redis import Redis


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
STREAM_ORDERS = os.environ.get("STREAM_ORDERS", "stream:orders")
STREAM_EXECUTIONS = os.environ.get("STREAM_EXECUTIONS", "stream:executions")
SYMBOL = os.environ.get("SYMBOL", "XAUUSD")
CHECKPOINT_KEY = os.environ.get("MT5_CHECKPOINT_KEY", "telemetry:last_order_id:mt5-connector")

r = Redis.from_url(REDIS_URL, decode_responses=True)


def xadd_json(stream: str, payload: dict, maxlen: int = 5000) -> str:
    return r.xadd(stream, {"json": json.dumps(payload)}, maxlen=maxlen, approximate=True)


def xread_json(stream: str, last_id: str, block_ms: int = 2000, count: int = 25):
    res = r.xread({stream: last_id}, block=block_ms, count=count) or []
    if not res:
        return [], last_id
    _, entries = res[0]
    out = []
    new_last = last_id
    for entry_id, fields in entries:
        new_last = entry_id
        raw = fields.get("json")
        if raw:
            out.append((entry_id, json.loads(raw)))
    return out, new_last


class MT5Connector:
    """
    Skeleton connector.

    If MetaTrader5 Python API is available, you can implement:
    - initialize() / shutdown()
    - symbol_select()
    - order_send()
    - positions_get(), orders_get(), history_deals_get()
    """

    def __init__(self):
        self.mt5 = None

    def available(self) -> bool:
        try:
            import MetaTrader5 as mt5  # type: ignore

            self.mt5 = mt5
            return True
        except Exception:
            return False

    def connect(self) -> bool:
        if not self.mt5:
            return False
        if not self.mt5.initialize():
            return False
        return True

    def send_market_order(self, symbol: str, side: str, size: float) -> tuple[bool, str, float | None]:
        # NOTE: Real implementation depends on MT5 API details and broker symbol format.
        # This is intentionally minimal and should be replaced.
        if not self.mt5:
            return False, "MetaTrader5 not available", None
        # Placeholder: return failure until implemented safely.
        return False, "MT5 send_market_order not implemented in MVP skeleton", None


def main():
    connector = MT5Connector()
    has_mt5 = connector.available()

    if has_mt5:
        ok = connector.connect()
        print(f"MT5 available. connect={ok}")
    else:
        print("MetaTrader5 package not available. Running in skeleton mode (will reject orders).")

    # On first startup consume already-queued orders; subsequent startups resume
    # strictly after the durable checkpoint.
    last_id = r.get(CHECKPOINT_KEY) or "0-0"
    while True:
        batch, last_id = xread_json(STREAM_ORDERS, last_id, block_ms=1500, count=25)
        if not batch:
            continue

        for entry_id, order in batch:
            if order.get("symbol") != SYMBOL:
                r.set(CHECKPOINT_KEY, entry_id)
                continue
            client_order_id = order.get("client_order_id", "unknown")
            claim_key = f"mt5:order:claimed:{client_order_id}"
            if not r.set(claim_key, "1", nx=True):
                r.set(CHECKPOINT_KEY, entry_id)
                continue
            side = order.get("side")
            size = float(order.get("size", 0.0))

            if not has_mt5:
                xadd_json(
                    STREAM_EXECUTIONS,
                    {
                        "ts": utc_now().isoformat(),
                        "symbol": SYMBOL,
                        "client_order_id": client_order_id,
                        "status": "REJECTED",
                        "message": "MT5 connector skeleton mode (install MetaTrader5 on Windows)",
                        "fill_price": None,
                    },
                )
                r.set(CHECKPOINT_KEY, entry_id)
                continue

            ok, msg, fill = connector.send_market_order(SYMBOL, side, size)
            xadd_json(
                STREAM_EXECUTIONS,
                {
                    "ts": utc_now().isoformat(),
                    "symbol": SYMBOL,
                    "client_order_id": client_order_id,
                    "status": "FILLED" if ok else "REJECTED",
                    "message": msg,
                    "fill_price": fill,
                },
            )
            r.set(CHECKPOINT_KEY, entry_id)

        time.sleep(0.05)


if __name__ == "__main__":
    main()

