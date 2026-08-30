from __future__ import annotations

import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PYTHON = REPO_ROOT / ".venv" / "Scripts" / "python.exe"
CONFIG_FILE = REPO_ROOT / "config" / "base.yaml"
REDIS_SERVER_SCRIPT = REPO_ROOT / "scripts" / "_redis_server.py"

SERVICE_PORTS = {
    "control-api": 8000,
    "market-data-service": 8001,
    "decision-service": 8002,
    "execution-service": 8003,
    "monitoring-service": 8004,
}

BASE_ENV = os.environ.copy()
BASE_ENV.update({
    "CONFIG_FILE": str(CONFIG_FILE),
    "REDIS_URL": "redis://127.0.0.1:16379/0",
    "JSON_LOGS": "false",
    "LOG_LEVEL": "INFO",
    "ENVIRONMENT": "local",
    "DB_ENABLED": "0",
})


def _port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _wait_for_port(port: int, label: str, timeout_s: float = 15.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        if _port_open(port):
            print(f"[launch] {label} ready on :{port}", flush=True)
            return True
        time.sleep(0.2)
    print(f"[launch] WARNING: {label} did not become ready on :{port} after {timeout_s}s", flush=True)
    return False


def _start_redis_server() -> subprocess.Popen:
    print("[launch] starting FakeRedis RESP server on :16379", flush=True)
    return subprocess.Popen(
        [str(PYTHON), str(REDIS_SERVER_SCRIPT)],
        env=BASE_ENV,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


def _start_backend_service(svc_name: str) -> subprocess.Popen:
    port = SERVICE_PORTS[svc_name]
    svc_dir = REPO_ROOT / "services" / svc_name
    if svc_name in ("control-api", "market-data-service"):
        mod = "app.main:app"
    else:
        mod = "app.api:app"
    env = BASE_ENV.copy()
    if svc_name == "market-data-service":
        env["FEED_MODE"] = "SIMULATOR"
        env["TICK_MS"] = "250"
    if svc_name == "execution-service":
        env["ROUTE_MODE"] = "SIMULATOR"
    print(f"[launch] starting {svc_name} on :{port}", flush=True)
    return subprocess.Popen(
        [
            str(PYTHON), "-m", "uvicorn",
            mod,
            "--host", "127.0.0.1",
            "--port", str(port),
            "--app-dir", str(svc_dir),
            "--no-access-log",
        ],
        env=env,
        cwd=str(REPO_ROOT),
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


def main() -> None:
    print("=" * 60, flush=True)
    print("Cacsms-Bullion Local Launcher (SIMULATOR mode)", flush=True)
    print("=" * 60, flush=True)

    processes: list[subprocess.Popen] = []

    try:
        redis_proc = _start_redis_server()
        processes.append(redis_proc)
        _wait_for_port(16379, "FakeRedis server")
        time.sleep(0.5)

        order = [
            "control-api",
            "market-data-service",
            "decision-service",
            "execution-service",
            "monitoring-service",
        ]
        for svc in order:
            p = _start_backend_service(svc)
            processes.append(p)
            _wait_for_port(SERVICE_PORTS[svc], svc)
            time.sleep(0.3)

        print("", flush=True)
        print("=" * 60, flush=True)
        print("All backend services started:", flush=True)
        for svc, port in SERVICE_PORTS.items():
            print(f"  {svc:25s} http://127.0.0.1:{port}", flush=True)
        print("", flush=True)
        print("Web console (Next.js): install + run:", flush=True)
        print(f"  cd apps/web ; pnpm install ; pnpm dev", flush=True)
        print("  -> http://localhost:3000", flush=True)
        print("", flush=True)
        print("Activate system:")
        print("  curl -X POST http://localhost:8000/control/start", flush=True)
        print("Status:")
        print("  curl http://localhost:8000/control/status", flush=True)
        print("Health summary:")
        print("  curl http://localhost:8004/health/summary", flush=True)
        print("=" * 60, flush=True)
        print("", flush=True)

        while True:
            for p in processes:
                rc = p.poll()
                if rc is not None:
                    print(f"[launch] process exited with rc={rc}; shutting down...", flush=True)
                    return
            time.sleep(1.0)

    except KeyboardInterrupt:
        print("\n[launch] keyboard interrupt, stopping all processes...", flush=True)
    finally:
        for p in reversed(processes):
            try:
                p.terminate()
            except Exception:
                pass
        for p in reversed(processes):
            try:
                p.wait(timeout=5)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
        print("[launch] all processes stopped", flush=True)


if __name__ == "__main__":
    main()
