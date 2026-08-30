from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import sqlite3
import threading
import time
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import yaml
from fastapi import FastAPI, Response, Query, WebSocket, WebSocketDisconnect, status
from redis import Redis

from cacsms_shared.config import BaseServiceSettings, load_settings
from cacsms_shared.json_logging import configure_json_logging
from cacsms_shared.redis_streams import xadd_json
from cacsms_shared.retry import with_retry


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


try:
    from zoneinfo import ZoneInfo  # Python 3.9+

    TZ_LAGOS = ZoneInfo("Africa/Lagos")
except Exception:  # pragma: no cover
    TZ_LAGOS = timezone(timedelta(hours=1))


log = logging.getLogger(__name__)


DEFAULT_SYMBOLS = [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "AUDUSD",
    "NZDUSD",
    "USDCAD",
    "USDCHF",
    "XAUUSD",
]

SYMBOL_BASE_PRICES = {
    "EURUSD": 1.0845,
    "GBPUSD": 1.2716,
    "USDJPY": 147.22,
    "AUDUSD": 0.6648,
    "NZDUSD": 0.5988,
    "USDCAD": 1.3562,
    "USDCHF": 0.8913,
    "XAUUSD": 2526.40,
}

BASE_VOLATILITY = {
    "EURUSD": 0.00040,
    "GBPUSD": 0.00050,
    "USDJPY": 0.05,
    "AUDUSD": 0.00045,
    "NZDUSD": 0.00055,
    "USDCAD": 0.00045,
    "USDCHF": 0.00035,
    "XAUUSD": 0.30,
}

BASE_SPREAD = {
    "EURUSD": 0.00012,
    "GBPUSD": 0.00015,
    "USDJPY": 0.012,
    "AUDUSD": 0.00014,
    "NZDUSD": 0.00018,
    "USDCAD": 0.00015,
    "USDCHF": 0.00012,
    "XAUUSD": 0.20,
}


class Settings(BaseServiceSettings):
    symbols: list[str] = DEFAULT_SYMBOLS
    feed_mode: str = "SIMULATOR"
    tick_ms: int = 250

    stream_market: str = "stream:market"
    key_last_tick_ts: str = "telemetry:last_tick_ts"

    control_key: str = "control:running"
    kill_key: str = "control:kill"

    tick_db_path: str = "data/market_ticks.sqlite3"
    history_hours: int = 24

    mt5_path: str | None = None
    mt5_login: int | None = None
    mt5_server: str | None = None
    mt5_password: str | None = None
    mt5_timeout_ms: int = 15000

    display_tz: str = "Africa/Lagos"


def lagos_str(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ_LAGOS).isoformat()


CCY_ROWS = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"]


def _inv(x):
    return None if x is None or x == 0 else 1.0 / x


def compute_currency_values(symbols_latest: dict[str, dict]) -> dict[str, float]:
    def norm_from_quo(sym, inv=False):
        s = symbols_latest.get(sym)
        if not s:
            return 0.0
        base = SYMBOL_BASE_PRICES.get(sym, 1.0)
        v = float(s.get("mid"))
        if inv:
            if v <= 0:
                return 0.0
            v = 1.0 / v
            base = 1.0 / base
        if base == 0:
            return 0.0
        return math.tanh(((v / base) - 1.0) * 10.0)

    aud = norm_from_quo("AUDUSD")
    cad = norm_from_quo("USDCAD", inv=True)
    eur = norm_from_quo("EURUSD")
    nzd = norm_from_quo("NZDUSD")
    gbp = norm_from_quo("GBPUSD")
    chf = norm_from_quo("USDCHF", inv=True)
    jpy = norm_from_quo("USDJPY", inv=True)
    xau = norm_from_quo("XAUUSD")
    usd_neg = eur + gbp + aud + nzd
    usd_pos = cad + chf + jpy
    usd = (usd_pos - usd_neg) / 7.0

    out = {"AUD": aud, "CAD": cad, "EUR": eur, "NZD": nzd, "GBP": gbp, "USD": usd, "CHF": chf, "JPY": jpy, "XAU": xau}
    scale = 0.25
    return {k: round(v * scale, 4) for k, v in out.items()}


