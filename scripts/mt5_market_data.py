"""Read live status or rolling M5 history from the locally logged-in MT5 terminal."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import MetaTrader5 as mt5


SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "XAUUSD"]
CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"]
BASE = {
    "EURUSD": 1.0845, "GBPUSD": 1.2716, "USDJPY": 147.22, "AUDUSD": 0.6648,
    "NZDUSD": 0.5988, "USDCAD": 1.3562, "USDCHF": 0.8913, "XAUUSD": 2526.40,
}
LAGOS = ZoneInfo("Africa/Lagos")


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


def broker_clock_offset(latest_epoch: float) -> int:
    """Normalize brokers that expose chart epochs in server time instead of UTC."""
    difference = latest_epoch - datetime.now(timezone.utc).timestamp()
    if 30 * 60 < abs(difference) < 14 * 60 * 60:
        return int(round(difference / 3600.0) * 3600)
    return 0


def strength(prices: dict[str, float]) -> dict[str, float]:
    def normalized(symbol: str, inverse: bool = False) -> float:
        value = prices.get(symbol, 0.0)
        base = BASE[symbol]
        if value <= 0:
            return 0.0
        if inverse:
            value, base = 1.0 / value, 1.0 / base
        return math.tanh(((value / base) - 1.0) * 10.0)

    aud = normalized("AUDUSD")
    cad = normalized("USDCAD", True)
    eur = normalized("EURUSD")
    nzd = normalized("NZDUSD")
    gbp = normalized("GBPUSD")
    chf = normalized("USDCHF", True)
    jpy = normalized("USDJPY", True)
    xau = normalized("XAUUSD")
    usd = (cad + chf + jpy - eur - gbp - aud - nzd) / 7.0
    values = {"AUD": aud, "CAD": cad, "EUR": eur, "NZD": nzd, "GBP": gbp,
              "USD": usd, "CHF": chf, "JPY": jpy, "XAU": xau}
    return {key: round(value * 0.25, 4) for key, value in values.items()}


def connect() -> tuple[object, object]:
    if not mt5.initialize():
        raise RuntimeError(f"MT5 initialize failed: {mt5.last_error()}")
    terminal = mt5.terminal_info()
    account = mt5.account_info()
    if terminal is None or account is None:
        raise RuntimeError(f"MT5 account unavailable: {mt5.last_error()}")
    return terminal, account


def status_payload(terminal, account) -> dict:
    present, missing, newest = [], [], 0.0
    for symbol in SYMBOLS:
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            missing.append(symbol)
        else:
            present.append(symbol)
            newest = max(newest, float(tick.time_msc or tick.time * 1000) / 1000.0)
    now = datetime.now(timezone.utc)
    newest -= broker_clock_offset(newest) if newest else 0
    return {
        "ts_utc": now.isoformat(), "ts_display": now.astimezone(LAGOS).isoformat(),
        "feed_mode": "MT5", "feed_source": "MT5", "mt5_connected": bool(terminal.connected),
        "mt5_error": None, "configured_symbols": SYMBOLS, "symbols_present": present,
        "missing_symbols": missing, "last_tick_seconds_ago": round(max(0.0, now.timestamp() - newest), 2) if newest else None,
        "total_ticks": 0, "tick_db": "MT5 terminal M5 history", "history_hours": 24,
        "account_login": int(account.login), "account_server": str(account.server),
    }


def history_payload(terminal, hours: int) -> dict:
    count = min(24 * 7 * 12, max(12, hours * 12))
    per_symbol: dict[str, dict[int, float]] = {}
    all_epochs: set[int] = set()
    for symbol in SYMBOLS:
        mt5.symbol_select(symbol, True)
        rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M5, 0, count)
        points: dict[int, float] = {}
        for rate in rates if rates is not None else ():
            epoch = int(rate["time"]) // 300 * 300
            points[epoch] = float(rate["close"])
            all_epochs.add(epoch)
        per_symbol[symbol] = points

    raw_epochs = sorted(all_epochs, reverse=True)[:count]
    clock_offset = broker_clock_offset(float(raw_epochs[0])) if raw_epochs else 0
    epochs = [epoch - clock_offset for epoch in raw_epochs]
    prices: dict[str, float] = {}
    rows = []
    # Process oldest first so missing bars carry the last known value forward.
    calculated: dict[int, dict[str, float]] = {}
    for raw_epoch in sorted(raw_epochs):
        for symbol in SYMBOLS:
            if raw_epoch in per_symbol[symbol]:
                prices[symbol] = per_symbol[symbol][raw_epoch]
        calculated[raw_epoch - clock_offset] = strength(prices)
    for epoch in epochs:
        utc = datetime.fromtimestamp(epoch, timezone.utc)
        rows.append({
            "key": f"mt5-{epoch}", "timestamp_utc": iso(epoch),
            "timestamp_display": utc.astimezone(LAGOS).isoformat(),
            "values": calculated[epoch], "source": "MT5_M5",
        })
    now = datetime.now(timezone.utc)
    return {
        "ts_utc": now.isoformat(), "ts_display": now.astimezone(LAGOS).isoformat(),
        "feed_source": "MT5", "mt5_connected": bool(terminal.connected), "mt5_error": None,
        "history_hours": hours, "row_interval_seconds": 300, "currencies": CURRENCIES, "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("status", "history"))
    parser.add_argument("--hours", type=int, default=24)
    args = parser.parse_args()
    try:
        terminal, account = connect()
        payload = status_payload(terminal, account) if args.mode == "status" else history_payload(terminal, max(1, min(168, args.hours)))
        print(json.dumps(payload, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "mt5_connected": False, "error": str(error)}))
        return 1
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
