"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const WATCH_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "XAUUSD"] as const;
type WatchSym = (typeof WATCH_SYMBOLS)[number];

function pricePrecision(sym: string): number {
  if (sym === "XAUUSD") return 2;
  if (sym.includes("JPY")) return 3;
  return 4;
}

function fmtNum(v: number, digits = 2, signed = false): string {
  if (!Number.isFinite(v)) v = 0;
  return (signed && v > 0 ? "+" : "") + v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtCompact(v: number): string {
  if (!Number.isFinite(v)) v = 0;
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return String(Math.round(v));
}

function logLevelClass(l: LogLine["level"]) {
  if (l === "SUCCESS") return "t5LogOk";
  if (l === "WARN") return "t5LogWarn";
  if (l === "ERROR") return "t5LogErr";
  return "t5LogInfo";
}

const STYLES = `
  .t5Page{ color:#ecf3ff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; width:min(1720px, 100%); margin:0 auto 48px; }
  .t5Hero{ display:grid; grid-template-columns: 1fr auto; gap:18px; align-items:flex-end; margin-bottom:16px; }
  .t5Hero h1{ margin:0; font-size:clamp(1.4rem, 2vw, 2rem); letter-spacing:0.04em; }
  .t5Hero p{ margin:6px 0 0; color:#91a5c9; line-height:1.45; font-size:0.94rem; }
  .t5Toolbar{ display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
  .t5Chip, .t5ChipErr, .t5ChipOk, .t5ChipWarn{ display:inline-flex; align-items:center; gap:8px; border-radius:999px; border:1px solid #32456a; background:rgba(17,28,47,0.92); color:#ecf3ff; padding:9px 14px; font-weight:600; font-size:0.88rem; }
  .t5ChipOk{ border-color:#2a7a48; }
  .t5ChipWarn{ border-color:#a87a1a; }
  .t5ChipErr{ border-color:#a22; }
  .t5Dot{ width:10px; height:10px; border-radius:50%; background:#f5c24a; box-shadow:0 0 10px rgba(245,194,74,0.9); }
  .t5DotOk{ background:#48d976; box-shadow:0 0 10px rgba(72,217,118,0.9); }
  .t5DotErr{ background:#ef5350; box-shadow:0 0 10px rgba(239,83,80,0.9); }
  .t5Banner{ padding:11px 16px; border-radius:12px; margin-bottom:14px; border:1px solid #a87a1a; background:rgba(210,160,60,0.10); color:#ffd88a; font-size:0.9rem; display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap; }
  .t5BannerErr{ border-color:#a22; background:rgba(220,70,70,0.10); color:#ff9e9e; }
  .t5BannerOk{ border-color:#2a7a48; background:rgba(60,180,110,0.08); color:#b5f5c9; }
  .t5Kpis{ display:grid; grid-template-columns: repeat(8, 1fr); gap:10px; }
  .t5Kpi{ border-radius:14px; padding:12px 14px; border:1px solid rgba(255,255,255,0.06); background:linear-gradient(180deg, rgba(26,41,66,0.86), rgba(12,22,39,0.92)); }
  .t5Kpi > label{ display:block; font-size:0.74rem; color:#91a5c9; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; }
  .t5Kpi > strong{ display:block; margin-top:6px; font-size:1.2rem; font-variant-numeric:tabular-nums; }
  .t5Kpi > span{ display:block; margin-top:4px; color:#91a5c9; font-size:0.78rem; }
  .t5GridTop{ display:grid; grid-template-columns: 1.15fr 1fr 1.05fr; gap:14px; margin-top:14px; }
  .t5GridMid{ display:grid; grid-template-columns: 1.55fr 1fr; gap:14px; margin-top:14px; }
  .t5GridBot{ display:grid; grid-template-columns: 1.45fr 1fr; gap:14px; margin-top:14px; }
  .t5Panel{ background:linear-gradient(180deg, rgba(26,41,66,0.92), rgba(12,22,39,0.96)); border:1px solid #32456a; border-radius:18px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.24); }
  .t5PanelHead{ display:flex; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid #32456a; background:rgba(255,255,255,0.025); align-items:center; flex-wrap:wrap; }
  .t5PanelHead h2{ margin:0; font-size:0.92rem; letter-spacing:0.05em; }
  .t5PanelHead span{ color:#91a5c9; font-size:0.84rem; font-variant-numeric:tabular-nums; }
  .t5Body{ padding:12px 14px; }
  .t5Kv{ display:grid; grid-template-columns: 150px 1fr; gap:6px 12px; font-size:0.86rem; }
  .t5Kv dt{ color:#91a5c9; font-weight:700; letter-spacing:0.04em; }
  .t5Kv dd{ margin:0; color:#ecf3ff; font-variant-numeric:tabular-nums; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .t5Watch{ display:grid; gap:4px; }
  .t5WatchHead{ display:grid; grid-template-columns: 1.1fr 1fr 1fr 0.7fr 0.65fr; color:#10203e; background:#d9e7f0; border-radius:10px; padding:9px 12px; font-weight:800; font-size:0.76rem; letter-spacing:0.06em; text-transform:uppercase; gap:8px; }
  .t5WatchRow{ display:grid; grid-template-columns: 1.1fr 1fr 1fr 0.7fr 0.65fr; align-items:center; padding:9px 12px; border-radius:10px; border:1px solid rgba(255,255,255,0.04); font-size:0.88rem; font-variant-numeric:tabular-nums; gap:8px; cursor:pointer; transition:background 120ms ease, border-color 120ms ease; }
  .t5WatchRow:hover{ background:rgba(255,255,255,0.03); border-color:rgba(103,133,191,0.45); }
  .t5WatchRow.active{ background:rgba(103,133,191,0.14); border-color:rgba(103,133,191,0.65); }
  .t5Sym{ display:flex; align-items:center; gap:8px; font-weight:800; letter-spacing:0.03em; }
  .t5SymBadge{ width:6px; height:22px; border-radius:3px; }
  .t5Ask, .t5Bid{ font-weight:700; }
  .t5Ask{ color:#ff8282; }
  .t5Bid{ color:#65ea8b; }
  .t5Spread{ text-align:right; color:#91a5c9; font-size:0.8rem; }
  .t5Src{ text-align:right; font-size:0.72rem; color:#91a5c9; letter-spacing:0.08em; font-weight:700; }
  .t5Pad{ display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
  .t5Side{ display:flex; gap:6px; padding:4px; border-radius:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); grid-column: 1 / -1; }
  .t5Side button{ flex:1; padding:10px 8px; border-radius:8px; border:none; cursor:pointer; font-weight:900; letter-spacing:0.1em; font-size:0.9rem; transition: transform 100ms ease, box-shadow 120ms ease; }
  .t5BuyBtn{ background:linear-gradient(180deg, #2fa95f, #126433); color:#fff; }
  .t5SellBtn{ background:linear-gradient(180deg, #e05454, #861a1a); color:#fff; }
  .t5Side .t5Inactive{ background:rgba(255,255,255,0.02); color:#91a5c9; font-weight:700; box-shadow:none; }
  .t5Field{ display:grid; gap:5px; }
  .t5Field label{ font-size:0.74rem; color:#91a5c9; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; }
  .t5Field select, .t5Field input{ background:rgba(8,14,28,0.7); border:1px solid #32456a; color:#ecf3ff; padding:9px 10px; border-radius:10px; font-size:0.92rem; font-variant-numeric:tabular-nums; outline:none; }
  .t5Field select:focus, .t5Field input:focus{ border-color:#6785bf; }
  .t5Submit{ grid-column: 1 / -1; padding:12px 14px; border-radius:12px; border:1px solid #2a7a48; background:linear-gradient(180deg, #2a7a48, #174a2a); color:#fff; font-weight:900; letter-spacing:0.08em; cursor:pointer; }
  .t5Submit:disabled{ opacity:0.5; cursor:not-allowed; }
  .t5SubmitErr{ border-color:#861a1a; background:linear-gradient(180deg, #b92a2a, #691212); }
  .t5TableWrap{ overflow:auto; max-height:520px; }
  .t5Table{ width:100%; min-width: 1020px; border-collapse: separate; border-spacing:0; }
  .t5Table thead th{ position:sticky; top:0; z-index:3; background:#d9e7f0; color:#10203e; padding:10px 10px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6; font-size:0.76rem; letter-spacing:0.06em; font-weight:800; text-transform:uppercase; white-space:nowrap; text-align:left; }
  .t5Table thead th:last-child{ text-align:right; }
  .t5Table td{ padding:9px 10px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:0.84rem; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .t5Table td.num{ text-align:right; }
  .t5Table td.act{ text-align:right; }
  .t5Row{ transition: background 120ms ease; }
  .t5Row:hover{ background:rgba(255,255,255,0.025); }
  .t5Row.flash{ background:rgba(117,168,255,0.14); }
  .t5BuyTag, .t5SellTag, .t5TypeTag{ padding:3px 8px; border-radius:6px; font-size:0.72rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; display:inline-block; }
  .t5BuyTag{ background:rgba(47,169,95,0.15); color:#65ea8b; border:1px solid #2fa95f80; }
  .t5SellTag{ background:rgba(224,84,84,0.15); color:#ff8282; border:1px solid #e0545480; }
  .t5TypeTag{ background:rgba(103,133,191,0.16); color:#c9daff; border:1px solid #6785bf60; }
  .t5ProfitUp{ color:#65ea8b; font-weight:700; }
  .t5ProfitDown{ color:#ff8282; font-weight:700; }
  .t5Btn{ background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:#ecf3ff; padding:5px 10px; border-radius:8px; cursor:pointer; font-size:0.78rem; font-weight:700; margin-left:4px; }
  .t5Btn:hover{ border-color:#6785bf; background:rgba(103,133,191,0.12); }
  .t5BtnClose{ border-color:#a22; color:#ff8282; }
  .t5BtnClose:hover{ background:rgba(220,70,70,0.10); }
  .t5LogWrap{ max-height:440px; overflow:auto; padding:10px 12px; font-size:0.80rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .t5LogLine{ display:grid; grid-template-columns: 72px 54px 54px 1fr; gap:8px; padding:4px 2px; border-bottom:1px dashed rgba(255,255,255,0.04); }
  .t5LogInfo{ color:#c7d6ee; }
  .t5LogOk{ color:#65ea8b; }
  .t5LogWarn{ color:#ffd88a; }
  .t5LogErr{ color:#ff8282; }
  .t5LogCat{ font-weight:900; letter-spacing:0.08em; opacity:0.92; }
  .t5Empty{ padding:26px; color:#91a5c9; text-align:center; font-size:0.9rem; }
  .t5Foot{ display:grid; grid-template-columns: repeat(6, 1fr); gap:10px; margin-top:14px; }
  .t5Mini{ border-radius:12px; padding:10px 12px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.025); }
  .t5Mini label{ display:block; color:#91a5c9; font-size:0.7rem; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; }
  .t5Mini strong{ display:block; margin-top:4px; font-size:1rem; font-variant-numeric:tabular-nums; }
  @media (max-width: 1520px){
    .t5Kpis{ grid-template-columns: repeat(4, 1fr); }
    .t5GridTop, .t5GridMid, .t5GridBot{ grid-template-columns: 1fr; }
  }
  @media (max-width: 820px){
    .t5Kpis{ grid-template-columns: repeat(2, 1fr); }
    .t5Foot{ grid-template-columns: repeat(2, 1fr); }
  }
`;

const SYMBOL_BADGE_COLORS: Record<WatchSym, string> = {
  EURUSD: "#2a7a48",
  GBPUSD: "#1e5a9e",
  USDJPY: "#b92929",
  AUDUSD: "#7a5b0c",
  NZDUSD: "#5b2b86",
  USDCAD: "#b2621c",
  USDCHF: "#7c4040",
  XAUUSD: "#c9a227"
};

type OrderSide = "BUY" | "SELL";
type OrderType = "MARKET" | "BUY LIMIT" | "SELL LIMIT" | "BUY STOP" | "SELL STOP";

export default function Mt5TerminalPage() {
  const [state, setState] = useState<TerminalState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [orderSide, setOrderSide] = useState<OrderSide>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [orderSymbol, setOrderSymbol] = useState<string>("XAUUSD");
  const [orderSize, setOrderSize] = useState<number>(0.1);
  const [orderPrice, setOrderPrice] = useState<string>("");
  const [orderSL, setOrderSL] = useState<string>("");
  const [orderTP, setOrderTP] = useState<string>("");
  const [orderComment, setOrderComment] = useState<string>("");
  const [activeWatch, setActiveWatch] = useState<string>("XAUUSD");
  const [newestKey, setNewestKey] = useState<number | null>(null);
  const [dealsSeen, setDealsSeen] = useState<Set<number>>(new Set());
  const [posSeen, setPosSeen] = useState<Set<number>>(new Set());

  const latestDealsRef = useRef<Set<number>>(new Set());
  const latestPosRef = useRef<Set<number>>(new Set());
  const refreshHandleRef = useRef<number | null>(null);

  const fetchTerminal = useCallback(async () => {
    try {
      const res = await fetch("/api/execution/mt5/terminal", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TerminalState;
      setState(data);
      setError(null);
      setLoading(false);
      const dealSet = new Set(data.deals.map((d) => d.deal));
      const posSet = new Set(data.positions.map((p) => p.ticket));
      let newestDeal: number | null = null;
      for (const d of data.deals) {
        if (!latestDealsRef.current.has(d.deal)) {
          newestDeal = d.deal;
          break;
        }
      }
      latestDealsRef.current = dealSet;
      latestPosRef.current = posSet;
      setDealsSeen(dealSet);
      setPosSeen(posSet);
      if (newestDeal != null) {
        setNewestKey(newestDeal);
        if (refreshHandleRef.current) window.clearTimeout(refreshHandleRef.current);
        refreshHandleRef.current = window.setTimeout(() => setNewestKey(null), 900);
      }
    } catch (e: any) {
      setError(e?.message ?? "Terminal endpoint unreachable.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetchTerminal();
    const id = setInterval(() => {
      if (alive) void fetchTerminal();
    }, 750);
    return () => {
      alive = false;
      clearInterval(id);
      if (refreshHandleRef.current) window.clearTimeout(refreshHandleRef.current);
    };
  }, [fetchTerminal]);

  const postAction = useCallback(
    async (action: string, payload: Record<string, any> = {}): Promise<{ ok: boolean; message: string; ticket?: number; profit?: number }> => {
      setBusy(action);
      try {
        const res = await fetch("/api/execution/mt5/terminal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, ...payload })
        });
        const data = (await res.json()) as any;
        return { ok: Boolean(data?.ok), message: String(data?.message ?? "No response"), ticket: data?.ticket, profit: data?.profit };
      } catch (e: any) {
        return { ok: false, message: e?.message ?? "Request failed." };
      } finally {
        setBusy(null);
        setTimeout(() => void fetchTerminal(), 50);
      }
    },
    [fetchTerminal]
  );

  const submitOrder = async () => {
    if (orderType !== "MARKET" && !orderPrice) {
      setError(`${orderType} requires a target price.`);
      return;
    }
    const r = await postAction("place_order", {
      symbol: orderSymbol,
      side: orderSide,
      type: orderType,
      size: orderSize,
      price: orderPrice ? Number(orderPrice) : null,
      sl: orderSL ? Number(orderSL) : null,
      tp: orderTP ? Number(orderTP) : null,
      comment: orderComment.length ? orderComment : null
    });
    if (!r.ok) setError(r.message);
    else setError(null);
  };

  const connChip = useMemo(() => {
    const s = state?.connection.status ?? "DISCONNECTED";
    if (s === "CONNECTED") return { cls: "t5ChipOk", dot: "t5DotOk", label: "MT5 LIVE", sub: state?.connection.gateway ?? "" };
    if (s === "RECONNECTING") return { cls: "t5ChipWarn", dot: "t5Dot", label: "MT5 RECONNECTING", sub: `Attempt ${state?.connection.reconnect_attempts} • next in ${state?.connection.next_reconnect_s}s` };
    return { cls: "t5ChipWarn", dot: "t5Dot", label: "MT5 TERMINAL SIMULATOR", sub: "Install MetaTrader5 on host and set FEED_MODE=MT5 to enable LIVE routing." };
  }, [state]);

  const banner = useMemo(() => {
    if (!state) return null;
    if (state.connection.status === "CONNECTED") {
      return (
        <div className="t5Banner t5BannerOk">
          <span>
            <strong>Bridge live.</strong> Terminal {state.terminal.name} build {state.terminal.build} on {state.connection.gateway} — submitting directly to account #{state.account.login} on {state.account.server}.
          </span>
          <span>{state.connection.symbols_selected}/{state.connection.symbols_total} symbols in Market Watch • Experts {state.terminal.experts_enabled ? "ON" : "OFF"}</span>
        </div>
      );
    }
    if (state.connection.status === "RECONNECTING") {
      return (
        <div className="t5Banner t5BannerErr">
          <span>
            <strong>MT5 gateway offline.</strong> Last disconnect {state.connection.last_disconnect_ts ? new Date(state.connection.last_disconnect_ts).toLocaleString() : "N/A"} — reconnecting in {state.connection.next_reconnect_s}s (attempt {state.connection.reconnect_attempts}).
          </span>
          <span>Tables auto-refresh from last snapshot.</span>
        </div>
      );
    }
    return (
      <div className="t5Banner">
        <span>
          <strong>MT5 host not bound.</strong> All panels below render the SIMULATOR terminal state. Install MetaTrader5 on this Windows host, set env <code>FEED_MODE=MT5</code> and credentials in <code>.env.local</code>, then restart to route orders and stream live ticks.
        </span>
        <span>Display timezone: Africa/Lagos • Market feed: {state.connection.feed_source}</span>
      </div>
    );
  }, [state]);

  const account = state?.account;
  const positions = state?.positions ?? [];
  const pending = state?.pending_orders ?? [];
  const deals = state?.deals ?? [];
  const logs = state?.logs ?? [];
  const symbols = state?.symbols ?? [];

  const symbolPrices = useMemo(() => {
    const map: Record<string, SymbolPrice> = {};
    for (const s of symbols) map[s.symbol] = s;
    return map;
  }, [symbols]);

  const kpis = useMemo(() => {
    if (!account) return [];
    return [
      { label: "Balance", value: `$${fmtNum(account.balance)}`, hint: `+ today $${fmtNum(account.profit_today, 2, true)}` },
      { label: "Equity", value: `$${fmtNum(account.equity)}`, hint: account.equity >= account.balance ? "+ unrealized" : "- unrealized" },
      { label: "Margin Used", value: `$${fmtNum(account.margin)}`, hint: `Required for ${positions.length} positions` },
      { label: "Free Margin", value: `$${fmtNum(account.free_margin)}`, hint: `Leverage 1:${account.leverage}` },
      { label: "Margin Level", value: `${fmtNum(account.margin_level)}%`, hint: account.margin_level > 0 && account.margin_level < 120 ? "Near MC" : account.margin_level > 1000 ? "Very Safe" : "Healthy" },
      { label: "Floating P/L", value: `$${fmtNum(account.floating_pl, 2, true)}`, hint: `${positions.length} open positions` },
      { label: "Swaps Today", value: `$${fmtNum(account.swap_today, 2, true)}`, hint: "Triple rollover Wed applied at NY 5pm" },
      { label: "Commission", value: `$${fmtNum(account.commission_today, 2, true)}`, hint: `Round-trip per lot: $3.00` }
    ];
  }, [account, positions.length]);

  const clickWatch = (sym: string) => {
    setOrderSymbol(sym);
    setActiveWatch(sym);
    const price = symbolPrices[sym];
    if (price) {
      const pp = pricePrecision(sym);
      if (orderType.endsWith(" LIMIT") || orderType.endsWith(" STOP")) {
        setOrderPrice((orderType === "BUY LIMIT" ? price.bid - price.spread * 0.0001 * (sym.includes("JPY") ? 1 : sym === "XAUUSD" ? 1 : 1) : price.ask).toFixed(pp));
      }
    }
  };

  return (
    <div className="t5Page">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="t5Hero">
        <div>
          <h1>MT5 Terminal Console</h1>
          <p>
            Unified MetaTrader 5 terminal view: connection state, trading account summary, live Market Watch, order entry pad, open positions, pending orders, recent deals, and terminal logs. All timestamps &amp; account equity calculations rendered in Africa/Lagos with 5/3/2-digit symbol precision.
          </p>
        </div>
        <div className="t5Toolbar">
          <div className={connChip.cls}>
            <span className={connChip.dot} />
            <div style={{ display: "grid", lineHeight: 1.1 }}>
              <span style={{ fontWeight: 900, letterSpacing: "0.05em" }}>{connChip.label}</span>
              {connChip.sub ? <span style={{ color: "#91a5c9", fontSize: "0.72rem", fontWeight: 600 }}>{connChip.sub}</span> : null}
            </div>
          </div>
          {state ? (
            <div className="t5ChipWarn">
              <span className="t5Dot" />
              <span>
                Account #{state.account.login} <span style={{ color: "#91a5c9" }}>• {state.account.server}</span>
              </span>
            </div>
          ) : null}
          {state ? (
            <div className="t5Chip">
              <span>
                Last update <span style={{ color: "#c9daff", fontWeight: 800 }}>{state.generated_ts_display}</span> • ticks {fmtCompact(state.stats.total_ticks_processed)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="t5Banner t5BannerErr">
          <span>{error}</span>
          <button className="t5Btn t5BtnClose" onClick={() => setError(null)} style={{ color: "#ff9e9e" }}>
            DISMISS
          </button>
        </div>
      ) : null}

      {banner}

      <div className="t5Kpis">
        {kpis.map((k) => (
          <div key={k.label} className="t5Kpi">
            <label>{k.label}</label>
            <strong>{k.value}</strong>
            <span>{k.hint}</span>
          </div>
        ))}
      </div>

      <div className="t5GridTop">
        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Terminal / Connection Diagnostics</h2>
            <span>{state ? `${state.connection.status} · ${state.terminal.name} build ${state.terminal.build}` : "Loading…"}</span>
          </div>
          <div className="t5Body">
            <dl className="t5Kv">
              <dt>Terminal name</dt>
              <dd>{state?.terminal.name ?? "—"}</dd>
              <dt>Build / version</dt>
              <dd>{state ? `build ${state.terminal.build} (v${state.terminal.version})` : "—"}</dd>
              <dt>Process PID</dt>
              <dd>{state ? String(state.terminal.pid) : "—"}</dd>
              <dt>Install path</dt>
              <dd title={state?.terminal.path}>{state?.terminal.path ?? "—"}</dd>
              <dt>Data folder</dt>
              <dd title={state?.terminal.data_folder}>{state?.terminal.data_folder ?? "—"}</dd>
              <dt>MQL5 Community</dt>
              <dd>{state?.terminal.community ? "Signed in" : "Not linked"}</dd>
              <dt>Auto trading</dt>
              <dd>{state?.terminal.trade_allowed ? "Allowed" : "Blocked"}</dd>
              <dt>Experts</dt>
              <dd>{state?.terminal.experts_enabled ? "Enabled" : "Disabled"}</dd>
              <dt>DLL imports</dt>
              <dd>{state?.terminal.dlls_enabled ? "Permitted" : "Restricted"}</dd>
              <dt>Max bars</dt>
              <dd>{state ? fmtCompact(state.terminal.max_bars) : "—"}</dd>
              <dt>CPU cores</dt>
              <dd>{state ? `${state.terminal.cpu_cores}` : "—"}</dd>
              <dt>Memory</dt>
              <dd>{state ? `${state.terminal.memory_mb_used} MB / ${state.terminal.memory_mb_total} MB` : "—"}</dd>
              <dt>Last request (ms)</dt>
              <dd>{state ? `${state.terminal.last_timeout_ms} ms` : "—"}</dd>
              <dt>Gateway route</dt>
              <dd>{state?.connection.gateway ?? "—"}</dd>
              <dt>Feed source</dt>
              <dd>{state?.connection.feed_source ?? "—"}</dd>
              <dt>Route mode</dt>
              <dd>{state?.connection.route_mode ?? "—"}</dd>
              <dt>Last connect</dt>
              <dd>{state?.connection.last_connect_ts ? new Date(state.connection.last_connect_ts).toLocaleString() : "—"}</dd>
              <dt>Last disconnect</dt>
              <dd>{state?.connection.last_disconnect_ts ? new Date(state.connection.last_disconnect_ts).toLocaleString() : "—"}</dd>
              <dt>Reconnects</dt>
              <dd>{state?.connection.reconnect_attempts ?? "—"}</dd>
              <dt>Symbols (sel/tot)</dt>
              <dd>{state ? `${state.connection.symbols_selected} / ${state.connection.symbols_total}` : "—"}</dd>
            </dl>
          </div>
        </section>

        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Market Watch</h2>
            <span>{state ? `${symbols.length} pairs • symbol ${activeWatch} selected for order pad` : "Loading…"}</span>
          </div>
          <div className="t5Body">
            <div className="t5Watch">
              <div className="t5WatchHead">
                <span>Symbol</span>
                <span>Bid</span>
                <span>Ask</span>
                <span className="t5Spread">Spread</span>
                <span className="t5Src">Src</span>
              </div>
              {WATCH_SYMBOLS.map((sym) => {
                const s = symbolPrices[sym];
                const pp = pricePrecision(sym);
                const bid = s?.bid ?? 0;
                const ask = s?.ask ?? 0;
                const spread = s?.spread ?? 0;
                const src = s?.source ?? state?.connection.feed_source ?? "—";
                return (
                  <div
                    key={sym}
                    className={`t5WatchRow ${activeWatch === sym ? "active" : ""}`}
                    onClick={() => clickWatch(sym)}
                  >
                    <div className="t5Sym">
                      <span className="t5SymBadge" style={{ background: SYMBOL_BADGE_COLORS[sym] }} />
                      <span>{sym}</span>
                    </div>
                    <div className="t5Bid">{bid ? bid.toFixed(pp) : "—"}</div>
                    <div className="t5Ask">{ask ? ask.toFixed(pp) : "—"}</div>
                    <div className="t5Spread">{spread ? `${spread.toFixed(1)} p` : "—"}</div>
                    <div className="t5Src">{src}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Order Pad — One Click</h2>
            <span>
              {busy === "place_order" ? "Submitting…" : orderSide} {orderType} {orderSymbol} {orderSize.toFixed(2)} lots
            </span>
          </div>
          <div className="t5Body">
            <div className="t5Pad">
              <div className="t5Side">
                <button
                  type="button"
                  className={orderSide === "BUY" ? "t5BuyBtn" : "t5Inactive"}
                  onClick={() => setOrderSide("BUY")}
                >
                  ▲ BUY
                </button>
                <button
                  type="button"
                  className={orderSide === "SELL" ? "t5SellBtn" : "t5Inactive"}
                  onClick={() => setOrderSide("SELL")}
                >
                  ▼ SELL
                </button>
              </div>
              <div className="t5Field">
                <label>Symbol</label>
                <select value={orderSymbol} onChange={(e) => { setOrderSymbol(e.target.value); setActiveWatch(e.target.value); }}>
                  {WATCH_SYMBOLS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="t5Field">
                <label>Type</label>
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value as OrderType)}
                >
                  <option value="MARKET">MARKET</option>
                  <option value="BUY LIMIT">BUY LIMIT</option>
                  <option value="SELL LIMIT">SELL LIMIT</option>
                  <option value="BUY STOP">BUY STOP</option>
                  <option value="SELL STOP">SELL STOP</option>
                </select>
              </div>
              <div className="t5Field">
                <label>Size (lots)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="5"
                  value={orderSize}
                  onChange={(e) => setOrderSize(Number(e.target.value))}
                />
              </div>
              <div className="t5Field">
                <label>{orderType === "MARKET" ? "Market price" : "Entry price"}</label>
                <input
                  type="number"
                  step="0.00001"
                  value={orderPrice}
                  disabled={orderType === "MARKET"}
                  placeholder={
                    orderType === "MARKET"
                      ? symbolPrices[orderSymbol]
                        ? `${symbolPrices[orderSymbol][orderSide === "BUY" ? "ask" : "bid"].toFixed(pricePrecision(orderSymbol))} (live ${orderSide === "BUY" ? "ask" : "bid"})`
                        : "— market —"
                      : "Enter trigger price…"
                  }
                  onChange={(e) => setOrderPrice(e.target.value)}
                />
              </div>
              <div className="t5Field">
                <label>Stop loss</label>
                <input type="number" step="0.00001" placeholder="Optional" value={orderSL} onChange={(e) => setOrderSL(e.target.value)} />
              </div>
              <div className="t5Field">
                <label>Take profit</label>
                <input type="number" step="0.00001" placeholder="Optional" value={orderTP} onChange={(e) => setOrderTP(e.target.value)} />
              </div>
              <div className="t5Field" style={{ gridColumn: "1 / -1" }}>
                <label>Comment (31 chars)</label>
                <input
                  maxLength={31}
                  placeholder="e.g. Discretionary · Gold NY session open · manual ticket"
                  value={orderComment}
                  onChange={(e) => setOrderComment(e.target.value)}
                />
              </div>
              <button
                type="button"
                className={`t5Submit ${orderSide === "SELL" ? "t5SubmitErr" : ""}`}
                disabled={busy !== null || loading || !state}
                onClick={() => void submitOrder()}
              >
                {busy === "place_order"
                  ? "Submitting to broker…"
                  : `PLACE ${orderSide} ${orderType}${orderType !== "MARKET" ? ` @ ${orderPrice || "?"}` : ""} • ${orderSize.toFixed(2)} × ${orderSymbol}`}
              </button>
            </div>
          </div>
        </section>
      </div>

      <div className="t5GridMid">
        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Open Positions ({positions.length})</h2>
            <span>
              {account
                ? `Unrealized $${fmtNum(account.floating_pl, 2, true)} • exposure ${fmtNum(
                    positions.reduce((a, p) => a + p.size, 0),
                    2
                  )} lots`
                : "Loading…"}
            </span>
          </div>
          <div className="t5TableWrap">
            {positions.length === 0 ? (
              <div className="t5Empty">No open positions. Use the order pad to route a market or pending order.</div>
            ) : (
              <table className="t5Table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Open (Lagos)</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>Symbol</th>
                    <th className="num">Open</th>
                    <th className="num">S/L</th>
                    <th className="num">T/P</th>
                    <th className="num">Current</th>
                    <th className="num">Swap</th>
                    <th className="num">Comm</th>
                    <th className="num">Pips</th>
                    <th className="num">P/L</th>
                    <th>Comment / Magic</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const pp = pricePrecision(p.symbol);
                    const curPrice = p.side === "BUY" ? p.current_bid : p.current_ask;
                    const profitCls = p.profit >= 0 ? "t5ProfitUp" : "t5ProfitDown";
                    return (
                      <tr key={p.ticket} className={`t5Row ${newestKey === p.ticket ? "flash" : ""}`}>
                        <td style={{ fontWeight: 700 }}>{p.ticket}</td>
                        <td>{p.open_ts_display}</td>
                        <td><span className={p.side === "BUY" ? "t5BuyTag" : "t5SellTag"}>{p.side}</span></td>
                        <td className="num">{p.size.toFixed(2)}</td>
                        <td style={{ fontWeight: 800, letterSpacing: "0.03em" }}>{p.symbol}</td>
                        <td className="num">{p.open_price.toFixed(pp)}</td>
                        <td className="num">{p.sl != null ? p.sl.toFixed(pp) : "—"}</td>
                        <td className="num">{p.tp != null ? p.tp.toFixed(pp) : "—"}</td>
                        <td className="num">{curPrice ? curPrice.toFixed(pp) : "—"}</td>
                        <td className="num">{p.swap.toFixed(2)}</td>
                        <td className="num">{p.commission.toFixed(2)}</td>
                        <td className={`num ${p.profit_pips >= 0 ? "t5ProfitUp" : "t5ProfitDown"}`}>
                          {p.profit_pips > 0 ? "+" : ""}{p.profit_pips.toFixed(1)}
                        </td>
                        <td className={`num ${profitCls}`}>${fmtNum(p.profit, 2, true)}</td>
                        <td style={{ color: "#91a5c9", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={p.comment}>
                          {p.comment || "—"} <span style={{ opacity: 0.6 }}>· M{p.magic}</span>
                        </td>
                        <td className="act">
                          <button
                            className="t5Btn"
                            disabled={busy !== null}
                            onClick={() => void postAction("modify_position", { ticket: p.ticket, sl: p.sl, tp: p.tp })}
                            title="Modify (currently mirrors existing SL/TP — extend in UI with modal as needed)"
                          >
                            ⟳ Modify
                          </button>
                          <button
                            className="t5Btn t5BtnClose"
                            disabled={busy !== null}
                            onClick={() => void postAction("close_position", { ticket: p.ticket })}
                          >
                            ✕ Close
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Pending Orders ({pending.length})</h2>
            <span>
              {state ? `${state.stats.orders_24h} orders last 24h • ${state.stats.total_rejects} rejects` : "Loading…"}
            </span>
          </div>
          <div className="t5TableWrap">
            {pending.length === 0 ? (
              <div className="t5Empty">No pending stop or limit orders. Select BUY/SELL LIMIT/STOP in the order pad to place one.</div>
            ) : (
              <table className="t5Table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Created (Lagos)</th>
                    <th>Type</th>
                    <th>Size</th>
                    <th>Symbol</th>
                    <th className="num">Price</th>
                    <th className="num">S/L</th>
                    <th className="num">T/P</th>
                    <th>Status</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((o) => {
                    const pp = pricePrecision(o.symbol);
                    return (
                      <tr key={o.ticket} className={`t5Row ${newestKey === o.ticket ? "flash" : ""}`}>
                        <td style={{ fontWeight: 700 }}>{o.ticket}</td>
                        <td>{o.ts_display}</td>
                        <td><span className="t5TypeTag">{o.type}</span></td>
                        <td className="num">{o.size.toFixed(2)}</td>
                        <td style={{ fontWeight: 800 }}>{o.symbol}</td>
                        <td className="num">{o.price.toFixed(pp)}</td>
                        <td className="num">{o.sl != null ? o.sl.toFixed(pp) : "—"}</td>
                        <td className="num">{o.tp != null ? o.tp.toFixed(pp) : "—"}</td>
                        <td>{o.status}</td>
                        <td className="act">
                          <button
                            className="t5Btn t5BtnClose"
                            disabled={busy !== null}
                            onClick={() => void postAction("cancel_order", { ticket: o.ticket })}
                          >
                            ✕ Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <div className="t5GridBot">
        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Recent Deals ({deals.length})</h2>
            <span>
              {state
                ? `Total ${state.stats.total_deals} deals • Win ${state.stats.win_rate_pct}% • PF ${state.stats.profit_factor} • Expect $${state.stats.expectancy_per_lot}/lot • Max DD ${state.stats.max_dd_pct}%`
                : "Loading…"}
            </span>
          </div>
          <div className="t5TableWrap">
            {deals.length === 0 ? (
              <div className="t5Empty">No recent deal history. Execution events from the decision engine will appear here as they fill.</div>
            ) : (
              <table className="t5Table">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th>Order</th>
                    <th>Time (Lagos)</th>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>In/Out</th>
                    <th className="num">Size</th>
                    <th className="num">Price</th>
                    <th className="num">S/L</th>
                    <th className="num">T/P</th>
                    <th className="num">Comm</th>
                    <th className="num">Swap</th>
                    <th className="num">Profit</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {deals.map((d) => {
                    const pp = pricePrecision(d.symbol);
                    const cls = d.profit >= 0 ? "t5ProfitUp" : "t5ProfitDown";
                    return (
                      <tr key={d.deal} className={`t5Row ${newestKey === d.deal ? "flash" : ""}`}>
                        <td style={{ fontWeight: 700 }}>{d.deal}</td>
                        <td>{d.order}</td>
                        <td>{d.ts_display}</td>
                        <td style={{ fontWeight: 800 }}>{d.symbol}</td>
                        <td>
                          <span className={d.type === "BUY" ? "t5BuyTag" : d.type === "SELL" ? "t5SellTag" : "t5TypeTag"}>
                            {d.type}
                          </span>
                        </td>
                        <td>
                          <span className="t5TypeTag" style={{ opacity: 0.92 }}>{d.entry}</span>
                        </td>
                        <td className="num">{d.size.toFixed(2)}</td>
                        <td className="num">{d.price.toFixed(pp)}</td>
                        <td className="num">{d.sl != null ? d.sl.toFixed(pp) : "—"}</td>
                        <td className="num">{d.tp != null ? d.tp.toFixed(pp) : "—"}</td>
                        <td className="num">{d.commission.toFixed(2)}</td>
                        <td className="num">{d.swap.toFixed(2)}</td>
                        <td className={`num ${cls}`}>${fmtNum(d.profit, 2, true)}</td>
                        <td style={{ color: "#91a5c9", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }} title={d.comment}>
                          {d.comment || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="t5Panel">
          <div className="t5PanelHead">
            <h2>Terminal Events / Journal</h2>
            <span>{logs.length} lines • auto-scroll on new events</span>
          </div>
          <div className="t5LogWrap">
            {logs.length === 0 ? (
              <div className="t5Empty">Waiting for terminal journal events…</div>
            ) : (
              logs.map((l, i) => (
                <div key={`${l.ts}-${i}`} className={`t5LogLine ${logLevelClass(l.level)}`}>
                  <span>{l.ts_display}</span>
                  <span className="t5LogCat">{l.category}</span>
                  <span className="t5LogCat">[{l.level}]</span>
                  <span>{l.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="t5Foot">
        <div className="t5Mini">
          <label>Ticks processed</label>
          <strong>{state ? fmtCompact(state.stats.total_ticks_processed) : "—"}</strong>
        </div>
        <div className="t5Mini">
          <label>Orders 24h</label>
          <strong>{state ? String(state.stats.orders_24h) : "—"}</strong>
        </div>
        <div className="t5Mini">
          <label>Deals 24h</label>
          <strong>{state ? String(state.stats.deals_24h) : "—"}</strong>
        </div>
        <div className="t5Mini">
          <label>Rejects</label>
          <strong>{state ? String(state.stats.total_rejects) : "—"}</strong>
        </div>
        <div className="t5Mini">
          <label>Avg slippage</label>
          <strong>{state ? `${state.stats.avg_slippage_pips.toFixed(2)} p` : "—"}</strong>
        </div>
        <div className="t5Mini">
          <label>Win rate</label>
          <strong>{state ? `${state.stats.win_rate_pct.toFixed(1)}%` : "—"}</strong>
        </div>
      </div>
    </div>
  );
}
