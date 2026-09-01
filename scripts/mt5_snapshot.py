"""Emit a read-only JSON snapshot of the locally logged-in MetaTrader 5 terminal."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone

import MetaTrader5 as mt5


def iso_timestamp(value: int | float | None) -> str:
    return datetime.fromtimestamp(float(value or 0), timezone.utc).isoformat().replace("+00:00", "Z")


def number(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def main() -> int:
    if not mt5.initialize():
        code, message = mt5.last_error()
        print(json.dumps({"ok": False, "connected": False, "error": f"MT5 initialize failed ({code}): {message}"}))
        return 1

    try:
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if terminal is None or account is None:
            code, message = mt5.last_error()
            print(json.dumps({"ok": False, "connected": False, "error": f"MT5 account unavailable ({code}): {message}"}))
            return 1

        positions_raw = list(mt5.positions_get() or ())
        orders_raw = list(mt5.orders_get() or ())
        now = datetime.now(timezone.utc)
        history_start = now - timedelta(hours=24)
        deals_raw = list(mt5.history_deals_get(history_start, now) or ())

        ticks = {}
        symbols = {str(getattr(item, "symbol", "")) for item in positions_raw + orders_raw}
        symbols.update(("EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "XAUUSD"))
        for symbol in sorted(s for s in symbols if s):
            info = mt5.symbol_info(symbol)
            tick = mt5.symbol_info_tick(symbol)
            if info is None or tick is None:
                continue
            ticks[symbol] = {
                "symbol": symbol,
                "bid": number(tick.bid),
                "ask": number(tick.ask),
                "digits": int(getattr(info, "digits", 0) or 0),
                "point": number(getattr(info, "point", 0)),
                "trade_stops_level": int(getattr(info, "trade_stops_level", 0) or 0),
                "time": iso_timestamp(getattr(tick, "time", 0)),
            }

        positions = []
        for item in positions_raw:
            tick = ticks.get(str(item.symbol), {})
            point = number(tick.get("point"), 0)
            current = number(item.price_current)
            difference = current - number(item.price_open) if item.type == mt5.POSITION_TYPE_BUY else number(item.price_open) - current
            positions.append({
                "ticket": int(item.ticket), "identifier": int(item.identifier),
                "open_ts": iso_timestamp(item.time), "side": "BUY" if item.type == mt5.POSITION_TYPE_BUY else "SELL",
                "size": number(item.volume), "symbol": str(item.symbol), "open_price": number(item.price_open),
                "sl": number(item.sl) or None, "tp": number(item.tp) or None,
                "current_bid": number(tick.get("bid")), "current_ask": number(tick.get("ask")),
                "swap": number(item.swap), "commission": 0, "profit": number(item.profit),
                "profit_pips": difference / point if point else 0,
                "stop_level": int(tick.get("trade_stops_level", 0)), "comment": str(item.comment or ""),
                "magic": int(item.magic),
            })

        order_names = {
            mt5.ORDER_TYPE_BUY_LIMIT: "BUY LIMIT", mt5.ORDER_TYPE_SELL_LIMIT: "SELL LIMIT",
            mt5.ORDER_TYPE_BUY_STOP: "BUY STOP", mt5.ORDER_TYPE_SELL_STOP: "SELL STOP",
            mt5.ORDER_TYPE_BUY_STOP_LIMIT: "BUY STOP", mt5.ORDER_TYPE_SELL_STOP_LIMIT: "SELL STOP",
        }
        orders = [{
            "ticket": int(item.ticket), "ts": iso_timestamp(item.time_setup),
            "type": order_names.get(item.type, "BUY LIMIT"), "size": number(item.volume_current),
            "symbol": str(item.symbol), "price": number(item.price_open), "sl": number(item.sl) or None,
            "tp": number(item.tp) or None, "volume_filled": max(0, number(item.volume_initial) - number(item.volume_current)),
            "status": "PARTIAL" if number(item.volume_current) < number(item.volume_initial) else "OPEN",
            "comment": str(item.comment or ""), "magic": int(item.magic),
            "expiration": iso_timestamp(item.time_expiration) if item.time_expiration else None,
        } for item in orders_raw]

        deal_types = {mt5.DEAL_TYPE_BUY: "BUY", mt5.DEAL_TYPE_SELL: "SELL", mt5.DEAL_TYPE_BALANCE: "BALANCE", mt5.DEAL_TYPE_CREDIT: "CREDIT"}
        entry_types = {mt5.DEAL_ENTRY_IN: "IN", mt5.DEAL_ENTRY_OUT: "OUT", mt5.DEAL_ENTRY_INOUT: "OUT", mt5.DEAL_ENTRY_OUT_BY: "OUT"}
        deals = [{
            "deal": int(item.ticket), "order": int(item.order), "ts": iso_timestamp(item.time),
            "symbol": str(item.symbol or ""), "type": deal_types.get(item.type, "CORRECTION"),
            "entry": entry_types.get(item.entry, "IN"), "size": number(item.volume), "price": number(item.price),
            "sl": None, "tp": None, "profit": number(item.profit), "commission": number(item.commission),
            "swap": number(item.swap), "fee": number(item.fee), "comment": str(item.comment or ""),
            "magic": int(item.magic), "balance_delta": number(item.profit) if item.type in (mt5.DEAL_TYPE_BALANCE, mt5.DEAL_TYPE_CREDIT) else 0,
        } for item in deals_raw]

        profit_today = sum(d["profit"] + d["commission"] + d["swap"] + d["fee"] for d in deals if d["entry"] == "OUT")
        payload = {
            "ok": True, "connected": bool(terminal.connected), "captured_at": now.isoformat().replace("+00:00", "Z"),
            "terminal": terminal._asdict(),
            "account": {
                "login": int(account.login), "server": str(account.server), "company": str(account.company),
                "currency": str(account.currency), "leverage": int(account.leverage), "balance": number(account.balance),
                "equity": number(account.equity), "margin": number(account.margin), "free_margin": number(account.margin_free),
                "margin_level": number(account.margin_level), "floating_pl": number(account.profit),
                "profit_today": profit_today, "swap_today": sum(d["swap"] for d in deals),
                "commission_today": sum(d["commission"] + d["fee"] for d in deals),
                "deposits_total": sum(d["balance_delta"] for d in deals), "credit": number(account.credit),
                "trade_allowed": bool(account.trade_allowed),
            },
            "symbols": list(ticks.values()), "positions": positions, "pending_orders": orders, "deals": deals,
        }
        print(json.dumps(payload, separators=(",", ":"), default=str))
        return 0
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