TIMEFRAMES = ["TICK", "M1", "M5", "M15", "M30", "H1", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"]
TF_SECONDS = {
    "TICK": 1,
    "M1": 60,
    "M5": 5 * 60,
    "M15": 15 * 60,
    "M30": 30 * 60,
    "H1": 3600,
    "H4": 4 * 3600,
    "H6": 6 * 3600,
    "H8": 8 * 3600,
    "H12": 12 * 3600,
    "D1": 24 * 3600,
    "W1": 7 * 24 * 3600,
    "MN1": 30 * 24 * 3600,
}


def _ema(prev: float | None, new: float, alpha: float) -> float:
    if prev is None:
        return float(new)
    return prev * (1 - alpha) + new * alpha


def compute_timeframe_matrix(per_ccy_ticks: dict[str, list[tuple[float, float]]]) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for ccy in CCY_ROWS:
        series = per_ccy_ticks.get(ccy, [])
        out[ccy] = {}
        for tf in TIMEFRAMES:
            if tf == "TICK":
                out[ccy][tf] = round(series[-1][1] if series else 0.0, 4)
                continue
            window = TF_SECONDS[tf]
            if not series:
                out[ccy][tf] = 0.0
                continue
            now_ts_now = series[-1][0]
            cutoff = now_ts_now - window
            in_window = [v for (t, v) in series if t >= cutoff]
            if not in_window:
                out[ccy][tf] = round(series[-1][1], 4)
                continue
            first = in_window[0]
            last = in_window[-1]
            delta = last - first
            alpha = min(1.0, 2.0 / max(2, len(in_window)))
            ema = None
            for v in in_window:
                ema = _ema(ema, v, alpha)
            ref = in_window[0] if len(in_window) > 1 else first
            trend = (last - first) * 0.8 + 0.2 * (ema - ref)
            out[ccy][tf] = round(float(trend), 4)
    return out


class TickStore:
    def __init__(self, db_path: str, *, hours: int):
        self.db_path = db_path
        self.hours = hours
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10, isolation_level=None)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init(self):
        with self._lock, closing(self._conn()) as c:
            c.execute(
                """CREATE TABLE IF NOT EXISTS ticks (
                    symbol TEXT NOT NULL,
                    ts_utc TEXT NOT NULL,
                    ts_epoch REAL NOT NULL,
                    bid REAL NOT NULL,
                    ask REAL NOT NULL,
                    spread REAL NOT NULL,
                    mid REAL NOT NULL,
                    PRIMARY KEY (symbol, ts_epoch)
                );"""
            )
            c.execute("CREATE INDEX IF NOT EXISTS idx_ticks_epoch ON ticks(ts_epoch);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_ticks_symbol_epoch ON ticks(symbol, ts_epoch);")

    def insert_many(self, rows: Iterable[tuple[str, str, float, float, float, float, float]]):
        if not rows:
            return
        cutoff = (utc_now() - timedelta(hours=self.hours)).timestamp()
        with self._lock, closing(self._conn()) as c:
            c.executemany(
                "INSERT OR REPLACE INTO ticks(symbol, ts_utc, ts_epoch, bid, ask, spread, mid) VALUES(?,?,?,?,?,?,?);",
                list(rows),
            )
            c.execute("DELETE FROM ticks WHERE ts_epoch < ?;", (cutoff,))

    def symbols_since(self, *, since_s: float, symbols: list[str] | None = None):
        q = "SELECT symbol, ts_utc, ts_epoch, bid, ask, spread, mid FROM ticks WHERE ts_epoch >= ?"
        params: list[Any] = [since_s]
        if symbols:
            placeholders = ",".join("?" for _ in symbols)
            q += f" AND symbol IN ({placeholders})"
            params.extend(symbols)
        q += " ORDER BY ts_epoch ASC;"
        with closing(self._conn()) as c:
            return list(c.execute(q, tuple(params)))

    def latest_per_symbol(self, symbols: list[str] | None = None) -> dict[str, dict]:
        result = {}
        sql = """SELECT t1.symbol, t1.ts_utc, t1.ts_epoch, t1.bid, t1.ask, t1.spread, t1.mid
                 FROM ticks t1
                 JOIN (SELECT symbol, MAX(ts_epoch) me FROM ticks GROUP BY symbol) t2
                   ON t1.symbol=t2.symbol AND t1.ts_epoch=t2.me"""
        params: tuple[Any, ...] = ()
        if symbols:
            placeholders = ",".join("?" for _ in symbols)
            sql += f" WHERE t1.symbol IN ({placeholders})"
            params = tuple(symbols)
        with closing(self._conn()) as c:
            for row in c.execute(sql, params):
                sym, ts_utc, epoch, bid, ask, spread, mid = row
                result[sym] = {
                    "symbol": sym,
                    "ts_utc": ts_utc,
                    "ts_epoch": float(epoch),
                    "bid": float(bid),
                    "ask": float(ask),
                    "spread": float(spread),
                    "mid": float(mid),
                    "ts_display": datetime.fromtimestamp(float(epoch), tz=timezone.utc).astimezone(TZ_LAGOS).isoformat(),
                }
        return result


