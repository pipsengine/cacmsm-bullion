"""Read live status or rolling tick history from the locally logged-in MT5 terminal."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import MetaTrader5 as mt5

SHARED_PATH = Path(__file__).resolve().parents[1] / "services" / "_shared"
if str(SHARED_PATH) not in sys.path:
    sys.path.insert(0, str(SHARED_PATH))

from cacsms_shared.market_intelligence import analyze_history, analyze_matrix


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
TIMEFRAMES = ["TICK", "M1", "M5", "M15", "M30", "H1", "H4", "H6", "H8", "H12", "D1", "W1", "MN1", "YTD"]
LAGOS = ZoneInfo("Africa/Lagos")


def iso(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")


def broker_clock_offset(latest_epoch: float) -> int:
    """Normalize brokers that expose chart epochs in server time instead of UTC."""
    difference = latest_epoch - datetime.now(timezone.utc).timestamp()
    if 30 * 60 < abs(difference) < 14 * 60 * 60:
        return int(round(difference / 3600.0) * 3600)
    return 0


def higher_timeframe_filter(values: dict[str, float]) -> str:
    anchors = [float(values.get(timeframe, 50.0)) for timeframe in ("D1", "W1", "MN1")]
    if all(value >= 70.0 for value in anchors):
        return "STRONG"
    if all(value <= 30.0 for value in anchors):
        return "WEAK"
    return "NEUTRAL"


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
    result = {currency: round(fx_values.get(currency, 0.0), 6) for currency in CURRENCIES}

    xau_current = float(prices.get("XAUUSD", 0.0))
    xau_reference = float(references.get("XAUUSD", 0.0))
    if xau_current > 0.0 and xau_reference > 0.0:
        result["XAU"] = round(result["USD"] + math.log(xau_current / xau_reference) * 100.0, 6)
    return result


def strength_percentages(values: dict[str, float]) -> dict[str, float]:
    numeric = {currency: float(values.get(currency, 0.0)) for currency in CURRENCIES}
    mean = statistics.fmean(numeric.values())
    deviation = statistics.pstdev(numeric.values())
    if deviation <= 1e-12:
        return {currency: 50.0 for currency in CURRENCIES}
    normal = statistics.NormalDist()
    return {
        currency: round(max(0.1, min(99.9, normal.cdf((value - mean) / deviation) * 100.0)), 1)
        for currency, value in numeric.items()
    }


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


def snapshot_payload(terminal, hours: int = 24) -> dict:
    now = datetime.now(timezone.utc)
    present, missing, latest_prices, symbol_ticks = [], [], {}, []
    newest_epoch = 0.0
    raw_ticks = {}
    for symbol in SYMBOLS:
        mt5.symbol_select(symbol, True)
        tick = mt5.symbol_info_tick(symbol)
        if tick is None:
            missing.append(symbol)
            continue
        raw_ticks[symbol] = tick
        present.append(symbol)
        newest_epoch = max(newest_epoch, float(tick.time_msc or tick.time * 1000) / 1000.0)
        bid = float(tick.bid)
        ask = float(tick.ask)
        latest_prices[symbol] = (bid + ask) / 2.0

    clock_offset = broker_clock_offset(newest_epoch) if newest_epoch else 0
    broker_cutoff = datetime.fromtimestamp(now.timestamp() - hours * 3600 + clock_offset, timezone.utc)
    year_start = datetime(now.year, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=clock_offset)
    year_search_end = year_start + timedelta(days=7)
    references_by_timeframe: dict[str, dict[str, float]] = {timeframe: {} for timeframe in TIMEFRAMES}

    def period_open(rates, period_seconds: int) -> float | None:
        if rates is None or len(rates) == 0:
            return None
        period_start = int(rates[-1]["time"]) // period_seconds * period_seconds
        candidates = [rate for rate in rates if int(rate["time"]) >= period_start]
        rate = candidates[0] if candidates else rates[-1]
        opening_price = float(rate["open"])
        return opening_price if opening_price > 0.0 else None

    for symbol, tick in raw_ticks.items():
        raw_epoch = float(tick.time_msc or tick.time * 1000) / 1000.0
        normalized_epoch = raw_epoch - clock_offset
        bid = float(tick.bid)
        ask = float(tick.ask)
        symbol_ticks.append({
            "symbol": symbol,
            "ts_utc": iso(normalized_epoch),
            "ts_display": datetime.fromtimestamp(normalized_epoch, timezone.utc).astimezone(LAGOS).isoformat(),
            "bid": bid,
            "ask": ask,
            "spread": round(ask - bid, 8),
            "mid": latest_prices[symbol],
            "source": "MT5",
        })
        reference_ticks = mt5.copy_ticks_from(symbol, broker_cutoff, 1, mt5.COPY_TICKS_ALL)
        for reference_tick in reference_ticks if reference_ticks is not None else ():
            ref_bid = float(reference_tick["bid"])
            ref_ask = float(reference_tick["ask"])
            ref_last = float(reference_tick["last"])
            ref_mid = (ref_bid + ref_ask) / 2.0 if ref_bid > 0.0 and ref_ask > 0.0 else ref_last
            if ref_mid > 0.0:
                references_by_timeframe["TICK"][symbol] = ref_mid
            break
        minute_rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_M1, 0, 31)
        for timeframe, seconds in {"M1": 60, "M5": 300, "M15": 900, "M30": 1800}.items():
            opening_price = period_open(minute_rates, seconds)
            if opening_price:
                references_by_timeframe[timeframe][symbol] = opening_price
        hour_rates = mt5.copy_rates_from_pos(symbol, mt5.TIMEFRAME_H1, 0, 13)
        for timeframe, seconds in {"H1": 3600, "H4": 14400, "H6": 21600, "H8": 28800, "H12": 43200}.items():
            opening_price = period_open(hour_rates, seconds)
            if opening_price:
                references_by_timeframe[timeframe][symbol] = opening_price
        for timeframe, constant_name in {"D1": "TIMEFRAME_D1", "W1": "TIMEFRAME_W1", "MN1": "TIMEFRAME_MN1"}.items():
            rates = mt5.copy_rates_from_pos(symbol, getattr(mt5, constant_name), 0, 1)
            for rate in rates if rates is not None else ():
                opening_price = float(rate["open"])
                if opening_price > 0.0:
                    references_by_timeframe[timeframe][symbol] = opening_price
                break
        year_rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_D1, year_start, year_search_end)
        for rate in year_rates if year_rates is not None else ():
            opening_price = float(rate["open"])
            if opening_price > 0.0:
                references_by_timeframe["YTD"][symbol] = opening_price
            break

    matrix = {currency: {} for currency in CURRENCIES}
    for timeframe in TIMEFRAMES:
        scores = strength(latest_prices, references_by_timeframe[timeframe])
        percentages = strength_percentages(scores)
        for currency in CURRENCIES:
            matrix[currency][timeframe] = percentages[currency]
    ranked = sorted(
        [
            {"currency": currency, "avg_bias": round(sum(matrix[currency].values()) / len(TIMEFRAMES), 1)}
            for currency in CURRENCIES
        ],
        key=lambda item: item["avg_bias"],
        reverse=True,
    )
    intelligence = analyze_matrix(
        matrix,
        symbols=SYMBOLS,
        connected=bool(terminal.connected),
        missing_symbols=missing,
    )
    return {
        "ts_utc": now.isoformat(),
        "ts_display": now.astimezone(LAGOS).isoformat(),
        "feed_source": "MT5",
        "mt5_connected": bool(terminal.connected),
        "mt5_error": None,
        "total_ticks": len(symbol_ticks),
        "symbols_present": present,
        "missing_symbols": missing,
        "symbols": symbol_ticks,
        "currency_values": {currency: matrix[currency]["TICK"] for currency in CURRENCIES},
        "matrix_rows": [
            {
                "currency": currency,
                "values": matrix[currency],
                "htf_filter": higher_timeframe_filter(matrix[currency]),
            }
            for currency in CURRENCIES
        ],
        "ranked_bias": ranked,
        "intelligence": intelligence,
        "value_unit": "percent",
        "sampling": "live_mt5",
    }


def history_payload(terminal, hours: int, limit: int) -> dict:
    row_limit = max(1, min(5000, limit))
    references: dict[str, float] = {}
    now = datetime.now(timezone.utc)
    newest_epoch = 0.0
    for symbol in SYMBOLS:
        tick = mt5.symbol_info_tick(symbol)
        if tick is not None:
            newest_epoch = max(newest_epoch, float(tick.time_msc or tick.time * 1000) / 1000.0)
    clock_offset = broker_clock_offset(newest_epoch) if newest_epoch else 0
    broker_now = datetime.fromtimestamp(now.timestamp() + clock_offset, timezone.utc)
    cutoff_epoch = now.timestamp() - hours * 3600
    broker_cutoff = datetime.fromtimestamp(cutoff_epoch + clock_offset, timezone.utc)
    for symbol in SYMBOLS:
        mt5.symbol_select(symbol, True)
        reference_ticks = mt5.copy_ticks_from(
            symbol, broker_cutoff, 1, mt5.COPY_TICKS_ALL
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
        range_start = broker_now - timedelta(seconds=lookback_seconds)
        for symbol in SYMBOLS:
            ticks = mt5.copy_ticks_range(symbol, range_start, broker_now, mt5.COPY_TICKS_ALL)
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

    raw_epochs = sorted((epoch for epoch in all_epochs if epoch >= cutoff_epoch + clock_offset), reverse=True)[:row_limit]
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
    previous_values: dict[str, float] | None = None
    for raw_epoch in sorted(raw_epochs):
        for symbol in SYMBOLS:
            if raw_epoch in per_symbol[symbol]:
                prices[symbol] = per_symbol[symbol][raw_epoch]
        percentages = strength_percentages(strength(prices, references))
        if percentages != previous_values:
            calculated[raw_epoch - clock_offset] = percentages
            previous_values = percentages
    epochs = sorted(calculated, reverse=True)[:row_limit]
    for epoch in epochs:
        utc = datetime.fromtimestamp(epoch, timezone.utc)
        rows.append({
            "key": f"mt5-{epoch}", "timestamp_utc": iso(epoch),
            "timestamp_display": utc.astimezone(LAGOS).isoformat(),
            "values": calculated[epoch], "source": "MT5_TICK",
        })
    intelligence = analyze_history(rows)
    return {
        "ts_utc": now.isoformat(), "ts_display": now.astimezone(LAGOS).isoformat(),
        "feed_source": "MT5", "mt5_connected": bool(terminal.connected), "mt5_error": None,
        "history_hours": hours, "row_interval_seconds": None, "sampling": "strength_change",
        "value_unit": "percent", "row_limit": row_limit, "strength_lookback_hours": hours,
        "currencies": CURRENCIES, "rows": rows, "intelligence": intelligence,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("status", "snapshot", "history"))
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--limit", type=int, default=1000)
    args = parser.parse_args()
    try:
        terminal, account = connect()
        if args.mode == "status":
            payload = status_payload(terminal, account)
        elif args.mode == "snapshot":
            payload = snapshot_payload(terminal, max(1, min(168, args.hours)))
        else:
            payload = history_payload(terminal, max(1, min(168, args.hours)), args.limit)
        print(json.dumps(payload, separators=(",", ":")))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "mt5_connected": False, "error": str(error)}))
        return 1
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
