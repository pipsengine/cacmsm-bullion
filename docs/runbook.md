## Cacsms-Bullion Prod Starter — Runbook

### Scope / disclaimers
- This repo includes an **MT5 connector skeleton** intended to run on a machine where MetaTrader 5 is installed (typically Windows).
- The MT5 skeleton is **not live-tested inside this sandbox** and should be treated as an integration starting point only.

---

## 1) Local start (SIMULATOR mode)

### Prereqs
- Docker + Docker Compose

### Start services
```bash
cp .env.example .env
docker compose up --build
```

The compose stack binds service ports to `127.0.0.1` by default and refuses to
start until the required values in `.env.example` have been replaced. The web
console is protected with HTTP Basic authentication and forwards the separate
admin token server-side for Control API mutations.

### Start the system (control flag)
```bash
curl -X POST -H "x-admin-token: $ADMIN_API_TOKEN" http://localhost:8000/control/start
curl http://localhost:8000/control/status
```

### Check liveness/readiness
```bash
curl http://localhost:8000/healthz
curl http://localhost:8000/readyz
curl http://localhost:8002/readyz
curl http://localhost:8003/readyz
```

### View system health summary
```bash
curl http://localhost:8004/health/summary
```

---

## 2) Postgres event persistence (SQLAlchemy)

### What is persisted
- `decision-service` writes best-effort `market_tick` + `decision_intent` events to Postgres
- `execution-service` writes `order_request` + `execution_event` events to Postgres
- `execution-service` also maintains `order_idempotency` records (unique idempotency key)

### Tables
- `event_records`
- `order_idempotency`

The services automatically create tables on startup (`create_all`) when `DB_ENABLED=1` and `DATABASE_URL` is set.
For a production deployment, replace this with a real migration workflow (e.g., Alembic) and restrict DB permissions.

---

## 3) Failure modes & common fixes

### 3.1 Readiness is failing
1) Check service logs:
```bash
docker compose logs -n 200 decision-service
```
2) Check Redis and Postgres health:
```bash
docker compose ps
```

### 3.2 No ticks / no decisions
- Ensure system is started:
```bash
curl http://localhost:8000/control/status
```
- Ensure market-data-service is in SIMULATOR mode (default in `config/base.yaml`).

### 3.3 Duplicate orders after restart
- Ensure Postgres is enabled and execution-service has `DB_ENABLED=1`.
- Keep Redis AOF persistence enabled; route claims and the MT5 worker checkpoint are stored in Redis.
- Broker reconciliation by stable `client_order_id` is required before retrying an ambiguous live order.

### 3.4 Legacy plaintext MT5 credential
- Configure `MT5_CREDENTIAL_KEY` with 32 random bytes encoded as base64 or 64 hexadecimal characters.
- Edit the account and re-enter its password. The update stores an AES-256-GCM encrypted value.
- Stored passwords are never returned through browser-facing APIs.

---

## 4) MT5 integration (operator notes)

Run the MT5 connector worker on your MT5 machine and point it at the same Redis instance:
- `REDIS_URL=redis://<redis-host>:6379/0`

See:
- `services/mt5-connector-worker/README.md`
- `services/mt5-connector-worker/INTERFACE_CONTRACT.md`