class _SimulatorWorker:
    def __init__(self, *, r: Redis, settings: Settings, on_tick):
        self._r = r
        self._s = settings
        self._on_tick = on_tick
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._mid = {sym: float(SYMBOL_BASE_PRICES[sym]) for sym in settings.symbols}
        self._spread = {sym: float(BASE_SPREAD[sym]) for sym in settings.symbols}

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        import random

        symbols = list(self._s.symbols)
        while not self._stop.is_set():
            running = self._r.get(self._s.control_key) == "1"
            kill = self._r.get(self._s.kill_key) == "1"
            if not running or kill:
                time.sleep(0.25)
                continue
            rows = []
            payloads = []
            now = utc_now()
            for sym in symbols:
                sym_base = float(SYMBOL_BASE_PRICES[sym])
                vol = BASE_VOLATILITY[sym]
                step = random.gauss(0, vol)
                new_mid = max(0.00001, self._mid[sym] + step)
                spread = max(BASE_SPREAD[sym] * 0.8, self._spread[sym] * 0.95 + random.expovariate(1 / (BASE_SPREAD[sym] * 3.0)))
                bid = round(new_mid - spread / 2, self._digits_for(sym))
                ask = round(new_mid + spread / 2, self._digits_for(sym))
                mid = round((bid + ask) / 2, self._digits_for(sym))
                spread_r = round(ask - bid, self._digits_for(sym))
                ts_utc = now.isoformat()
                ts_epoch = now.timestamp()
                payload = {
                    "ts": ts_utc,
                    "symbol": sym,
                    "bid": bid,
                    "ask": ask,
                    "spread": spread_r,
                    "mid": mid,
                    "source": "SIM",
                }
                xadd_json(self._r, self._s.stream_market, payload)
                payloads.append(payload)
                rows.append((sym, ts_utc, ts_epoch, bid, ask, spread_r, mid))
                self._mid[sym] = mid
                self._spread[sym] = spread
            self._r.set(self._s.key_last_tick_ts, now.isoformat())
            self._on_tick(payloads, rows)
            time.sleep(max(10, self._s.tick_ms) / 1000.0)

    @staticmethod
    def _digits_for(sym: str) -> int:
        if sym == "XAUUSD":
            return 2
        if sym in ("USDJPY",):
            return 3
        return 5


