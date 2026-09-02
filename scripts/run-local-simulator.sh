#!/usr/bin/env bash
set -euo pipefail

# Local (non-docker) runner with MT5-only market data.
# Requirements:
# - python3
# - redis-server running locally on 6379
#
# This starts each service on localhost:
# control-api:        :8000
# market-data:        :8001 (live MT5 feed)
# decision-service:   :8002
# execution-service:  :8003 (simulated fills by default)
# monitoring-service: :8004

export REDIS_URL="${REDIS_URL:-redis://localhost:6379/0}"
export CONTROL_KEY="${CONTROL_KEY:-control:running}"
export MODE_KEY="${MODE_KEY:-control:mode}"
export KILL_KEY="${KILL_KEY:-control:kill}"
export SYMBOL="${SYMBOL:-XAUUSD}"

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export CONFIG_FILE="${CONFIG_FILE:-${root_dir}/config/base.yaml}"

python3 -m pip install -e "${root_dir}/services/_shared" --break-system-packages >/dev/null

run_py() {
  local svc="$1"
  local cmd="$2"
  echo "[run] ${svc}: ${cmd}"
  (cd "${root_dir}/services/${svc}" && python3 -m pip install -r requirements.txt --break-system-packages >/dev/null && eval "${cmd}")
}

run_py "control-api" "uvicorn app.main:app --host 0.0.0.0 --port 8000" &
sleep 0.3

export FEED_MODE="MT5"
run_py "market-data-service" "uvicorn app.main:app --host 0.0.0.0 --port 8001" &
sleep 0.3

run_py "decision-service" "uvicorn app.api:app --host 0.0.0.0 --port 8002" &
sleep 0.3

export ROUTE_MODE="${ROUTE_MODE:-SIMULATOR}"
run_py "execution-service" "uvicorn app.api:app --host 0.0.0.0 --port 8003" &
sleep 0.3

run_py "monitoring-service" "uvicorn app.api:app --host 0.0.0.0 --port 8004" &

echo ""
echo "All services started."
echo "Start system:  curl -X POST http://localhost:8000/control/start"
echo "Status:        curl http://localhost:8000/control/status"
echo "Health:        curl http://localhost:8004/health/summary"
echo ""

wait
