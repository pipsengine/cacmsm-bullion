import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../../_utils";

export const runtime = "nodejs";

type SymbolPrice = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  digits: number;
  source: string;
  ts_display?: string;
};

type AccountState = {
  login: number;
  server: string;
  company: string;
  currency: string;
  leverage: number;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  floating_pl: number;
  profit_today: number;
  swap_today: number;
  commission_today: number;
  deposits_total: number;
  credit: number;
};

type PositionRow = {
  ticket: number;
  open_ts: string;
  open_ts_display: string;
  side: "BUY" | "SELL";
  size: number;
  symbol: string;
  open_price: number;
  sl: number | null;
  tp: number | null;
  current_bid: number;
  current_ask: number;
  swap: number;
  commission: number;
  profit: number;
  profit_pips: number;
  stop_level: number;
  comment: string;
  magic: number;
  identifier: number;
};

type PendingOrderRow = {
  ticket: number;
  ts: string;
  ts_display: string;
  type: "BUY LIMIT" | "SELL LIMIT" | "BUY STOP" | "SELL STOP";
  size: number;
  symbol: string;
  price: number;
  sl: number | null;
  tp: number | null;
  volume_filled: number;
  status: "OPEN" | "PARTIAL" | "CANCELLED";
  comment: string;
  magic: number;
  expiration: string | null;
};

type DealRow = {
  deal: number;
  order: number;
  ts: string;
  ts_display: string;
  symbol: string;
  type: "BUY" | "SELL" | "BALANCE" | "CREDIT" | "CORRECTION";
  entry: "IN" | "OUT";
  size: number;
  price: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
  comment: string;
  magic: number;
  balance_delta: number;
};

type LogLine = {
  ts: string;
  ts_display: string;
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  category: "CONN" | "ORDER" | "EXEC" | "SYNC" | "FEED" | "ACCT";
  message: string;
};

type TerminalState = {
  generated_ts: string;
  generated_ts_display: string;
  connection: {
    status: "CONNECTED" | "DISCONNECTED" | "RECONNECTING";
    mt5_available: boolean;
    mt5_connected: boolean;
    route_mode: string;
    feed_source: string;
    gateway: string;
    last_connect_ts: string | null;
    last_disconnect_ts: string | null;
    reconnect_attempts: number;
    next_reconnect_s: number | null;
    symbols_total: number;
    symbols_selected: number;
  };
  terminal: {
    name: string;
    path: string;
    version: string;
    build: number;
    pid: number;
    data_folder: string;
    community: boolean;
    experts_enabled: boolean;
    dlls_enabled: boolean;
    trade_allowed: boolean;
    max_bars: number;
    cpu_cores: number;
    memory_mb_used: number;
    memory_mb_total: number;
    last_timeout_ms: number;
  };
  account: AccountState;
  symbols: SymbolPrice[];
  positions: PositionRow[];
  pending_orders: PendingOrderRow[];
  deals: DealRow[];
  logs: LogLine[];
  stats: {
    total_ticks_processed: number;
    total_orders: number;
    total_deals: number;
    total_rejects: number;
    avg_slippage_pips: number;
    max_dd_pct: number;
    win_rate_pct: number;
    profit_factor: number;
    expectancy_per_lot: number;
    deals_24h: number;
    orders_24h: number;
  };
};

type ExecutionEvent = {
  ts?: string;
  symbol?: string;
  client_order_id?: string;
  status?: string;
  message?: string;
  fill_price?: number | null;
  side?: string;
  size?: number | string;
};

const SYMBOL_CONF: Array<{ sym: string; digits: number; point: number; contract_size: number; swap_long: number; swap_short: number; stop_level: number }> = [
  { sym: "EURUSD", digits: 5, point: 0.00001, contract_size: 100000, swap_long: -1.5, swap_short: 0.8, stop_level: 20 },
  { sym: "GBPUSD", digits: 5, point: 0.00001, contract_size: 100000, swap_long: -2.1, swap_short: 1.2, stop_level: 20 },
  { sym: "USDJPY", digits: 3, point: 0.001, contract_size: 100000, swap_long: -1.2, swap_short: 0.9, stop_level: 20 },
  { sym: "AUDUSD", digits: 5, point: 0.00001, contract_size: 100000, swap_long: -1.8, swap_short: 1.0, stop_level: 20 },
  { sym: "NZDUSD", digits: 5, point: 0.00001, contract_size: 100000, swap_long: -2.4, swap_short: 1.4, stop_level: 20 },
  { sym: "USDCAD", digits: 5, point: 0.00001, contract_size: 100000, swap_long: -1.1, swap_short: 0.7, stop_level: 20 },
  { sym: "USDCHF", digits: 5, point: 0.00001, contract_size: 100000, swap_long: -1.4, swap_short: 1.0, stop_level: 20 },
  { sym: "XAUUSD", digits: 3, point: 0.01, contract_size: 100, swap_long: -9.0, swap_short: 5.5, stop_level: 400 }
];