class _MT5FeedWorker:
    def __init__(self, *, r: Redis, settings: Settings, on_tick):
        self._r = r
        self._s = settings
        self._on_tick = on_tick
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.mt5 = None
        self.connected = False
        self.last_error = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        try:
            if self.mt5 is not None:
                self.mt5.shutdown()
        except Exception:
            pass
        self.connected = False

    def _available(self) -> bool:
        try:
            import MetaTrader5 as mt5  # type: ignore
            self.mt5 = mt5
            return True
        except Exception as exc:
            self.last_error = f"MetaTrader5 package not installed: {exc}"
            return False

    def _connect(self) -> bool:
        if self.mt5 is None:
            if not self._available():
                return False
        if self._s.mt5_path and Path(str(self._s.mt5_path)).exists():
            ok = self.mt5.initialize(
                path=str(self._s.mt5_path),
                login=self._s.mt5_login or 0,
                server=self._s.mt5_server or "",
                password=self._s.mt5_password or "",
                timeout=int(self._s.mt5_timeout_ms),
            )
        else:
            ok = self.mt5.initialize(
                login=self._s.mt5_login or 0,
                server=self._s.mt5_server or "",
                password=self._s.mt5_password or "",
                timeout=int(self._s.mt5_timeout_ms),
            )
        if not ok:
            err = self.mt5.last_error()
            self.last_error = f"initialize failed: {err}"
            return False
        for sym in self._s.symbols:
            if not self.mt5.symbol_select(sym, True):
                log.warning("mt5 symbol_select failed", extra={"fields": {"symbol": sym, "err": self.mt5.last_error()}})
        return True

    def _run(self):
        reconnect_attempt = 0
        while not self._stop.is_set():
            running = self._r.get(self._s.control_key) == "1"
            kill = self._r.get(self._s.kill_key) == "1"
            if not running or kill:
                time.sleep(0.5)
                continue
            if not self.connected:
                if self._connect():
                    self.connected = True
                    reconnect_attempt = 0
                    log.info("mt5 connected")
                else:
                    reconnect_attempt += 1
                    time.sleep(min(30, 1 + reconnect_attempt * 2))
                    continue
            try:
                now = utc_now()
                rows = []
                payloads = []
                for sym in self._s.symbols:
                    tick = self.mt5.symbol_info_tick(sym)
                    if tick is None:
                        continue
                    bid = float(tick.bid)
                    ask = float(tick.ask)
                    spread = float(tick.spread) if hasattr(tick, "spread") and tick.spread else round(ask - bid, 8)
                    mid = round((bid + ask) / 2, 8)
                    if hasattr(tick, "time_msc") and tick.time_msc:
                        ts_s = float(tick.time_msc) / 1000.0
                    else:
                        ts_s = float(tick.time)
                    ts_utc = datetime.fromtimestamp(ts_s, tz=timezone.utc).isoformat()
                    ts_epoch = ts_s
                    payload = {
                        "ts": ts_utc,
                        "symbol": sym,
                        "bid": bid,
                        "ask": ask,
                        "spread": spread,
                        "mid": mid,
                        "source": "MT5",
                    }
                    xadd_json(self._r, self._s.stream_market, payload)
                    payloads.append(payload)
                    rows.append((sym, ts_utc, ts_epoch, bid, ask, spread, mid))
                if payloads:
                    self._r.set(self._s.key_last_tick_ts, now.isoformat())
                    self._on_tick(payloads, rows)
            except Exception as exc:
                log.warning("mt5 read error, scheduling reconnect", extra={"fields": {"exc": str(exc)}})
                self.connected = False
                try:
                    self.mt5.shutdown()
                except Exception:
                    pass
                time.sleep(2.0)
                continue
            time.sleep(0.15)


@dataclass
class MarketState:
    latest: dict[str, dict]
    per_ccy: dict[str, list[tuple[float, float]]]
    last_update_epoch: float
    mt5_connected: bool
    feed_source: str
    mt5_error: str | None
    total_ticks: int


