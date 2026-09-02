"""Read live status or rolling tick history from the locally logged-in MT5 terminal."""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import MetaTrader5 as mt5


SYMBOLS = [
    "AUDCAD", "AUDCHF", "AUDJPY", "AUDNZD", "AUDUSD", "CADCHF", "CADJPY", "CHFJPY",
    "EURAUD", "EURCAD", "EURCHF", "EURGBP", "EURJPY", "EURNZD", "EURUSD", "GBPAUD",
    "GBPCAD", "GBPCHF", "GBPJPY", "GBPNZD", "GBPUSD", "NZDCAD", "NZDCHF", "NZDJPY",
    "NZDUSD", "USDCAD", "USDCHF", "USDJPY", "XAUUSD",
]
CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"]
FX_CURRENCIES = set(CURRENCIES) - {"XAU"}
FX_PAIRS = {
    symbol: (symbol[:3], symbol[3:])
    for symbol in SYMBOLS
    if len(symbol) == 6 and symbol[:3] in FX_CURRENCIES and symbol[3:] in FX_CURRENCIES
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


def strength(prices: dict[str, float], references: dict[str, float]) -> dict[str, float]:
    totals = {currency: 0.0 for currency in CURRENCIES}
    counts = {currency: 0 for currency in CURRENCIES}
    for symbol, (base_currency, quote_currency) in FX_PAIRS.items():
        current = float(prices.get(symbol, 0.0))
        reference = float(references.get(symbol, 0.0))
        if current <= 0.0 or reference <= 0.0:
            continue
        pair_return = math.log(current / reference) * 100.0
        totals[base_currency] += pair_return
        totals[quote_currency] -= pair_return
        counts[base_currency] += 1
        counts[quote_currency] += 1
    xau_current = float(prices.get("XAUUSD", 0.0))
    xau_reference = float(references.get("XAUUSD", 0.0))
    if xau_current > 0.0 and xau_reference > 0.0:
        totals["XAU"] = math.log(xau_current / xau_reference) * 100.0
        counts["XAU"] = 1
    return {
        currency: round(totals[currency] / counts[currency], 6) if counts[currency] else 0.0
        for currency in CURRENCIES
    }


def strength_percentages(values: dict[str, float]) -> dict[str, float]:
    numeric = {currency: float(values.get(currency, 0.0)) for currency in CURRENCIES}
    low = min(numeric.values())
    high = max(numeric.values())
    if math.isclose(low, high, rel_tol=0.0, abs_tol=1e-12):
        return {currency: 50.0 for currency in CURRENCIES}

    low_count = sum(math.isclose(value, low, rel_tol=0.0, abs_tol=1e-12) for value in numeric.values())
    high_count = sum(math.isclose(value, high, rel_tol=0.0, abs_tol=1e-12) for value in numeric.values())
    spread = high - low
    result = {}
    for currency, value in numeric.items():
        percentage = (value - low) / spread * 100.0
        if low_count > 1 and math.isclose(value, low, rel_tol=0.0, abs_tol=1e-12):
            percentage = 0.1
        elif high_count > 1 and math.isclose(value, high, rel_tol=0.0, abs_tol=1e-12):
            percentage = 99.9
        percentage = round(percentage, 1)
        if percentage <= 0.0 and not (low_count == 1 and math.isclose(value, low, rel_tol=0.0, abs_tol=1e-12)):
            percentage = 0.1
        elif percentage >= 100.0 and not (high_count == 1 and math.isclose(value, high, rel_tol=0.0, abs_tol=1e-12)):
            percentage = 99.9
        result[currency] = percentage
    return result


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
        "total_ticks": 0, "tick_db": "MT5 terminal tick history", "history_hours": 24,
        "account_login": int(account.login), "account_server": str(account.server),
    }