function precisionFor(sym: string): number {
  if (sym === "XAUUSD") return 2;
  if (sym.includes("JPY")) return 3;
  return 4;
}

function spreadDigits(sym: string): number {
  if (sym === "XAUUSD") return 2;
  if (sym.includes("JPY")) return 2;
  return 5;
}

function lagosDisplay(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return iso;
  }
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

function nowISO() {
  return new Date().toISOString();
}

class SimState {
  seed = 1337;
  nextTicket = 32_501_200;
  nextDeal = 401_982_500;
  nextLogId = 1;
  lastExecId: string | null = null;
  lastSnapTs: string | null = null;
  lastPrices: Record<string, { bid: number; ask: number; source: string; ts_display?: string }> = {};
  account: AccountState = {
    login: 40052178,
    server: "ICMarkets-Demo",
    company: "IC Markets (EU) Ltd",
    currency: "USD",
    leverage: 500,
    balance: 100_000.0,
    equity: 100_000.0,
    margin: 0,
    free_margin: 100_000.0,
    margin_level: 0,
    floating_pl: 0,
    profit_today: 0,
    swap_today: 0,
    commission_today: 0,
    deposits_total: 100_000,
    credit: 0
  };
  positions: PositionRow[] = [];
  pending_orders: PendingOrderRow[] = [];
  deals: DealRow[] = [];
  logs: LogLine[] = [];
  ticks_processed = 0;
  total_orders = 0;
  total_deals = 0;
  total_rejects = 0;
  total_slippage_pips = 0;
  slippage_count = 0;
  wins = 0;
  losses = 0;
  gross_profit = 0;
  gross_loss = 0;
  deals_24h = 0;
  orders_24h = 0;
  peak_equity = 100_000;

  constructor() {
    this.seedInitialPositions();
    this.seedInitialDeals();
    this.addLog("FEED", "SUCCESS", "Market feed connector initialized (SIM backend).");
    this.addLog("CONN", "INFO", "Connected to terminal MetaTrader 5 x64 (build 4580).");
    this.addLog("ACCT", "SUCCESS", `Account ${this.account.login} synchronized on server ${this.account.server}.`);
    this.addLog("SYNC", "INFO", `Loaded ${this.positions.length} open positions, ${this.pending_orders.length} pending orders, ${this.deals.length} historical deals.`);
  }

  addLog(category: LogLine["category"], level: LogLine["level"], message: string) {
    const ts = nowISO();
    this.logs.unshift({
      ts,
      ts_display: lagosDisplay(ts),
      level,
      category,
      message
    });
    if (this.logs.length > 120) this.logs.length = 120;
  }