class MarketFeed:
    MAX_CCY_POINTS = 45000

    def __init__(self, *, settings: Settings, store: TickStore):
        self.s = settings
        self.store = store
        self.lock = threading.Lock()
        self.ws: dict[int, tuple[WebSocket, asyncio.AbstractEventLoop]] = {}
        self.ws_id = 0
        self.state = MarketState(
            latest={},
            per_ccy={c: [] for c in CCY_ROWS},
            last_update_epoch=0.0,
            mt5_connected=False,
            feed_source="SIM" if settings.feed_mode.upper() == "SIMULATOR" else "MT5",
            mt5_error=None,
            total_ticks=0,
        )
        self._seed_from_store()

    def _seed_from_store(self):
        since = (utc_now() - timedelta(days=31)).timestamp()
        rows = self.store.symbols_since(since_s=since, symbols=self.s.symbols)
        latest = self.store.latest_per_symbol(self.s.symbols)
        per_ccy: dict[str, list[tuple[float, float]]] = {c: [] for c in CCY_ROWS}
        per_sym_grouped: dict[str, list[tuple[float, float]]] = {}
        for (sym, _ts_utc, epoch, _b, _a, _spr, mid) in rows:
            per_sym_grouped.setdefault(sym, []).append((float(epoch), float(mid)))
        if latest:
            self.state.latest = latest
        all_epochs = sorted({e for vals in per_sym_grouped.values() for e, _ in vals})
        sym_mid = {sym: per_sym_grouped.get(sym, []) for sym in self.s.symbols}
        idxs = {sym: 0 for sym in self.s.symbols}
        current_mid = {sym: float(SYMBOL_BASE_PRICES[sym]) for sym in self.s.symbols}
        for ep in all_epochs:
            for sym in self.s.symbols:
                while idxs[sym] < len(sym_mid[sym]):
                    e, m = sym_mid[sym][idxs[sym]]
                    if e <= ep:
                        current_mid[sym] = m
                        idxs[sym] += 1
                    else:
                        break
            ccy_vals = compute_currency_values({sym: {"mid": current_mid[sym]} for sym in current_mid})
            for c in CCY_ROWS:
                arr = per_ccy[c]
                if not arr or ep - arr[-1][0] >= 4.9:
                    arr.append((ep, ccy_vals[c]))
        if not per_ccy and latest:
            ep = max(v["ts_epoch"] for v in latest.values()) if latest else utc_now().timestamp()
            ccy_vals = compute_currency_values({sym: {"mid": latest[sym]["mid"]} for sym in latest})
            for c in CCY_ROWS:
                per_ccy[c].append((ep, ccy_vals[c]))
        self.state.per_ccy = per_ccy

    def register_ws(self, ws: WebSocket, loop: asyncio.AbstractEventLoop) -> int:
        with self.lock:
            self.ws_id += 1
            wid = self.ws_id
            self.ws[wid] = (ws, loop)
            return wid

    def unregister_ws(self, wid: int) -> None:
        with self.lock:
            self.ws.pop(wid, None)

    def on_tick(self, payloads: list[dict], rows: list[tuple]):
        self.store.insert_many(rows)
        with self.lock:
            now = utc_now()
            now_ep = now.timestamp()
            self.state.total_ticks += len(payloads)
            latest_updates = {}
            for p in payloads:
                sym = p["symbol"]
                ts_epoch = (
                    datetime.fromisoformat(p["ts"].replace("Z", "+00:00")).timestamp()
                    if isinstance(p["ts"], str)
                    else now_ep
                )
                latest_updates[sym] = {
                    "symbol": sym,
                    "ts_utc": p["ts"],
                    "ts_epoch": float(ts_epoch),
                    "bid": float(p["bid"]),
                    "ask": float(p["ask"]),
                    "spread": float(p["spread"]),
                    "mid": float(p["mid"]),
                    "source": p.get("source", "SIM"),
                    "ts_display": now.astimezone(TZ_LAGOS).isoformat(),
                }
            self.state.latest.update(latest_updates)
            ccy_vals = compute_currency_values({sym: {"mid": self.state.latest[sym]["mid"]} for sym in self.state.latest})
            for c in CCY_ROWS:
                arr = self.state.per_ccy.setdefault(c, [])
                if not arr or now_ep - arr[-1][0] >= 4.9:
                    arr.append((now_ep, ccy_vals[c]))
                    if len(arr) > self.MAX_CCY_POINTS:
                        del arr[: len(arr) - self.MAX_CCY_POINTS]
                else:
                    arr[-1] = (now_ep, ccy_vals[c])
            self.state.last_update_epoch = now_ep
            snap = self._build_tick_event(payloads, ccy_vals, now_ep)
            self._broadcast(snap)

    def _build_tick_event(self, payloads: list[dict], ccy_vals: dict[str, float], now_ep: float):
        return {
            "type": "tick",
            "ts_utc": datetime.fromtimestamp(now_ep, tz=timezone.utc).isoformat(),
            "ts_display": datetime.fromtimestamp(now_ep, tz=timezone.utc).astimezone(TZ_LAGOS).isoformat(),
            "symbols": payloads,
            "currencies": ccy_vals,
            "status": {
                "mt5_connected": self.state.mt5_connected,
                "feed_source": self.state.feed_source,
                "mt5_error": self.state.mt5_error,
                "total_ticks": self.state.total_ticks,
            },
        }

    def _broadcast(self, msg: dict):
        dead: list[int] = []
        raw = json.dumps(msg, ensure_ascii=False, default=str)
        for wid, (ws, loop) in list(self.ws.items()):
            try:
                loop.call_soon_threadsafe(asyncio.create_task, ws.send_text(raw))
            except Exception:
                dead.append(wid)
        for d in dead:
            try:
                with self.lock:
                    self.ws.pop(d, None)
            except Exception:
                pass

    def build_snapshot(self) -> dict:
        with self.lock:
            matrix = compute_timeframe_matrix(self.state.per_ccy)
            ranked = sorted(
                [{"currency": c, "avg_bias": round(sum(matrix[c].values()) / max(1, len(matrix[c])), 4)} for c in CCY_ROWS],
                key=lambda x: x["avg_bias"],
                reverse=True,
            )
            now = utc_now()
            return {
                "ts_utc": now.isoformat(),
                "ts_display": now.astimezone(TZ_LAGOS).isoformat(),
                "feed_source": self.state.feed_source,
                "mt5_connected": self.state.mt5_connected,
                "mt5_error": self.state.mt5_error,
                "total_ticks": self.state.total_ticks,
                "symbols": list(self.state.latest.values()),
                "currency_values": {c: matrix[c]["TICK"] for c in CCY_ROWS},
                "matrix_rows": [
                    {
                        "currency": c,
                        "values": {tf: matrix[c].get(tf, 0.0) for tf in TIMEFRAMES},
                    }
                    for c in CCY_ROWS
                ],
                "ranked_bias": ranked,
            }

    def build_status(self) -> dict:
        with self.lock:
            return {
                "ts_utc": utc_now().isoformat(),
                "ts_display": utc_now().astimezone(TZ_LAGOS).isoformat(),
                "feed_mode": self.s.feed_mode.upper(),
                "feed_source": self.state.feed_source,
                "mt5_connected": self.state.mt5_connected,
                "mt5_error": self.state.mt5_error,
                "configured_symbols": self.s.symbols,
                "symbols_present": list(self.state.latest.keys()),
                "missing_symbols": [s for s in self.s.symbols if s not in self.state.latest],
                "last_tick_seconds_ago": round(utc_now().timestamp() - self.state.last_update_epoch, 2) if self.state.last_update_epoch > 0 else None,
                "total_ticks": self.state.total_ticks,
                "tick_db": self.store.db_path,
                "history_hours": self.s.history_hours,
            }

    def build_history(self, *, hours: int, symbols: list[str] | None = None) -> dict:
        since = (utc_now() - timedelta(hours=hours)).timestamp()
        raw_rows = list(self.store.symbols_since(since_s=since, symbols=symbols or self.s.symbols))
        bucket_seconds = 5 * 60
        sym_order = symbols or self.s.symbols
        per_sym_epoch: dict[str, dict[float, float]] = {s: {} for s in sym_order}
        for (sym, _ts_utc, ts_epoch, _bid, _ask, _spr, mid) in raw_rows:
            b = float(ts_epoch) // bucket_seconds * bucket_seconds
            per_sym_epoch[sym][b] = float(mid)
        all_buckets = sorted({b for d in per_sym_epoch.values() for b in d.keys()})
        cur_mid = {s: float(SYMBOL_BASE_PRICES[s]) for s in sym_order}
        ccy_per_bucket: dict[float, dict[str, float]] = {}
        for b in all_buckets:
            for s in sym_order:
                m = per_sym_epoch[s].get(b)
                if m is not None:
                    cur_mid[s] = m
            ccy_per_bucket[b] = compute_currency_values({sym: {"mid": cur_mid[sym]} for sym in cur_mid})
        now = utc_now()
        cutoff_epoch = (utc_now() - timedelta(hours=hours)).timestamp() // bucket_seconds * bucket_seconds
        last_epoch = now.timestamp() // bucket_seconds * bucket_seconds
        wanted_epochs: list[float] = []
        t = int(last_epoch)
        while t >= int(cutoff_epoch):
            wanted_epochs.append(float(t))
            t -= int(bucket_seconds)
        wanted_epochs = wanted_epochs[: 24 * 12]
        filled: dict[float, dict[str, float]] = {}
        last = {c: 0.0 for c in CCY_ROWS}
        for b in sorted(ccy_per_bucket.keys(), reverse=True):
            cur = ccy_per_bucket[b]
            merged = {}
            for c in CCY_ROWS:
                cv = cur.get(c, 0.0)
                if cv == 0.0 and last[c] != 0.0:
                    merged[c] = last[c]
                else:
                    merged[c] = cv
                    last[c] = cv
            filled[b] = merged
        rows_out = []
        last_vals = {c: 0.0 for c in CCY_ROWS}
        for b in wanted_epochs:
            ts_utc = datetime.fromtimestamp(float(b), tz=timezone.utc)
            if b in filled:
                vals = filled[b]
                last_vals = vals
            else:
                vals = dict(last_vals)
            rows_out.append({
                "key": f"h-{b}",
                "timestamp_utc": ts_utc.isoformat(),
                "timestamp_display": ts_utc.astimezone(TZ_LAGOS).isoformat(),
                "values": vals,
                "source": "ROLLUP",
            })
        return {
            "ts_utc": now.isoformat(),
            "ts_display": now.astimezone(TZ_LAGOS).isoformat(),
            "history_hours": hours,
            "row_interval_seconds": bucket_seconds,
            "currencies": list(CCY_ROWS),
            "rows": rows_out,
        }


