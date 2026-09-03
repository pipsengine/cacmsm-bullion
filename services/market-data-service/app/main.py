from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import sqlite3
import statistics
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
from cacsms_shared.market_intelligence import analyze_history, analyze_matrix
from cacsms_shared.redis_streams import xadd_json
from cacsms_shared.retry import with_retry


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def broker_clock_offset(latest_epoch: float) -> int:
    """Normalize terminals that encode chart epochs in broker-server time."""
    difference = latest_epoch - utc_now().timestamp()
    if 30 * 60 < abs(difference) < 14 * 60 * 60:
        return int(round(difference / 3600.0) * 3600)
    return 0


try:
    from zoneinfo import ZoneInfo  # Python 3.9+

    TZ_LAGOS = ZoneInfo("Africa/Lagos")
except Exception:  # pragma: no cover
    TZ_LAGOS = timezone(timedelta(hours=1))


log = logging.getLogger(__name__)


DEFAULT_SYMBOLS = [
    "AUDCAD",
    "AUDCHF",
    "AUDJPY",
    "AUDNZD",
    "AUDUSD",
    "CADCHF",
    "CADJPY",
    "CHFJPY",
    "EURAUD",
    "EURCAD",
    "EURCHF",
    "EURGBP",
    "EURJPY",
    "EURNZD",
    "EURUSD",
    "GBPAUD",
    "GBPCAD",
    "GBPCHF",
    "GBPJPY",
    "GBPNZD",
    "GBPUSD",
    "NZDCAD",
    "NZDCHF",
    "NZDJPY",
    "NZDUSD",
    "USDCAD",
    "USDCHF",
    "USDJPY",
    "XAUUSD",
]


class Settings(BaseServiceSettings):
    symbols: list[str] = DEFAULT_SYMBOLS
    feed_mode: str = "MT5"
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
FX_CURRENCIES = set(CCY_ROWS) - {"XAU"}
FX_PAIRS = {
    symbol: (symbol[:3], symbol[3:])
    for symbol in DEFAULT_SYMBOLS
    if len(symbol) == 6 and symbol[:3] in FX_CURRENCIES and symbol[3:] in FX_CURRENCIES
}
MAX_HISTORY_TICK_ROWS = 5000


def compute_currency_values(
    symbols_latest: dict[str, dict], reference_prices: dict[str, float] | None = None
) -> dict[str, float]:
    """Average MT5 pair returns into base/quote currency momentum scores."""
    references = reference_prices or {}
    totals = {currency: 0.0 for currency in CCY_ROWS}
    counts = {currency: 0 for currency in CCY_ROWS}
    for symbol, (base_currency, quote_currency) in FX_PAIRS.items():
        latest = symbols_latest.get(symbol)
        current = float(latest.get("mid", 0.0)) if latest else 0.0
        reference = float(references.get(symbol, 0.0))
        if current <= 0.0 or reference <= 0.0:
            continue
        pair_return = math.log(current / reference) * 100.0
        totals[base_currency] += pair_return
        totals[quote_currency] -= pair_return
        counts[base_currency] += 1
        counts[quote_currency] += 1

    # With a complete N-currency cross basket, the average signed pair return
    # is N/(N-1) times the underlying currency factor. Convert it back to that
    # common factor scale before adding XAU.
    fx_values = {
        currency: totals[currency] / counts[currency] if counts[currency] else 0.0
        for currency in FX_CURRENCIES
    }
    populated_fx = [currency for currency in FX_CURRENCIES if counts[currency]]
    if populated_fx:
        center = sum(fx_values[currency] for currency in populated_fx) / len(populated_fx)
        factor_scale = (len(populated_fx) - 1) / len(populated_fx) if len(populated_fx) > 1 else 1.0
        for currency in populated_fx:
            fx_values[currency] = (fx_values[currency] - center) * factor_scale

    result = {currency: round(fx_values.get(currency, 0.0), 6) for currency in CCY_ROWS}
    xau_latest = symbols_latest.get("XAUUSD")
    xau_current = float(xau_latest.get("mid", 0.0)) if xau_latest else 0.0
    xau_reference = float(references.get("XAUUSD", 0.0))
    if xau_current > 0.0 and xau_reference > 0.0:
        # XAUUSD measures XAU minus USD. Add the already-derived USD factor so
        # XAU is expressed on the same common-factor scale as the FX currencies.
        result["XAU"] = round(result["USD"] + math.log(xau_current / xau_reference) * 100.0, 6)
    return result