def history_payload(terminal, hours: int, limit: int) -> dict:
    row_limit = max(1, min(5000, limit))
    references: dict[str, float] = {}
    now = datetime.now(timezone.utc)
    cutoff_dt = now.timestamp() - hours * 3600
    for symbol in SYMBOLS:
        mt5.symbol_select(symbol, True)
        reference_ticks = mt5.copy_ticks_from(
            symbol, datetime.fromtimestamp(cutoff_dt, timezone.utc), 1, mt5.COPY_TICKS_ALL
        )
        for tick in reference_ticks if reference_ticks is not None else ():
            reference_bid = float(tick["bid"])
            reference_ask = float(tick["ask"])
            reference_last = float(tick["last"])
            reference_mid = (
                (reference_bid + reference_ask) / 2.0
                if reference_bid > 0 and reference_ask > 0
                else reference_last
            )
            if reference_mid > 0:
                references[symbol] = reference_mid
            break

    per_symbol: dict[str, dict[float, float]] = {}
    all_epochs: set[float] = set()
    lookback_seconds = min(hours * 3600, 60)
    while True:
        per_symbol = {}
        all_epochs = set()
        range_start = datetime.fromtimestamp(now.timestamp() - lookback_seconds, timezone.utc)
        for symbol in SYMBOLS:
            ticks = mt5.copy_ticks_range(symbol, range_start, now, mt5.COPY_TICKS_ALL)
            points: dict[float, float] = {}
            for tick in ticks if ticks is not None else ():
                epoch = float(tick["time_msc"] or int(tick["time"]) * 1000) / 1000.0
                bid = float(tick["bid"])
                ask = float(tick["ask"])
                last = float(tick["last"])
                mid = (bid + ask) / 2.0 if bid > 0 and ask > 0 else last
                if mid <= 0:
                    continue
                points[epoch] = mid
                all_epochs.add(epoch)
            per_symbol[symbol] = points
        if len(all_epochs) >= row_limit or lookback_seconds >= hours * 3600:
            break
        lookback_seconds = min(hours * 3600, lookback_seconds * 4)

    raw_epochs = sorted((epoch for epoch in all_epochs if epoch >= cutoff_dt), reverse=True)[:row_limit]
    clock_offset = broker_clock_offset(float(raw_epochs[0])) if raw_epochs else 0
    epochs = [epoch - clock_offset for epoch in raw_epochs]
    prices = dict(references)
    if raw_epochs:
        first_epoch = min(raw_epochs)
        for symbol, points in per_symbol.items():
            prior_epochs = [epoch for epoch in points if epoch < first_epoch]
            if prior_epochs:
                prices[symbol] = points[max(prior_epochs)]
    rows = []
    calculated: dict[float, dict[str, float]] = {}
    for raw_epoch in sorted(raw_epochs):
        for symbol in SYMBOLS:
            if raw_epoch in per_symbol[symbol]:
                prices[symbol] = per_symbol[symbol][raw_epoch]
        calculated[raw_epoch - clock_offset] = strength_percentages(strength(prices, references))
    for epoch in epochs:
        utc = datetime.fromtimestamp(epoch, timezone.utc)
        rows.append({
            "key": f"mt5-{epoch}", "timestamp_utc": iso(epoch),
            "timestamp_display": utc.astimezone(LAGOS).isoformat(),
            "values": calculated[epoch], "source": "MT5_TICK",
        })
    return {
        "ts_utc": now.isoformat(), "ts_display": now.astimezone(LAGOS).isoformat(),
        "feed_source": "MT5", "mt5_connected": bool(terminal.connected), "mt5_error": None,
        "history_hours": hours, "row_interval_seconds": None, "sampling": "tick",
        "value_unit": "percent", "row_limit": row_limit, "strength_lookback_hours": hours,
        "currencies": CURRENCIES, "rows": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("status", "history"))
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--limit", type=int, default=1000)
    args = parser.parse_args()
    try:
        terminal, account = connect()
        payload = status_payload(terminal, account) if args.mode == "status" else history_payload(
            terminal, max(1, min(168, args.hours)), args.limit
        )
        print(json.dumps(payload, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "mt5_connected": False, "error": str(error)}))
        return 1
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