def create_app(*, redis_client: Any | None = None) -> FastAPI:
    settings = load_settings(Settings, service_name="market-data-service")
    if settings.json_logs:
        configure_json_logging(service_name=settings.service_name, level=settings.log_level)

    global TZ_LAGOS
    if settings.display_tz and settings.display_tz != "Africa/Lagos":
        try:
            TZ_LAGOS = ZoneInfo(settings.display_tz)
        except Exception:
            pass

    app = FastAPI(title="Cacsms-Bullion Market Data Service", version="0.3.0")
    app.state.settings = settings
    app.state.redis = redis_client

    store = TickStore(settings.tick_db_path, hours=settings.history_hours)
    feed = MarketFeed(settings=settings, store=store)
    app.state.store = store
    app.state.feed = feed

    def on_tick(payloads: list[dict], rows: list[tuple]):
        feed.on_tick(payloads, rows)

    @app.on_event("startup")
    def _startup():
        if app.state.redis is None:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        mode = settings.feed_mode.upper()
        if mode == "MT5":
            w = _MT5FeedWorker(r=app.state.redis, settings=settings, on_tick=on_tick)
            w.start()
            app.state.worker = w
            feed.state.feed_source = "MT5"

            def _status_updater():
                while True:
                    feed.state.mt5_connected = w.connected
                    feed.state.mt5_error = w.last_error
                    time.sleep(1.0)
            threading.Thread(target=_status_updater, daemon=True).start()
            log.info("market-data MT5 feed worker started")
        else:
            w = _SimulatorWorker(r=app.state.redis, settings=settings, on_tick=on_tick)
            w.start()
            app.state.worker = w
            feed.state.feed_source = "SIM"
            feed.state.mt5_connected = False
            log.info("market-data simulator started (multi-symbol, %s ms cadence)", settings.tick_ms)

    @app.on_event("shutdown")
    def _shutdown():
        w = getattr(app.state, "worker", None)
        if w:
            try:
                w.stop()
            except Exception:
                pass

    @app.get("/healthz")
    def healthz():
        return {"status": "ok", "ts": utc_now().isoformat(), "service": settings.service_name}

    @app.get("/readyz")
    def readyz(resp: Response):
        try:
            _ping_redis(app.state.redis)
            return {"status": "ready", "ts": utc_now().isoformat()}
        except Exception as e:
            resp.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "not_ready", "error": str(e), "ts": utc_now().isoformat()}

    @app.get("/market/latest")
    def latest(limit: int = 10, symbol: str | None = None):
        r = app.state.redis
        stream = settings.stream_market
        if symbol:
            entries = r.xrevrange(stream, max="+", min="-", count=max(1, min(limit, 200)))
            out = []
            for _id, fields in entries:
                if "json" in fields:
                    j = json.loads(fields["json"])
                    if j.get("symbol") == symbol:
                        out.append(j)
                    if len(out) >= limit:
                        break
            return {"items": out}
        entries = r.xrevrange(stream, max="+", min="-", count=max(1, min(limit, 50)))
        out = []
        for _id, fields in entries:
            if "json" in fields:
                out.append(json.loads(fields["json"]))
        return {"items": out}

    @app.get("/api/market/status")
    def api_status():
        return feed.build_status()

    @app.get("/api/market/snapshot")
    def api_snapshot():
        return feed.build_snapshot()

    @app.get("/api/market/history")
    def api_history(hours: int = Query(24, ge=1, le=24 * 7), symbols: str | None = None):
        sym_list = [s.strip() for s in symbols.split(",")] if symbols else None
        return feed.build_history(hours=hours, symbols=sym_list)

    @app.websocket("/ws/market")
    async def ws_market(ws: WebSocket):
        await ws.accept()
        loop = asyncio.get_running_loop()
        wid = feed.register_ws(ws, loop)
        try:
            snap = {"type": "snapshot", **feed.build_snapshot()}
            await ws.send_json(snap)
            status_msg = {"type": "status", **feed.build_status()}
            await ws.send_json(status_msg)
            while True:
                try:
                    data = await asyncio.wait_for(ws.receive_text(), timeout=0.2)
                    if data and data.strip() == "\"ping\"":
                        await ws.send_text("\"pong\"")
                except TimeoutError:
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            feed.unregister_ws(wid)

    return app


@with_retry(attempts=3, base_delay_s=0.05, max_delay_s=0.3)
def _ping_redis(r: Any) -> None:
    r.get("__cacsms_ready__")


app = create_app()