def normalize_strength_percentages(values: dict[str, float]) -> dict[str, float]:
    """Convert cross-market factors to bounded relative-strength z-scores.

    A normal CDF preserves ordering and a neutral midpoint without mechanically
    assigning 0 and 100 to the weakest and strongest instrument on every tick.
    """
    numeric = {currency: float(values.get(currency, 0.0)) for currency in CCY_ROWS}
    mean = statistics.fmean(numeric.values())
    deviation = statistics.pstdev(numeric.values())
    if deviation <= 1e-12:
        return {currency: 50.0 for currency in CCY_ROWS}
    normal = statistics.NormalDist()
    return {
        currency: round(max(0.1, min(99.9, normal.cdf((value - mean) / deviation) * 100.0)), 1)
        for currency, value in numeric.items()
    }


TIMEFRAMES = ["TICK", "M1", "M5", "M15", "M30", "H1", "H4", "H6", "H8", "H12", "D1", "W1", "MN1", "YTD"]
MT5_TIMEFRAME_NAMES = {
    timeframe: f"TIMEFRAME_{timeframe}"
    for timeframe in TIMEFRAMES
    if timeframe not in {"TICK", "YTD"}
}
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
    "YTD": 366 * 24 * 3600,
}


def higher_timeframe_filter(values: dict[str, float]) -> str:
    """Require D1, W1 and MN1 to agree before declaring directional bias."""
    anchors = [float(values.get(timeframe, 50.0)) for timeframe in ("D1", "W1", "MN1")]
    if all(value >= 70.0 for value in anchors):
        return "STRONG"
    if all(value <= 30.0 for value in anchors):
        return "WEAK"
    return "NEUTRAL"


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
                    source TEXT NOT NULL DEFAULT 'LEGACY',
                    PRIMARY KEY (symbol, ts_epoch)
                );"""
            )
            columns = {str(row[1]) for row in c.execute("PRAGMA table_info(ticks);")}
            if "source" not in columns:
                c.execute("ALTER TABLE ticks ADD COLUMN source TEXT NOT NULL DEFAULT 'LEGACY';")
            self.purged_non_mt5 = int(c.execute("SELECT COUNT(*) FROM ticks WHERE source != 'MT5';").fetchone()[0])
            c.execute("DELETE FROM ticks WHERE source != 'MT5';")
            c.execute("CREATE INDEX IF NOT EXISTS idx_ticks_epoch ON ticks(ts_epoch);")
            c.execute("CREATE INDEX IF NOT EXISTS idx_ticks_symbol_epoch ON ticks(symbol, ts_epoch);")

    def insert_many(self, rows: Iterable[tuple[str, str, float, float, float, float, float, str]]):
        mt5_rows = [row for row in rows if len(row) >= 8 and str(row[7]).upper() == "MT5"]
        if not mt5_rows:
            return
        cutoff = (utc_now() - timedelta(hours=self.hours)).timestamp()
        with self._lock, closing(self._conn()) as c:
            c.executemany(
                """INSERT OR REPLACE INTO ticks(symbol, ts_utc, ts_epoch, bid, ask, spread, mid, source)
                   VALUES(?,?,?,?,?,?,?,?);""",
                mt5_rows,
            )
            c.execute("DELETE FROM ticks WHERE ts_epoch < ? OR source != 'MT5';", (cutoff,))

    def symbols_since(self, *, since_s: float, symbols: list[str] | None = None):
        q = "SELECT symbol, ts_utc, ts_epoch, bid, ask, spread, mid FROM ticks WHERE ts_epoch >= ? AND source = 'MT5'"
        params: list[Any] = [since_s]
        if symbols:
            placeholders = ",".join("?" for _ in symbols)
            q += f" AND symbol IN ({placeholders})"
            params.extend(symbols)
        q += " ORDER BY ts_epoch ASC;"
        with closing(self._conn()) as c:
            return list(c.execute(q, tuple(params)))

    def recent_tick_rows(self, *, since_s: float, symbols: list[str], limit: int):
        placeholders = ",".join("?" for _ in symbols)
        epoch_sql = f"""SELECT DISTINCT ts_epoch FROM ticks
                        WHERE ts_epoch >= ? AND source = 'MT5' AND symbol IN ({placeholders})
                        ORDER BY ts_epoch DESC LIMIT ?"""
        epoch_params: list[Any] = [since_s, *symbols, limit]
        with closing(self._conn()) as c:
            epochs = [float(row[0]) for row in c.execute(epoch_sql, tuple(epoch_params))]
            if not epochs:
                return {}, []
            first_epoch = min(epochs)
            baseline = {}
            for symbol in symbols:
                row = c.execute(
                    """SELECT mid FROM ticks WHERE symbol = ? AND ts_epoch < ?
                       AND source = 'MT5' ORDER BY ts_epoch DESC LIMIT 1""",
                    (symbol, first_epoch),
                ).fetchone()
                if row:
                    baseline[symbol] = float(row[0])
            rows = list(c.execute(
                f"""SELECT symbol, ts_utc, ts_epoch, bid, ask, spread, mid FROM ticks
                    WHERE ts_epoch >= ? AND source = 'MT5' AND symbol IN ({placeholders})
                    ORDER BY ts_epoch ASC""",
                (first_epoch, *symbols),
            ))
            return baseline, rows

    def reference_prices_since(self, *, since_s: float, symbols: list[str]) -> dict[str, float]:
        placeholders = ",".join("?" for _ in symbols)
        sql = f"""SELECT t.symbol, t.mid FROM ticks t
                  JOIN (
                    SELECT symbol, MIN(ts_epoch) AS first_epoch FROM ticks
                    WHERE ts_epoch >= ? AND source = 'MT5' AND symbol IN ({placeholders})
                    GROUP BY symbol
                  ) first
                  ON t.symbol = first.symbol AND t.ts_epoch = first.first_epoch
                  WHERE t.source = 'MT5'"""
        with closing(self._conn()) as c:
            return {str(symbol): float(mid) for symbol, mid in c.execute(sql, (since_s, *symbols))}

    def latest_per_symbol(self, symbols: list[str] | None = None) -> dict[str, dict]:
        result = {}
        sql = """SELECT t1.symbol, t1.ts_utc, t1.ts_epoch, t1.bid, t1.ask, t1.spread, t1.mid
                 FROM ticks t1
                 JOIN (SELECT symbol, MAX(ts_epoch) me FROM ticks WHERE source = 'MT5' GROUP BY symbol) t2
                   ON t1.symbol=t2.symbol AND t1.ts_epoch=t2.me"""
        params: tuple[Any, ...] = ()
        if symbols:
            placeholders = ",".join("?" for _ in symbols)
            sql += f" WHERE t1.source = 'MT5' AND t1.symbol IN ({placeholders})"
            params = tuple(symbols)
        else:
            sql += " WHERE t1.source = 'MT5'"
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


class _MT5FeedWorker:
    def __init__(self, *, r: Redis, settings: Settings, on_tick, on_timeframe_references):
        self._r = r
        self._s = settings
        self._on_tick = on_tick
        self._on_timeframe_references = on_timeframe_references
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.mt5 = None
        self.connected = False
        self.last_error = None
        self._last_tick_epoch: dict[str, float] = {}
        self._history_backfilled = False
        self._clock_offset_seconds = 0
        self._timeframe_references_refreshed_at = 0.0

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
        newest_epoch = 0.0
        for sym in self._s.symbols:
            tick = self.mt5.symbol_info_tick(sym)
            if tick is not None:
                newest_epoch = max(newest_epoch, float(tick.time_msc or tick.time * 1000) / 1000.0)
        self._clock_offset_seconds = broker_clock_offset(newest_epoch) if newest_epoch else 0
        return True

    def _stored_tick(self, symbol: str, tick) -> tuple | None:
        bid = float(tick["bid"])
        ask = float(tick["ask"])
        last = float(tick["last"])
        mid = round((bid + ask) / 2.0, 8) if bid > 0.0 and ask > 0.0 else last
        if mid <= 0.0:
            return None
        epoch = float(tick["time_msc"] or int(tick["time"]) * 1000) / 1000.0
        epoch -= self._clock_offset_seconds
        stamp = datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()
        spread = float(tick["spread"]) if "spread" in tick.dtype.names else round(ask - bid, 8)
        return symbol, stamp, epoch, bid, ask, spread, mid, "MT5"

    def _backfill_history(self) -> None:
        now = utc_now()
        total_window_seconds = self._s.history_hours * 3600
        cutoff = now - timedelta(seconds=total_window_seconds)
        broker_cutoff = cutoff + timedelta(seconds=self._clock_offset_seconds)
        broker_now = now + timedelta(seconds=self._clock_offset_seconds)
        selected: dict[tuple[str, float], tuple] = {}
        for symbol in self._s.symbols:
            reference_ticks = self.mt5.copy_ticks_from(symbol, broker_cutoff, 1, self.mt5.COPY_TICKS_ALL)
            for tick in reference_ticks if reference_ticks is not None else ():
                row = self._stored_tick(symbol, tick)
                if row:
                    selected[(symbol, row[2])] = row
                break

        lookback_seconds = min(total_window_seconds, 60)
        while True:
            recent: dict[tuple[str, float], tuple] = {}
            epochs: set[float] = set()
            range_start = broker_now - timedelta(seconds=lookback_seconds)
            for symbol in self._s.symbols:
                ticks = self.mt5.copy_ticks_range(symbol, range_start, broker_now, self.mt5.COPY_TICKS_ALL)
                for tick in ticks if ticks is not None else ():
                    row = self._stored_tick(symbol, tick)
                    if row:
                        recent[(symbol, row[2])] = row
                        epochs.add(row[2])
            if len(epochs) >= 1000 or lookback_seconds >= total_window_seconds:
                selected.update(recent)
                break
            lookback_seconds = min(total_window_seconds, lookback_seconds * 4)

        rows = sorted(selected.values(), key=lambda row: row[2])
        latest_rows: dict[str, tuple] = {}
        for row in rows:
            latest_rows[row[0]] = row
        payloads = [
            {
                "ts": row[1], "symbol": row[0], "bid": row[3], "ask": row[4],
                "spread": row[5], "mid": row[6], "source": "MT5",
            }
            for row in latest_rows.values()
        ]
        if payloads:
            self._on_tick(payloads, rows)
            self._last_tick_epoch.update({symbol: row[2] for symbol, row in latest_rows.items()})
        self._history_backfilled = True

    def _refresh_timeframe_references(self) -> None:
        references: dict[str, dict[str, float]] = {
            timeframe: {} for timeframe in TIMEFRAMES if timeframe != "TICK"
        }
        year_start = datetime(utc_now().year, 1, 1, tzinfo=timezone.utc) + timedelta(
            seconds=self._clock_offset_seconds
        )
        year_search_end = year_start + timedelta(days=7)
        def period_open(rates, period_seconds: int) -> float | None:
            if rates is None or len(rates) == 0:
                return None
            period_start = int(rates[-1]["time"]) // period_seconds * period_seconds
            candidates = [rate for rate in rates if int(rate["time"]) >= period_start]
            rate = candidates[0] if candidates else rates[-1]
            opening_price = float(rate["open"])
            return opening_price if opening_price > 0.0 else None

        for symbol in self._s.symbols:
            minute_rates = self.mt5.copy_rates_from_pos(symbol, self.mt5.TIMEFRAME_M1, 0, 31)
            for timeframe, seconds in {"M1": 60, "M5": 300, "M15": 900, "M30": 1800}.items():
                opening_price = period_open(minute_rates, seconds)
                if opening_price:
                    references[timeframe][symbol] = opening_price
            hour_rates = self.mt5.copy_rates_from_pos(symbol, self.mt5.TIMEFRAME_H1, 0, 13)
            for timeframe, seconds in {"H1": 3600, "H4": 14400, "H6": 21600, "H8": 28800, "H12": 43200}.items():
                opening_price = period_open(hour_rates, seconds)
                if opening_price:
                    references[timeframe][symbol] = opening_price
            for timeframe, constant_name in {"D1": "TIMEFRAME_D1", "W1": "TIMEFRAME_W1", "MN1": "TIMEFRAME_MN1"}.items():
                rates = self.mt5.copy_rates_from_pos(symbol, getattr(self.mt5, constant_name), 0, 1)
                for rate in rates if rates is not None else ():
                    opening_price = float(rate["open"])
                    if opening_price > 0.0:
                        references[timeframe][symbol] = opening_price
                    break
            year_rates = self.mt5.copy_rates_range(
                symbol, self.mt5.TIMEFRAME_D1, year_start, year_search_end
            )
            for rate in year_rates if year_rates is not None else ():
                opening_price = float(rate["open"])
                if opening_price > 0.0:
                    references["YTD"][symbol] = opening_price
                break
        self._on_timeframe_references(references)
        self._timeframe_references_refreshed_at = time.monotonic()

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
                    if not self._history_backfilled:
                        try:
                            self._backfill_history()
                            log.info("MT5 tick history backfill completed")
                        except Exception as exc:
                            self.last_error = f"history backfill failed: {exc}"
                            log.warning("MT5 history backfill failed", extra={"fields": {"exc": str(exc)}})
                    try:
                        self._refresh_timeframe_references()
                    except Exception as exc:
                        self.last_error = f"timeframe reference refresh failed: {exc}"
                        log.warning("MT5 timeframe refresh failed", extra={"fields": {"exc": str(exc)}})
                else:
                    reconnect_attempt += 1
                    time.sleep(min(30, 1 + reconnect_attempt * 2))
                    continue
            try:
                if time.monotonic() - self._timeframe_references_refreshed_at >= 30.0:
                    self._refresh_timeframe_references()
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
                    normalized_ts_s = ts_s - self._clock_offset_seconds
                    if normalized_ts_s <= self._last_tick_epoch.get(sym, 0.0):
                        continue
                    self._last_tick_epoch[sym] = normalized_ts_s
                    ts_utc = datetime.fromtimestamp(normalized_ts_s, tz=timezone.utc).isoformat()
                    ts_epoch = normalized_ts_s
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
                    rows.append((sym, ts_utc, ts_epoch, bid, ask, spread, mid, "MT5"))
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
            feed_source="MT5",
            mt5_error=None,
            total_ticks=0,
        )
        self.reference_prices: dict[str, float] = {}
        self.timeframe_reference_prices: dict[str, dict[str, float]] = {}
        self.reference_refreshed_at = 0.0
        self._seed_from_store()

    def _seed_from_store(self):
        since = (utc_now() - timedelta(hours=self.s.history_hours)).timestamp()
        rows = self.store.symbols_since(since_s=since, symbols=self.s.symbols)
        latest = self.store.latest_per_symbol(self.s.symbols)
        self.reference_prices = self.store.reference_prices_since(since_s=since, symbols=self.s.symbols)
        self.reference_refreshed_at = utc_now().timestamp()
        per_ccy: dict[str, list[tuple[float, float]]] = {c: [] for c in CCY_ROWS}
        if latest:
            self.state.latest = latest
        current_mid = dict(self.reference_prices)
        last_sample_epoch = 0.0
        for index, (sym, _ts_utc, epoch, _b, _a, _spr, mid) in enumerate(rows):
            ep = float(epoch)
            current_mid[sym] = float(mid)
            # Apply every symbol update sharing this timestamp before sampling.
            if index + 1 < len(rows) and float(rows[index + 1][2]) == ep:
                continue
            # Only retained five-second points need a full 28-pair calculation.
            # A single chronological pass avoids rescanning all symbols for each
            # raw event when restoring a populated 24-hour store.
            if last_sample_epoch and ep - last_sample_epoch < 4.9:
                continue
            ccy_vals = compute_currency_values(
                {sym: {"mid": current_mid[sym]} for sym in current_mid}, self.reference_prices
            )
            for c in CCY_ROWS:
                per_ccy[c].append((ep, ccy_vals[c]))
            last_sample_epoch = ep
        if not rows and latest:
            ep = max(v["ts_epoch"] for v in latest.values()) if latest else utc_now().timestamp()
            ccy_vals = compute_currency_values(
                {sym: {"mid": latest[sym]["mid"]} for sym in latest}, self.reference_prices
            )
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

    def update_timeframe_references(self, references: dict[str, dict[str, float]]) -> None:
        with self.lock:
            self.timeframe_reference_prices = references

    def on_tick(self, payloads: list[dict], rows: list[tuple]):
        payloads = [payload for payload in payloads if str(payload.get("source", "")).upper() == "MT5"]
        if not payloads:
            return
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
                    "source": "MT5",
                    "ts_display": now.astimezone(TZ_LAGOS).isoformat(),
                }
            self.state.latest.update(latest_updates)
            if now_ep - self.reference_refreshed_at >= 60.0 or not self.reference_prices:
                since = (now - timedelta(hours=self.s.history_hours)).timestamp()
                self.reference_prices = self.store.reference_prices_since(since_s=since, symbols=self.s.symbols)
                self.reference_refreshed_at = now_ep
            ccy_vals = compute_currency_values(
                {sym: {"mid": self.state.latest[sym]["mid"]} for sym in self.state.latest},
                self.reference_prices,
            )
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
            latest_prices = {symbol: {"mid": tick["mid"]} for symbol, tick in self.state.latest.items()}
            matrix = {currency: {} for currency in CCY_ROWS}
            for timeframe in TIMEFRAMES:
                references = (
                    self.reference_prices
                    if timeframe == "TICK"
                    else self.timeframe_reference_prices.get(timeframe, {})
                )
                percentages = normalize_strength_percentages(compute_currency_values(latest_prices, references))
                for currency in CCY_ROWS:
                    matrix[currency][timeframe] = percentages[currency]
            ranked = sorted(
                [{"currency": c, "avg_bias": round(sum(matrix[c].values()) / max(1, len(matrix[c])), 1)} for c in CCY_ROWS],
                key=lambda x: x["avg_bias"],
                reverse=True,
            )
            missing_symbols = [symbol for symbol in self.s.symbols if symbol not in self.state.latest]
            intelligence = analyze_matrix(
                matrix,
                symbols=self.s.symbols,
                connected=self.state.mt5_connected,
                missing_symbols=missing_symbols,
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
                        "htf_filter": higher_timeframe_filter(matrix[c]),
                    }
                    for c in CCY_ROWS
                ],
                "ranked_bias": ranked,
                "intelligence": intelligence,
                "value_unit": "percent",
                "sampling": "live_mt5",
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
                "purged_non_mt5_rows": self.store.purged_non_mt5,
            }

    def build_history(self, *, hours: int, symbols: list[str] | None = None, limit: int = 1000) -> dict:
        since = (utc_now() - timedelta(hours=hours)).timestamp()
        sym_order = symbols or self.s.symbols
        row_limit = max(1, min(MAX_HISTORY_TICK_ROWS, int(limit)))
        baseline, raw_rows = self.store.recent_tick_rows(since_s=since, symbols=sym_order, limit=row_limit)
        references = self.store.reference_prices_since(since_s=since, symbols=sym_order)
        cur_mid = {symbol: float(mid) for symbol, mid in baseline.items()}
        for symbol, reference in references.items():
            cur_mid.setdefault(symbol, reference)
        events: dict[float, list[tuple[str, float]]] = {}
        for sym, _ts_utc, ts_epoch, _bid, _ask, _spr, mid in raw_rows:
            events.setdefault(float(ts_epoch), []).append((sym, float(mid)))

        calculated: list[tuple[float, dict[str, float]]] = []
        previous_values: dict[str, float] | None = None
        for epoch, updates in events.items():
            for symbol, mid in updates:
                cur_mid[symbol] = mid
            raw_values = compute_currency_values(
                {symbol: {"mid": mid} for symbol, mid in cur_mid.items()}, references
            )
            percentages = normalize_strength_percentages(raw_values)
            if percentages != previous_values:
                calculated.append((epoch, percentages))
                previous_values = percentages

        now = utc_now()
        rows_out = []
        for epoch, values in reversed(calculated[-row_limit:]):
            ts_utc = datetime.fromtimestamp(epoch, tz=timezone.utc)
            rows_out.append({
                "key": f"tick-{epoch}",
                "timestamp_utc": ts_utc.isoformat(),
                "timestamp_display": ts_utc.astimezone(TZ_LAGOS).isoformat(),
                "values": values,
                "source": "MT5_TICK",
            })
        intelligence = analyze_history(rows_out)
        return {
            "ts_utc": now.isoformat(),
            "ts_display": now.astimezone(TZ_LAGOS).isoformat(),
            "history_hours": hours,
            "row_interval_seconds": None,
            "sampling": "strength_change",
            "value_unit": "percent",
            "row_limit": row_limit,
            "strength_lookback_hours": hours,
            "feed_source": "MT5",
            "currencies": list(CCY_ROWS),
            "rows": rows_out,
            "intelligence": intelligence,
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

    def on_timeframe_references(references: dict[str, dict[str, float]]):
        feed.update_timeframe_references(references)

    @app.on_event("startup")
    def _startup():
        if app.state.redis is None:
            app.state.redis = Redis.from_url(settings.redis_url, decode_responses=True)
        if settings.feed_mode.upper() != "MT5":
            log.warning("FEED_MODE=%s ignored: market data is MT5-only", settings.feed_mode)
        w = _MT5FeedWorker(
            r=app.state.redis,
            settings=settings,
            on_tick=on_tick,
            on_timeframe_references=on_timeframe_references,
        )
        w.start()
        app.state.worker = w
        feed.state.feed_source = "MT5"

        def _status_updater():
            while True:
                feed.state.mt5_connected = w.connected
                feed.state.mt5_error = w.last_error
                time.sleep(1.0)
        threading.Thread(target=_status_updater, daemon=True).start()
        log.info("market-data MT5-only feed worker started")

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
    def api_history(
        hours: int = Query(24, ge=1, le=24 * 7),
        symbols: str | None = None,
        limit: int = Query(1000, ge=1, le=MAX_HISTORY_TICK_ROWS),
    ):
        sym_list = [s.strip() for s in symbols.split(",")] if symbols else None
        return feed.build_history(hours=hours, symbols=sym_list, limit=limit)

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
