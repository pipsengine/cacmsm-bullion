## Architecture (starter)

### Services (same as MVP)
- `control-api` (FastAPI): control flags (start/stop/mode/kill)
- `market-data-service` (FastAPI + background worker): simulated tick feed (or external MT5 feed)
- `decision-service` (FastAPI + background worker): reads ticks → writes decisions
- `execution-service` (FastAPI + background worker): reads decisions → creates orders → emits execution events
- `monitoring-service` (FastAPI): health summary + kill switch trigger
- `mt5-connector-worker` (local skeleton): consumes `stream:orders` and interacts with MT5

### Messaging
Redis Streams:
- `stream:market` ticks
- `stream:decisions` decisions
- `stream:orders` orders (for MT5 connector)
- `stream:executions` execution events

### Persistence
Postgres (optional) stores:
- `event_records`: durable event log (best-effort write on event creation/ingestion)
- `order_idempotency`: idempotency keys for order creation (prevents duplicates after restarts)