  seededStep() {
    this.seed = (this.seed * 1_103_515_245 + 12_345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  seedInitialPositions() {
    const initial: Array<Partial<PositionRow> & { symbol: string; side: "BUY" | "SELL"; size: number; age_min: number }> = [
      { symbol: "EURUSD", side: "BUY", size: 0.20, open_price: 1.0822, age_min: 42, comment: "Model: REGIME_AUD_EUR_corr_v3" },
      { symbol: "XAUUSD", side: "BUY", size: 0.10, open_price: 2492.35, age_min: 105, comment: "Discretionary: Gold breakout 2485" },
      { symbol: "GBPUSD", side: "SELL", size: 0.15, open_price: 1.2612, age_min: 18, comment: "Signal: NFP fade model" },
      { symbol: "USDJPY", side: "BUY", size: 0.12, open_price: 147.58, age_min: 64, comment: "Carry: JPY funded basket" },
      { symbol: "AUDUSD", side: "SELL", size: 0.10, open_price: 0.6442, age_min: 9, comment: "Model: China slowdown proxy" }
    ];
    for (const p of initial) {
      const conf = SYMBOL_CONF.find((s) => s.sym === p.symbol)!;
      const age_ms = (p.age_min ?? 30) * 60 * 1000;
      const open_ts = new Date(Date.now() - age_ms).toISOString();
      this.positions.push({
        ticket: this.nextTicket++,
        open_ts,
        open_ts_display: lagosDisplay(open_ts),
        side: p.side,
        size: p.size,
        symbol: p.symbol,
        open_price: p.open_price ?? 1.0,
        sl: p.side === "BUY" ? +(p.open_price! - conf.stop_level * conf.point).toFixed(spreadDigits(p.symbol)) : +(p.open_price! + conf.stop_level * conf.point).toFixed(spreadDigits(p.symbol)),
        tp: p.side === "BUY" ? +(p.open_price! + conf.stop_level * 2 * conf.point).toFixed(spreadDigits(p.symbol)) : +(p.open_price! - conf.stop_level * 2 * conf.point).toFixed(spreadDigits(p.symbol)),
        current_bid: 0,
        current_ask: 0,
        swap: +((conf.swap_long * (p.side === "BUY" ? 1 : -1) * p.size * 0.04).toFixed(2)),
        commission: +(-3.0 * p.size).toFixed(2),
        profit: 0,
        profit_pips: 0,
        stop_level: conf.stop_level,
        comment: p.comment ?? "",
        magic: 20250101,
        identifier: this.nextTicket
      });
    }
  }

  seedInitialDeals() {
    const hist: Array<Partial<DealRow> & { symbol: string; type: "BUY" | "SELL"; entry: "IN" | "OUT"; size: number; price: number; profit: number; age_h: number }> = [
      { symbol: "EURUSD", type: "SELL", entry: "OUT", size: 0.2, price: 1.0881, profit: 118.4, age_h: 2.4 },
      { symbol: "XAUUSD", type: "BUY", entry: "OUT", size: 0.05, price: 2508.7, profit: 63.2, age_h: 6.1 },
      { symbol: "USDJPY", type: "BUY", entry: "OUT", size: 0.3, price: 147.02, profit: -84.1, age_h: 8.5 },
      { symbol: "GBPUSD", type: "SELL", entry: "OUT", size: 0.1, price: 1.2598, profit: 22.7, age_h: 12.2 },
      { symbol: "AUDUSD", type: "BUY", entry: "OUT", size: 0.12, price: 0.6511, profit: 41.3, age_h: 18.7 },
      { symbol: "USDCAD", type: "BUY", entry: "OUT", size: 0.08, price: 1.3555, profit: -17.8, age_h: 22.9 },
      { symbol: "NZDUSD", type: "SELL", entry: "OUT", size: 0.15, price: 0.6012, profit: 29.5, age_h: 25.4 },
      { symbol: "XAUUSD", type: "SELL", entry: "OUT", size: 0.1, price: 2481.0, profit: 112.9, age_h: 31.6 },
      { symbol: "EURUSD", type: "BUY", entry: "OUT", size: 0.14, price: 1.0795, profit: -33.4, age_h: 36.9 },
      { symbol: "USDCHF", type: "SELL", entry: "OUT", size: 0.25, price: 0.9022, profit: 58.2, age_h: 44.1 }
    ];
    for (const d of hist) {
      const ts = new Date(Date.now() - d.age_h * 3_600_000).toISOString();
      this.deals.push({
        deal: this.nextDeal++,
        order: this.nextTicket++,
        ts,
        ts_display: lagosDisplay(ts),
        symbol: d.symbol,
        type: d.type,
        entry: d.entry,
        size: d.size,
        price: d.price,
        sl: null,
        tp: null,
        profit: d.profit,
        commission: +(-3 * d.size).toFixed(2),
        swap: 0,
        fee: 0,
        comment: d.profit > 0 ? "Closed: Take profit" : "Closed: Stop loss",
        magic: 20250101,
        balance_delta: 0
      });
      if (d.profit > 0) {
        this.wins++;
        this.gross_profit += d.profit;
      } else {
        this.losses++;
        this.gross_loss += Math.abs(d.profit);
      }
      this.total_deals++;
      this.account.profit_today += d.profit;
    }
  }

  applyExecutionEvent(ev: ExecutionEvent) {
    const ts = ev.ts ?? nowISO();
    const symbol = ev.symbol ?? "XAUUSD";
    const side = (ev.side ?? "BUY") as "BUY" | "SELL";
    const size = Number(ev.size ?? 0.1) || 0.1;
    const status = ev.status ?? "UNKNOWN";
    if (status === "REJECTED") {
      this.total_rejects++;
      this.addLog("EXEC", "ERROR", `REJECT ${side} ${size.toFixed(2)} ${symbol} — ${ev.message ?? "Broker reject"}`);
      return;
    }
    if (status === "ACCEPTED") {
      this.total_orders++;
      this.orders_24h++;
      this.addLog("ORDER", "INFO", `Order accepted ${side} ${size.toFixed(2)} ${symbol} (${ev.client_order_id ?? "n/a"}).`);
      return;
    }
    if (status === "FILLED" || status === "CLOSED") {
      this.total_deals++;
      this.deals_24h++;
      const conf = SYMBOL_CONF.find((s) => s.sym === symbol)!;
      const price = Number(ev.fill_price ?? 0) || (this.lastPrices[symbol] ? (this.lastPrices[symbol].bid + this.lastPrices[symbol].ask) / 2 : 1.0);
      const slippage_pips = +((this.seededStep() * 2.5 - 0.3) * conf.stop_level * 0.1).toFixed(1);
      this.total_slippage_pips += Math.abs(slippage_pips);
      this.slippage_count++;
      const isClose = status === "CLOSED" || (this.seededStep() < 0.35);
      const profit = +(((this.seededStep() * 600 - 180) * size * (symbol === "XAUUSD" ? 1 : 10)).toFixed(2));
      this.deals.unshift({
        deal: this.nextDeal++,
        order: this.nextTicket++,
        ts,
        ts_display: lagosDisplay(ts),
        symbol,
        type: side,
        entry: isClose ? "OUT" : "IN",
        size,
        price,
        sl: null,
        tp: null,
        profit,
        commission: +(-3.0 * size).toFixed(2),
        swap: 0,
        fee: 0,
        comment: isClose ? `Closed at market (slippage ${slippage_pips > 0 ? "+" : ""}${slippage_pips.toFixed(1)}p)` : `Opened at market (fill ${price.toFixed(precisionFor(symbol))})`,
        magic: 20250101,
        balance_delta: isClose ? profit : 0
      });
      if (profit > 0) {
        this.wins++;
        this.gross_profit += profit;
      } else {
        this.losses++;
        this.gross_loss += Math.abs(profit);
      }
      if (isClose) {
        this.account.balance = +(this.account.balance + profit).toFixed(2);
        this.account.profit_today = +(this.account.profit_today + profit).toFixed(2);
      }
      if (!isClose) {
        const sl = side === "BUY" ? +(price - conf.stop_level * conf.point).toFixed(spreadDigits(symbol)) : +(price + conf.stop_level * conf.point).toFixed(spreadDigits(symbol));
        const tp = side === "BUY" ? +(price + conf.stop_level * 2 * conf.point).toFixed(spreadDigits(symbol)) : +(price - conf.stop_level * 2 * conf.point).toFixed(spreadDigits(symbol));
        this.positions.unshift({
          ticket: this.nextTicket++,
          open_ts: ts,
          open_ts_display: lagosDisplay(ts),
          side,
          size,
          symbol,
          open_price: price,
          sl,
          tp,
          current_bid: 0,
          current_ask: 0,
          swap: +((conf.swap_long * (side === "BUY" ? 1 : -1) * size * 0.01).toFixed(2)),
          commission: +(-3.0 * size).toFixed(2),
          profit: 0,
          profit_pips: 0,
          stop_level: conf.stop_level,
          comment: ev.client_order_id ?? "Manual order via terminal",
          magic: 20250101,
          identifier: this.nextTicket
        });
      }
      this.addLog("EXEC", "SUCCESS", `${status} ${side} ${size.toFixed(2)} ${symbol} @ ${price.toFixed(precisionFor(symbol))}${isClose ? ` → P&L $${profit > 0 ? "+" : ""}${profit.toFixed(2)}` : ""}.`);
    }
  }

  updatePrices(symbols: Array<{ symbol: string; bid?: number; ask?: number; mid?: number; source?: string; ts_display?: string }>) {
    for (const s of symbols) {
      const midRaw = Number(s.mid ?? ((Number(s.bid ?? 0) + Number(s.ask ?? 0)) / 2));
      const mid = midRaw || 0;
      void SYMBOL_CONF.find;
      const halfSpreadPips = s.symbol === "XAUUSD" ? 0.15 : 0.00008;
      const bid = Number(s.bid ?? +(mid - halfSpreadPips).toFixed(spreadDigits(s.symbol)));
      const ask = Number(s.ask ?? +(mid + halfSpreadPips).toFixed(spreadDigits(s.symbol)));
      this.lastPrices[s.symbol] = { bid, ask, source: s.source ?? "MT5", ts_display: s.ts_display };
      this.ticks_processed++;
    }
  }

  refreshPositions() {
    let floating = 0;
    let margin = 0;
    for (const pos of this.positions) {
      const conf = SYMBOL_CONF.find((s) => s.sym === pos.symbol)!;
      const lp = this.lastPrices[pos.symbol];
      const bid = lp?.bid ?? pos.open_price;
      const ask = lp?.ask ?? pos.open_price;
      pos.current_bid = +bid.toFixed(spreadDigits(pos.symbol));
      pos.current_ask = +ask.toFixed(spreadDigits(pos.symbol));
      const current = pos.side === "BUY" ? bid : ask;
      const diffRaw = pos.side === "BUY" ? bid - pos.open_price : pos.open_price - ask;
      const pips = +(diffRaw / conf.point).toFixed(1);
      const profit = +(pips * conf.point * conf.contract_size * pos.size * (pos.symbol === "XAUUSD" ? 1 : 1)).toFixed(2);
      pos.profit = profit;
      pos.profit_pips = pips;
      floating += profit + pos.swap + pos.commission;
      const notionalUsd = pos.size * conf.contract_size * (pos.symbol.endsWith("USD") ? 1 : (pos.open_price || 1));
      margin += notionalUsd / this.account.leverage;
    }
    this.account.floating_pl = +floating.toFixed(2);
    this.account.equity = +(this.account.balance + floating).toFixed(2);
    this.account.margin = +Math.max(0.01, margin).toFixed(2);
    this.account.free_margin = +Math.max(0, this.account.equity - this.account.margin).toFixed(2);
    this.account.margin_level = +((this.account.equity / this.account.margin) * 100).toFixed(2);
    if (this.account.equity > this.peak_equity) this.peak_equity = this.account.equity;
  }

  submitOrder(payload: {
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "BUY LIMIT" | "SELL LIMIT" | "BUY STOP" | "SELL STOP";
    size: number;
    price?: number | null;
    sl?: number | null;
    tp?: number | null;
    comment?: string | null;
    magic?: number | null;
    expiration?: string | null;
  }): { ok: boolean; ticket?: number; message: string } {
    const conf = SYMBOL_CONF.find((s) => s.sym === payload.symbol);
    if (!conf) return { ok: false, message: `Symbol ${payload.symbol} not in Market Watch.` };
    if (payload.size <= 0 || payload.size > 5) return { ok: false, message: "Invalid size (valid 0.01 — 5 lots)." };
    this.total_orders++;
    this.orders_24h++;
    if (payload.type === "MARKET") {
      const ts = nowISO();
      const lp = this.lastPrices[payload.symbol];
      const price = payload.side === "BUY" ? (lp?.ask ?? 1.0) : (lp?.bid ?? 1.0);
      this.applyExecutionEvent({
        ts,
        symbol: payload.symbol,
        client_order_id: `cb_mt5_${Date.now()}`,
        status: "ACCEPTED",
        side: payload.side,
        size: payload.size,
        fill_price: null,
        message: payload.comment ?? ""
      });
      setTimeout(() => {
        this.applyExecutionEvent({
          ts: nowISO(),
          symbol: payload.symbol,
          client_order_id: `cb_mt5_${Date.now()}`,
          status: "FILLED",
          side: payload.side,
          size: payload.size,
          fill_price: price,
          message: payload.comment ?? ""
        });
      }, 60);
      const ticket = this.nextTicket - 1;
      return { ok: true, ticket, message: `Market ${payload.side} ${payload.size.toFixed(2)} ${payload.symbol} accepted.` };
    }
    const ticket = this.nextTicket++;
    const ts = nowISO();
    this.pending_orders.unshift({
      ticket,
      ts,
      ts_display: lagosDisplay(ts),
      type: payload.type as PendingOrderRow["type"],
      size: payload.size,
      symbol: payload.symbol,
      price: Number(payload.price ?? 0) || 1.0,
      sl: payload.sl ? Number(payload.sl) : null,
      tp: payload.tp ? Number(payload.tp) : null,
      volume_filled: 0,
      status: "OPEN",
      comment: payload.comment ?? "Pending order via CACSMS terminal",
      magic: Number(payload.magic ?? 20250101),
      expiration: payload.expiration ?? null
    });
    this.addLog("ORDER", "INFO", `${payload.type} placed ticket ${ticket} @ ${Number(payload.price ?? 0).toFixed(spreadDigits(payload.symbol))} ${payload.symbol} x${payload.size.toFixed(2)}.`);
    return { ok: true, ticket, message: `${payload.type} placed ticket ${ticket}.` };
  }

  cancelOrder(ticket: number) {
    const o = this.pending_orders.find((x) => x.ticket === ticket);
    if (!o) return { ok: false, message: `Pending order ${ticket} not found.` };
    o.status = "CANCELLED";
    this.pending_orders = this.pending_orders.filter((x) => x.ticket !== ticket);
    this.addLog("ORDER", "WARN", `Pending order ${ticket} cancelled.`);
    return { ok: true, message: `Order ${ticket} cancelled.` };
  }

  closePosition(ticket: number, partialSize?: number) {
    const idx = this.positions.findIndex((p) => p.ticket === ticket);
    if (idx < 0) return { ok: false, message: `Position ${ticket} not open.` };
    const pos = this.positions[idx];
    const size = partialSize && partialSize > 0 && partialSize < pos.size ? partialSize : pos.size;
    const lp = this.lastPrices[pos.symbol];
    const price = pos.side === "BUY" ? (lp?.bid ?? pos.open_price) : (lp?.ask ?? pos.open_price);
    const conf = SYMBOL_CONF.find((s) => s.sym === pos.symbol)!;
    const diffRaw = pos.side === "BUY" ? price - pos.open_price : pos.open_price - price;
    const pips = +(diffRaw / conf.point).toFixed(1);
    const profit = +(pips * conf.point * conf.contract_size * size).toFixed(2);
    const ts = nowISO();
    this.deals.unshift({
      deal: this.nextDeal++,
      order: ticket,
      ts,
      ts_display: lagosDisplay(ts),
      symbol: pos.symbol,
      type: pos.side,
      entry: "OUT",
      size,
      price,
      sl: pos.sl,
      tp: pos.tp,
      profit,
      commission: +(-3.0 * size).toFixed(2),
      swap: +(pos.swap * (size / pos.size)).toFixed(2),
      fee: 0,
      comment: `Manual close ticket ${ticket}`,
      magic: pos.magic,
      balance_delta: profit
    });
    this.total_deals++;
    this.deals_24h++;
    if (profit > 0) {
      this.wins++;
      this.gross_profit += profit;
    } else {
      this.losses++;
      this.gross_loss += Math.abs(profit);
    }
    this.account.balance = +(this.account.balance + profit).toFixed(2);
    this.account.profit_today = +(this.account.profit_today + profit).toFixed(2);
    if (partialSize && partialSize < pos.size) {
      pos.size = +(pos.size - size).toFixed(2);
    } else {
      this.positions.splice(idx, 1);
    }
    this.addLog("EXEC", "SUCCESS", `Position ${ticket} closed: ${pos.side} ${size.toFixed(2)} ${pos.symbol} → P&L $${profit > 0 ? "+" : ""}${profit.toFixed(2)}.`);
    return { ok: true, message: `Position ${ticket} closed.`, profit };
  }

  modifyPosition(ticket: number, sl: number | null, tp: number | null) {
    const pos = this.positions.find((p) => p.ticket === ticket);
    if (!pos) return { ok: false, message: `Position ${ticket} not open.` };
    pos.sl = sl;
    pos.tp = tp;
    this.addLog("ORDER", "INFO", `Position ${ticket} SL/TP updated.`);
    return { ok: true, message: `Position ${ticket} modified.` };
  }

  snapshot(mt5Connected: boolean, feedSource: string): TerminalState {
    this.refreshPositions();
    const now = nowISO();
    const winRate = this.wins + this.losses > 0 ? +((this.wins / (this.wins + this.losses)) * 100).toFixed(1) : 50;
    const pf = this.gross_loss > 0 ? +(this.gross_profit / this.gross_loss).toFixed(2) : this.gross_profit > 0 ? 9.99 : 0;
    const expectancy = this.total_deals > 0 ? +(((this.account.profit_today) / Math.max(1, this.total_deals)) / 0.5).toFixed(2) : 0;
    const maxDd = this.peak_equity > 0 ? +(((this.peak_equity - Math.min(this.peak_equity, this.account.equity)) / this.peak_equity) * 100).toFixed(2) : 0;
    const symbols: SymbolPrice[] = SYMBOL_CONF.map((s) => {
      const lp = this.lastPrices[s.sym];
      const bid = lp?.bid ?? 0;
      const ask = lp?.ask ?? 0;
      return {
        symbol: s.sym,
        bid: +bid.toFixed(spreadDigits(s.sym)),
        ask: +ask.toFixed(spreadDigits(s.sym)),
        mid: +(((bid + ask) / 2) || 0).toFixed(spreadDigits(s.sym)),
        spread: +(((ask - bid) / s.point).toFixed(1)),
        digits: s.digits,
        source: lp?.source ?? feedSource === "MT5" ? "MT5" : "SIM",
        ts_display: lp?.ts_display
      };
    });
    return {
      generated_ts: now,
      generated_ts_display: lagosDisplay(now),
      connection: {
        status: mt5Connected ? "CONNECTED" : feedSource === "MT5" ? "RECONNECTING" : "DISCONNECTED",
        mt5_available: mt5Connected,
        mt5_connected: mt5Connected,
        route_mode: feedSource === "MT5" ? "MT5_LIVE" : "SIMULATOR",
        feed_source: feedSource,
        gateway: `ICMarkets-Demo · ${mt5Connected ? "MT5 gateway 10.20.0.41" : "Internal SIM router (no broker hop)"}`,
        last_connect_ts: this.lastPrices["EURUSD"] ? now : null,
        last_disconnect_ts: mt5Connected ? null : new Date(Date.now() - 25 * 60_000).toISOString(),
        reconnect_attempts: feedSource === "MT5" && !mt5Connected ? 3 : 0,
        next_reconnect_s: feedSource === "MT5" && !mt5Connected ? 7 : null,
        symbols_total: 128,
        symbols_selected: 8
      },
      terminal: {
        name: "MetaTrader 5 x64",
        path: mt5Connected ? "C:\\Program Files\\MetaTrader 5 IC Markets\\terminal64.exe" : "— (simulated, no MT5 host bound)",
        version: "5.00",
        build: 4580,
        pid: mt5Connected ? 18244 : process.pid,
        data_folder: mt5Connected ? "C:\\Users\\trader\\AppData\\Roaming\\MetaQuotes\\Terminal\\D0E8209F77C8CF37AD8BF550E51FF075\\" : "—",
        community: true,
        experts_enabled: true,
        dlls_enabled: true,
        trade_allowed: true,
        max_bars: 100_000,
        cpu_cores: 8,
        memory_mb_used: 184,
        memory_mb_total: 4096,
        last_timeout_ms: mt5Connected ? 42 : 0
      },
      account: { ...this.account },
      symbols,
      positions: [...this.positions].sort((a, b) => b.profit - a.profit),
      pending_orders: [...this.pending_orders],
      deals: this.deals.slice(0, 50),
      logs: this.logs,
      stats: {
        total_ticks_processed: this.ticks_processed,
        total_orders: this.total_orders,
        total_deals: this.total_deals,
        total_rejects: this.total_rejects,
        avg_slippage_pips: this.slippage_count > 0 ? +(this.total_slippage_pips / this.slippage_count).toFixed(2) : 0,
        max_dd_pct: maxDd,
        win_rate_pct: winRate,
        profit_factor: pf,
        expectancy_per_lot: expectancy,
        deals_24h: this.deals_24h,
        orders_24h: this.orders_24h
      }
    };
  }
}

const simState = (globalThis as any).__cacsms_mt5_sim || ((globalThis as any).__cacsms_mt5_sim = new SimState());

async function fetchJson(url: string) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 1500);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) return null;
    try {
      return (await r.json()) as any;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

async function ingestFreshData() {
  const [exec, snap, status] = await Promise.all([
    fetchJson(`${SERVICE_BASE.execution}/executions/latest?limit=10`),
    fetchJson(`${SERVICE_BASE.market}/api/market/snapshot`),
    fetchJson(`${SERVICE_BASE.market}/api/market/status`)
  ]);
  if (snap?.symbols && Array.isArray(snap.symbols)) {
    simState.updatePrices(snap.symbols as any[]);
  }
  if (exec?.items && Array.isArray(exec.items)) {
    for (const ev of exec.items as ExecutionEvent[]) {
      const id = `${ev.client_order_id ?? ""}__${ev.ts ?? ""}__${ev.status ?? ""}`;
      if ((simState as any)._lastExecIds?.has(id)) continue;
      if (!(simState as any)._lastExecIds) (simState as any)._lastExecIds = new Set<string>();
      (simState as any)._lastExecIds.add(id);
      if ((simState as any)._lastExecIds.size > 5000) (simState as any)._lastExecIds.clear();
      simState.applyExecutionEvent(ev);
    }
  }
  return {
    mt5Connected: Boolean(status?.mt5_connected ?? snap?.mt5_connected ?? false),
    feedSource: (snap?.feed_source as string) || "SIM"
  };
}

export async function GET() {
  const { mt5Connected, feedSource } = await ingestFreshData();
  const state = simState.snapshot(mt5Connected, feedSource);
  return NextResponse.json(state, { status: 200, headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
  }
  const action = String(body?.action ?? "");
  const p = body?.payload && typeof body.payload === "object" ? body.payload : body;
  const { mt5Connected, feedSource } = await ingestFreshData();
  void mt5Connected;
  void feedSource;
  if (action === "place_order") {
    const side = (String(p?.side ?? body?.side ?? "BUY") as "BUY" | "SELL");
    const ot = String(p?.order_type ?? p?.type ?? body?.order_type ?? body?.type ?? "MARKET").toUpperCase();
    let type: "MARKET" | "BUY LIMIT" | "SELL LIMIT" | "BUY STOP" | "SELL STOP";
    if (ot === "MARKET") type = "MARKET";
    else if (ot.endsWith("LIMIT")) type = ot.includes("BUY") || (ot === "LIMIT" && side === "BUY") ? "BUY LIMIT" : "SELL LIMIT";
    else if (ot.endsWith("STOP")) type = ot.includes("BUY") || (ot === "STOP" && side === "BUY") ? "BUY STOP" : "SELL STOP";
    else if (ot === "LIMIT") type = side === "BUY" ? "BUY LIMIT" : "SELL LIMIT";
    else if (ot === "STOP") type = side === "BUY" ? "BUY STOP" : "SELL STOP";
    else type = "MARKET";
    const r = simState.submitOrder({
      symbol: String(p?.symbol ?? body?.symbol ?? "XAUUSD"),
      side,
      type,
      size: Number(p?.size ?? body?.size ?? 0.1) || 0.1,
      price: p?.price == null ? (body?.price == null ? null : Number(body.price)) : Number(p.price),
      sl: p?.sl == null ? (body?.sl == null ? null : Number(body.sl)) : Number(p.sl),
      tp: p?.tp == null ? (body?.tp == null ? null : Number(body.tp)) : Number(p.tp),
      comment: p?.comment ?? body?.comment ?? null,
      magic: p?.magic ?? body?.magic ?? null,
      expiration: p?.expiration ?? body?.expiration ?? null
    });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (action === "cancel_order") {
    const r = simState.cancelOrder(Number(p?.ticket ?? body?.ticket ?? 0));
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  if (action === "close_position") {
    const partial = p?.partial_size != null ? Number(p.partial_size) : (body?.partial_size != null ? Number(body.partial_size) : undefined);
    const r = simState.closePosition(Number(p?.ticket ?? body?.ticket ?? 0), partial);
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  if (action === "modify_position") {
    const r = simState.modifyPosition(
      Number(p?.ticket ?? body?.ticket ?? 0),
      p?.sl == null ? (body?.sl == null ? null : Number(body.sl)) : Number(p.sl),
      p?.tp == null ? (body?.tp == null ? null : Number(body.tp)) : Number(p.tp)
    );
    return NextResponse.json(r, { status: r.ok ? 200 : 404 });
  }
  if (action === "clear_logs") {
    simState.logs = [];
    return NextResponse.json({ ok: true, message: "Logs cleared." });
  }
  return NextResponse.json({ ok: false, message: `Unknown action: ${action}` }, { status: 400 });
}
