## MT5 Connector Worker — Interface Contract (Starter)

### Scope
This file documents the expected interface between:
- `execution-service` (containerized) and
- `mt5-connector-worker` (runs on your MT5 machine)

This contract is intended to make integration explicit and testable.

> Note: The MT5 connector code in this repository is a skeleton and is **not live-tested** in this sandbox.

---

## 1) Transport

Redis Streams (JSON payload in field `"json"`):
- Orders to execute: `stream:orders`
- Execution events back: `stream:executions`

---

## 2) Message: OrderRequest (from execution-service → MT5 worker)

Stream: `stream:orders`

Required fields (JSON):
```json
{
  "ts": "2026-01-01T00:00:00+00:00",
  "symbol": "XAUUSD",
  "side": "BUY",
  "size": 0.10,
  "order_type": "MARKET",
  "stop_pips": 120.0,
  "take_pips": 140.0,
  "client_order_id": "cb_...",
  "mode": "demo",
  "ref_price": null,
  "idempotency_key": "decision:<redis_stream_id>"
}
```

Notes:
- `client_order_id` is the stable identifier the rest of the system uses for deduplication and monitoring.
- `idempotency_key` is included so the MT5 worker can implement its own dedupe if desired.

---

## 3) Message: ExecutionEvent (from MT5 worker → execution-service/others)

Stream: `stream:executions`

```json
{
  "ts": "2026-01-01T00:00:00+00:00",
  "symbol": "XAUUSD",
  "client_order_id": "cb_...",
  "status": "ACCEPTED",
  "message": "accepted by broker",
  "fill_price": 2401.12
}
```

Allowed `status` values (starter):
- `ACCEPTED`
- `REJECTED`
- `FILLED`
- `CLOSED`

---

## 4) Delivery semantics

Redis Streams are **at-least-once** delivery by design when using consumer groups.
The MT5 worker should therefore be prepared for duplicate messages:
- either dedupe using `idempotency_key` or `client_order_id`
- or make broker submission idempotent (broker-specific)

The production implementation should use Redis consumer groups and acknowledgements:
- `XGROUP CREATE`
- `XREADGROUP`
- `XACK`

The skeleton in this repository does not enforce consumer groups, but the contract is written to support them.

