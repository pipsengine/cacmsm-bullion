"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"] as const;
const TIMEFRAMES = ["TICK", "M1", "M5", "M15", "M30", "H1", "H4", "H6", "H8", "H12", "D1", "W1", "MN1", "YTD"] as const;
const TOP_DOWN_TIMEFRAMES = ["YTD", "MN1", "W1", "D1", "H12", "H8", "H6", "H4", "H1", "M30", "M15", "M5", "M1", "TICK"] as const;

type Currency = (typeof CURRENCIES)[number];
type Tf = (typeof TIMEFRAMES)[number];

type SymbolTick = {
  symbol: string;
  bid?: number;
  ask?: number;
  spread?: number;
  mid?: number;
  ts_utc?: string;
  ts_display?: string;
  source?: string;
};

type FilterSignal = "STRONG" | "NEUTRAL" | "WEAK";
type MatrixRow = { currency: Currency; values: Record<Tf, number>; htf_filter?: FilterSignal };
type MarketIntelligence = {
  engine: string;
  advisory_only: boolean;
  verdict: "TECHNICAL_READY" | "SETUP_FORMING" | "WATCH" | "NO_TRADE" | string;
  symbol: string;
  direction: "BUY" | "SELL" | "NEUTRAL" | string;
  confidence: number;
  regime: string;
  strength_gap: number;
  xau_strength: number;
  usd_strength: number;
  strongest: { currency: string; score: number };
  weakest: { currency: string; score: number };
  supporting_timeframes: string[];
  conflicting_timeframes: string[];
  data_quality: number;
  risk_flags: string[];
  reason: string;
  candidate_pairs: Array<{ symbol: string; direction: string; strong_currency: string; weak_currency: string; strength_gap: number }>;
};

type Snapshot = {
  ts_utc?: string;
  ts_display?: string;
  feed_source?: "SIM" | "MT5" | "OFF" | string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  total_ticks?: number;
  symbols?: SymbolTick[];
  currency_values?: Record<Currency, number>;
  matrix_rows?: MatrixRow[];
  ranked_bias?: { currency: Currency; avg_bias: number }[];
  value_unit?: string;
  sampling?: string;
  intelligence?: MarketIntelligence;
};

const trendFromValue = (v: number) => (v >= 70 ? "STRONG" : v <= 30 ? "WEAK" : "NEUTRAL");
const cellClass = (v: number) => (v >= 70 ? "positive" : v <= 30 ? "negative" : "neutral");
const higherTimeframeFilter = (values: Record<Tf, number>): FilterSignal => {
  const anchors = [values.D1, values.W1, values.MN1];
  if (anchors.every((value) => value >= 70)) return "STRONG";
  if (anchors.every((value) => value <= 30)) return "WEAK";
  return "NEUTRAL";
};

const STYLES = `
  .mxPage{ width:100%; min-width:0; color:#ecf3ff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .mxHero{ display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .mxHero h1{ margin:0; font-size:clamp(1.6rem, 2.2vw, 2.4rem); letter-spacing:0.04em; }
  .mxHero p{ margin:8px 0 0; color:#91a5c9; max-width:880px; line-height:1.45; }
  .mxToolbar{ display:flex; flex-wrap:wrap; gap:10px; max-width:100%; }
  .mxChip, .mxNavLink{
    display:inline-flex; align-items:center; gap:8px;
    border-radius:999px; border:1px solid #32456a; background:rgba(17,28,47,0.92);
    color:#ecf3ff; padding:10px 14px; text-decoration:none;
    box-shadow:0 12px 30px rgba(0,0,0,0.28); font-size:0.92rem; font-weight:600;
  }
  .mxNavLink:hover{ border-color:#6785bf; cursor:pointer; }
  .mxChipOk{ border-color:#2a7a48; }
  .mxChipWarn{ border-color:#a87a1a; }
  .mxChipErr{ border-color:#a22; }
  .mxDot{ width:10px; height:10px; border-radius:50%; background:#48d976; box-shadow:0 0 10px rgba(72,217,118,0.9); }
  .mxDotWarn{ background:#f5c24a; box-shadow:0 0 10px rgba(245,194,74,0.9); }
  .mxDotErr{ background:#ef5350; box-shadow:0 0 10px rgba(239,83,80,0.9); }
  .mxPanel{
    width:100%; min-width:0;
    background:linear-gradient(180deg, rgba(26,41,66,0.92), rgba(12,22,39,0.96));
    border:1px solid #32456a; border-radius:18px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.28);
  }
  .mxPanelHead{
    display:flex; justify-content:space-between; gap:12px; padding:16px 18px;
    border-bottom:1px solid #32456a; background:rgba(255,255,255,0.025); flex-wrap:wrap;
  }
  .mxPanelHead h2{ margin:0; font-size:1rem; letter-spacing:0.04em; }
  .mxPanelHead span{ color:#91a5c9; font-size:0.92rem; }
  .mxPanelTitle{ display:grid; gap:5px; }
  .mxMatrixControls{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .mxMatrixControls select{
    min-height:34px; padding:6px 10px; border:1px solid #4a638d; border-radius:9px;
    background:#111e34; color:#ecf3ff; font:inherit; font-size:0.78rem; font-weight:700;
  }
  .mxMatrixControls select{ cursor:pointer; }
  .mxMatrixControls select:hover{ border-color:#7d9bd0; }
  .mxTableWrap{ width:100%; min-width:0; overflow-x:hidden; overflow-y:auto; }
  .mxTable{ width:100%; min-width:0; table-layout:fixed; border-collapse:separate; border-spacing:0; }
  .mxTable thead th:first-child{ width:7%; }
  .mxTable thead th:nth-child(2){ width:8%; }
  .mxTable thead th{
    position:sticky; top:0; z-index:3; background:#d9e7f0; color:#10203e;
    padding:12px clamp(2px, 0.45vw, 8px); border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    text-transform:uppercase; font-size:clamp(0.58rem, 0.7vw, 0.8rem); letter-spacing:0.035em; white-space:nowrap;
  }
  .mxTable thead th:first-child{ left:0; position:sticky; z-index:4; }
  .mxTable tbody th{
    position:sticky; left:0; z-index:2; background:#d9e7f0; color:#10203e;
    padding:14px 12px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    min-width:0; text-align:left;
  }
  .mxTable td{
    min-width:0; text-align:center; padding:12px clamp(2px, 0.4vw, 7px);
    border-right:1px solid rgba(255,255,255,0.08); border-bottom:1px solid rgba(255,255,255,0.08);
    font-variant-numeric:tabular-nums; transition:transform 180ms ease, box-shadow 180ms ease;
  }
  .mxTdPositive{ background:linear-gradient(180deg, rgba(30,150,72,0.96), rgba(16,106,44,0.98)); }
  .mxTdNegative{ background:linear-gradient(180deg, rgba(212,63,63,0.96), rgba(134,23,23,0.98)); }
  .mxTdNeutral{ background:linear-gradient(180deg, rgba(196,137,25,0.96), rgba(126,82,12,0.98)); }
  .mxTdUpdated{ transform:scale(1.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.5), 0 0 0 2px rgba(117,168,255,0.3); }
  .mxValue{ display:block; font-weight:700; font-size:clamp(0.72rem, 0.85vw, 1rem); }
  .mxSignal{ display:block; margin-top:4px; font-size:clamp(0.5rem, 0.58vw, 0.68rem); letter-spacing:0.04em; opacity:0.92; }
  .mxGrid{ display:grid; grid-template-columns:1.35fr 1fr; gap:18px; margin-top:18px; }
  .mxStack{ display:grid; gap:18px; }
  .mxTickerStrip{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; padding:16px 18px 18px; }
  .mxCard{
    border-radius:14px; padding:12px 14px; background:rgba(255,255,255,0.04);
    border:1px solid rgba(255,255,255,0.06);
  }
  .mxCard small{ display:block; color:#91a5c9; margin-bottom:5px; letter-spacing:0.06em; font-weight:700; }
  .mxCard strong{ display:block; font-size:1.08rem; }
  .mxCard em{ display:inline-block; margin-top:6px; font-style:normal; font-size:0.82rem; }
  .mxMetrics{ padding:16px 18px 18px; display:grid; gap:10px; }
  .mxMetric{
    display:flex; justify-content:space-between; gap:10px; padding:11px 12px; border-radius:12px;
    background:rgba(255,255,255,0.035); border:1px solid rgba(255,255,255,0.05);
  }
  .mxMuted{ color:#91a5c9; }
  .mxUp{ color:#65ea8b; }
  .mxDown{ color:#ff8282; }
  .mxBanner{
    padding:12px 16px; border-radius:12px; margin-bottom:14px;
    border:1px solid #a87a1a; background:rgba(210,160,60,0.12); color:#ffd88a;
    font-size:0.92rem;
  }
  .mxBannerErr{
    border-color:#a22; background:rgba(220,70,70,0.12); color:#ff9e9e;
  }
  .mxIntel{ margin:18px 0; }
  .mxIntelBody{ padding:16px 18px 18px; display:grid; gap:14px; }
  .mxIntelGrid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
  .mxIntelStat{ padding:12px 14px; border-radius:13px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); }
  .mxIntelStat small{ display:block; color:#91a5c9; margin-bottom:5px; font-size:0.7rem; font-weight:800; letter-spacing:0.06em; }
  .mxIntelStat strong{ font-size:1rem; }
  .mxIntelReason{ padding:12px 14px; border-radius:12px; background:rgba(11,21,38,0.7); line-height:1.5; }
  .mxIntelRows{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .mxIntelList{ padding:12px 14px; border:1px solid rgba(255,255,255,0.07); border-radius:12px; }
  .mxIntelList b{ display:block; margin-bottom:7px; }
  .mxIntelList span{ color:#91a5c9; font-size:0.82rem; line-height:1.5; }
  .mxVerdictReady{ color:#65ea8b; }
  .mxVerdictCaution{ color:#ffd26a; }
  .mxVerdictStop{ color:#ff8282; }
  @media (max-width:1120px){
    .mxGrid{ grid-template-columns:1fr; }
    .mxChip, .mxNavLink{ padding:8px 10px; font-size:0.78rem; }
    .mxTable tbody th{ padding:11px 7px; font-size:0.78rem; }
  }
  @media (max-width:900px){
    .mxHero h1{ font-size:1.4rem; }
    .mxHero p{ font-size:0.86rem; }
    .mxToolbar{ width:100%; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
    .mxChip, .mxNavLink{ justify-content:center; text-align:center; border-radius:12px; box-shadow:none; }
    .mxPanelHead{ padding:13px 14px; }
    .mxPanelHead span{ font-size:0.78rem; }
    .mxMatrixControls{ width:100%; }
    .mxMatrixControls select{ flex:1; min-width:0; }
    .mxTableWrap{ padding:10px; }
    .mxTable, .mxTable tbody{ display:block; width:100%; }
    .mxTable thead{ display:none; }
    .mxTable tbody{ display:grid; gap:10px; }
    .mxTable tbody tr{
      display:grid; grid-template-columns:repeat(4,minmax(0,1fr));
      overflow:hidden; border:1px solid rgba(255,255,255,0.12); border-radius:12px;
    }
    .mxTable tbody th{
      position:static; grid-column:1 / -1; width:auto; padding:10px 12px;
      border-right:0; font-size:0.85rem;
    }
    .mxTable td{
      display:flex; min-width:0; padding:9px 4px; align-items:center; justify-content:center;
      flex-direction:column;
    }
    .mxTable td::before{
      content:attr(data-timeframe); display:block; margin-bottom:3px;
      font-size:0.6rem; font-weight:900; letter-spacing:0.07em; opacity:0.88;
    }
    .mxTdUpdated{ transform:none; }
    .mxIntelGrid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
    .mxIntelRows{ grid-template-columns:1fr; }
  }
  @media (max-width:520px){
    .mxToolbar{ grid-template-columns:1fr; }
    .mxTable tbody tr{ grid-template-columns:repeat(2,minmax(0,1fr)); }
    .mxTickerStrip{ grid-template-columns:repeat(2,minmax(0,1fr)); padding:12px; }
  }
  @media (prefers-reduced-motion: reduce){
    .mxTable td{ transition:none; }
  }
`;

function precisionFor(sym: string): number {
  if (sym === "XAUUSD") return 2;
  if (sym.includes("JPY")) return 3;
  return 4;
}

function formatLagosTime(ts?: string): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      year: undefined,
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

const EMPTY_MATRIX: Record<Currency, Record<Tf, number>> = (() => {
  const s = {} as Record<Currency, Record<Tf, number>>;
  for (const c of CURRENCIES) {
    s[c] = {} as Record<Tf, number>;
    for (const tf of TIMEFRAMES) s[c][tf] = 0;
  }
  return s;
})();

function normalizeColumn(values: Record<Currency, number>): Record<Currency, number> {
  const raw = CURRENCIES.map((currency) => Number(values[currency]) || 0);
  const low = Math.min(...raw);
  const high = Math.max(...raw);
  if (Math.abs(high - low) < 1e-12) {
    return Object.fromEntries(CURRENCIES.map((currency) => [currency, 50])) as Record<Currency, number>;
  }
  const lowCount = raw.filter((value) => Math.abs(value - low) < 1e-12).length;
  const highCount = raw.filter((value) => Math.abs(value - high) < 1e-12).length;
  return Object.fromEntries(CURRENCIES.map((currency) => {
    const rawValue = Number(values[currency]) || 0;
    let percentage = Math.round(((rawValue - low) / (high - low)) * 1000) / 10;
    if (percentage <= 0 && !(lowCount === 1 && Math.abs(rawValue - low) < 1e-12)) percentage = 0.1;
    if (percentage >= 100 && !(highCount === 1 && Math.abs(rawValue - high) < 1e-12)) percentage = 99.9;
    return [currency, percentage];
  })) as Record<Currency, number>;
}

export default function MarketMatrixPage({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Record<string, number>>({});
  const [signalFilter, setSignalFilter] = useState<"ALL" | "EXTREMES" | FilterSignal>("ALL");
  const [strongestFirst, setStrongestFirst] = useState(true);
  const tickRef = useRef(0);
  const prevMatrixRef = useRef<Record<Currency, Record<Tf, number>>>(EMPTY_MATRIX);
  const symPrevRef = useRef<Record<string, number>>({});

  const matrixState: Record<Currency, Record<Tf, number>> = useMemo(() => {
    if (!snapshot?.matrix_rows) return prevMatrixRef.current;
    const out = Object.fromEntries(
      CURRENCIES.map((currency) => [currency, { ...prevMatrixRef.current[currency] }]),
    ) as Record<Currency, Record<Tf, number>>;
    for (const row of snapshot.matrix_rows) {
      out[row.currency as Currency] = row.values as Record<Tf, number>;
    }
    if (snapshot.value_unit !== "percent") {
      for (const timeframe of TIMEFRAMES) {
        const percentages = normalizeColumn(
          Object.fromEntries(CURRENCIES.map((currency) => [currency, out[currency][timeframe] ?? 0])) as Record<Currency, number>,
        );
        for (const currency of CURRENCIES) out[currency][timeframe] = percentages[currency];
      }
    }
    return out;
  }, [snapshot]);

  useEffect(() => {
    prevMatrixRef.current = matrixState;
  }, [matrixState]);

  useEffect(() => {
    let alive = true;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function fetchOnce() {
      try {
        const res = await fetch("/api/market/snapshot", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Snapshot;
        if (!alive) return;
        tickRef.current += 1;
        const tick = tickRef.current;
        const nowUpdated: Record<string, number> = {};
        for (const c of CURRENCIES) {
          for (const tf of TIMEFRAMES) {
            const prev = prevMatrixRef.current?.[c]?.[tf] ?? 0;
            const next = (data.matrix_rows?.find((r) => r.currency === c)?.values?.[tf]) ?? prev;
            if (Math.abs(next - prev) >= 0.1) nowUpdated[`${c}:${tf}`] = tick;
          }
        }
        setUpdated(nowUpdated);
        setSnapshot(data);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load snapshot");
        setLoading(false);
      }
    }

    fetchOnce();
    pollTimer = setInterval(fetchOnce, 750);

    return () => {
      alive = false;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  const feedBadgeKind = (() => {
    if (!snapshot) return { label: "LOADING", kind: "warn" as const };
    if (snapshot.mt5_connected) return { label: "MT5 LIVE", kind: "ok" as const };
    if (snapshot.feed_source === "MT5" && !snapshot.mt5_connected) return { label: "MT5 RECONNECTING", kind: "warn" as const };
    return { label: "OFFLINE", kind: "err" as const };
  })();

  const visibleCurrencies = useMemo(() => {
    const sorted = [...CURRENCIES].sort((left, right) => {
        const direction = strongestFirst ? 1 : -1;
        // Compare high-to-low timeframes and place the resulting currency rank
        // vertically. Lower timeframes only break ties in higher timeframes.
        for (const timeframe of TOP_DOWN_TIMEFRAMES) {
          const difference = matrixState[right][timeframe] - matrixState[left][timeframe];
          if (Math.abs(difference) >= 0.05) return difference * direction;
        }
        return left.localeCompare(right);
      });
    if (signalFilter === "EXTREMES") {
      const dailySorted = [...CURRENCIES].sort((left, right) => {
        const difference = matrixState[right].D1 - matrixState[left].D1;
        if (Math.abs(difference) >= 0.05) return difference;
        return left.localeCompare(right);
      });
      const dailyStrongest = dailySorted[0];
      const dailyWeakest = dailySorted[dailySorted.length - 1];
      let selected: Currency[] = [dailyStrongest, dailyWeakest];

      // XAU should not consume one of the two currency comparison slots. When
      // gold is a daily extreme, retain it and add both FX currency extremes.
      if (selected.includes("XAU")) {
        const fxOnly = dailySorted.filter((currency) => currency !== "XAU");
        selected = ["XAU", fxOnly[0], fxOnly[fxOnly.length - 1]];
      }

      const direction = strongestFirst ? 1 : -1;
      return selected.sort((left, right) => {
        const difference = matrixState[right].D1 - matrixState[left].D1;
        if (Math.abs(difference) >= 0.05) return difference * direction;
        return left.localeCompare(right);
      });
    }
    return sorted.filter((currency) => {
      const signal = higherTimeframeFilter(matrixState[currency]);
      return signalFilter === "ALL" || signal === signalFilter;
    });
  }, [matrixState, signalFilter, strongestFirst]);

  const ranked = visibleCurrencies.slice(0, 6).map((currency) => ({
    currency,
    signal: higherTimeframeFilter(matrixState[currency]),
    htfStrength: (
      matrixState[currency].MN1 + matrixState[currency].W1 + matrixState[currency].D1
    ) / 3,
  }));
  const intelligence = snapshot?.intelligence;
  const verdictClass = intelligence?.verdict === "TECHNICAL_READY"
    ? "mxVerdictReady"
    : intelligence?.verdict === "NO_TRADE"
      ? "mxVerdictStop"
      : "mxVerdictCaution";

  return (
    <div className="mxPage" style={{ maxWidth: 1500, margin: "0 auto 36px" }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="mxHero">
        <div>
          <h1>CACSMS Bullion Market Matrix</h1>
          <p>
            MT5-only relative strength from 0 to 100 across 9 instruments and 14 timeframes. FX uses the available
            28-pair basket, XAU uses XAUUSD, and the D1/W1/MN1 filter confirms directional confluence.
          </p>
        </div>
        <div className="mxToolbar">
          {(() => {
            const chipKindCls =
              feedBadgeKind.kind === "ok"
                ? "mxChipOk"
                : feedBadgeKind.kind === "warn"
                  ? "mxChipWarn"
                  : "mxChipErr";
            const dotKindCls =
              feedBadgeKind.kind === "ok"
                ? ""
                : feedBadgeKind.kind === "warn"
                  ? "mxDotWarn"
                  : "mxDotErr";
            return (
              <div className={`mxChip ${chipKindCls}`}>
                <span className={`mxDot ${dotKindCls}`} />
                <span>{feedBadgeKind.label}</span>
              </div>
            );
          })()}
          <div className="mxChip">
            Last update (Lagos) <strong>{formatLagosTime(snapshot?.ts_display)}</strong>
          </div>
          <div className="mxChip">
            Live symbols <strong>{snapshot?.symbols?.length ?? 0}</strong>
          </div>
          {onOpenHistory ? (
            <button type="button" onClick={onOpenHistory} className="mxNavLink">
              Open 24h history
            </button>
          ) : (
            <a href="/market/history-24h" className="mxNavLink">
              Open 24h history
            </a>
          )}
        </div>
      </div>

      {snapshot && !snapshot.mt5_connected && (
        <div className="mxBanner mxBannerErr">
          MT5 is disconnected. No substitute or simulated market data will be generated.
          {snapshot.mt5_error ? ` — ${snapshot.mt5_error}` : ""}
        </div>
      )}
      {error && !snapshot && (
        <div className="mxBanner mxBannerErr">Market feed unreachable: {error}</div>
      )}

      <div className="mxPanel">
        <div className="mxPanelHead">
          <div className="mxPanelTitle">
            <h2>Strength Matrix · Top-Down Analysis</h2>
            <span>Rows rank top-to-bottom: YTD → MN1 → W1 → D1 → intraday → TICK</span>
          </div>
          <div className="mxMatrixControls">
            <select
              aria-label="Filter currencies by higher-timeframe signal"
              value={signalFilter}
              onChange={(event) => setSignalFilter(event.target.value as "ALL" | "EXTREMES" | FilterSignal)}
            >
              <option value="ALL">All HTF signals</option>
              <option value="EXTREMES">Today&apos;s Strongest + Weakest</option>
              <option value="STRONG">Strong only</option>
              <option value="NEUTRAL">Neutral only</option>
              <option value="WEAK">Weak only</option>
            </select>
            <select
              aria-label="Sort currencies by strength"
              value={strongestFirst ? "STRONGEST_FIRST" : "WEAKEST_FIRST"}
              onChange={(event) => setStrongestFirst(event.target.value === "STRONGEST_FIRST")}
            >
              <option value="STRONGEST_FIRST">Strongest → Weakest</option>
              <option value="WEAKEST_FIRST">Weakest → Strongest</option>
            </select>
          </div>
        </div>
        <div className="mxTableWrap">
          <table className="mxTable">
            <thead>
              <tr>
                <th>Currency</th>
                <th>HTF Filter</th>
                {TOP_DOWN_TIMEFRAMES.map((tf) => (
                  <th key={tf}>{tf}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCurrencies.map((ccy) => (
                <tr key={ccy}>
                  <th scope="row">{ccy}</th>
                  {(() => {
                    const serverFilter = snapshot?.matrix_rows?.find((row) => row.currency === ccy)?.htf_filter;
                    const filter = serverFilter ?? higherTimeframeFilter(matrixState[ccy]);
                    const clsName = filter === "STRONG"
                      ? "mxTdPositive"
                      : filter === "WEAK"
                        ? "mxTdNegative"
                        : "mxTdNeutral";
                    return (
                      <td className={clsName} data-timeframe="HTF FILTER">
                        <span className="mxValue">{filter}</span>
                        <span className="mxSignal">D1 · W1 · MN1</span>
                      </td>
                    );
                  })()}
                  {TOP_DOWN_TIMEFRAMES.map((tf) => {
                    const v = matrixState[ccy]?.[tf] ?? 0;
                    const cls = cellClass(v);
                    const isUpdated = updated[`${ccy}:${tf}`] === tickRef.current;
                    const clsName =
                      (cls === "positive"
                        ? "mxTdPositive"
                        : cls === "negative"
                          ? "mxTdNegative"
                          : "mxTdNeutral") + (isUpdated ? " mxTdUpdated" : "");
                    return (
                      <td key={tf} className={clsName} data-timeframe={tf}>
                        <span className="mxValue">
                          {v.toFixed(1)}
                        </span>
                        <span className="mxSignal">{trendFromValue(v)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mxPanel mxIntel">
        <div className="mxPanelHead">
          <div className="mxPanelTitle">
            <h2>System Intelligence · XAUUSD</h2>
            <span>Deterministic, advisory-only judgment. It cannot place orders.</span>
          </div>
          <strong className={verdictClass}>{intelligence?.verdict?.replaceAll("_", " ") ?? "WAITING FOR DATA"}</strong>
        </div>
        <div className="mxIntelBody">
          <div className="mxIntelGrid">
            <div className="mxIntelStat"><small>DIRECTION</small><strong>{intelligence?.direction ?? "—"}</strong></div>
            <div className="mxIntelStat"><small>CONFIDENCE</small><strong>{intelligence ? `${intelligence.confidence}%` : "—"}</strong></div>
            <div className="mxIntelStat"><small>REGIME</small><strong>{intelligence?.regime ?? "—"}</strong></div>
            <div className="mxIntelStat"><small>XAU − USD GAP</small><strong>{intelligence ? intelligence.strength_gap.toFixed(1) : "—"}</strong></div>
            <div className="mxIntelStat"><small>DATA QUALITY</small><strong>{intelligence ? `${intelligence.data_quality}%` : "—"}</strong></div>
            <div className="mxIntelStat"><small>STRONGEST</small><strong>{intelligence ? `${intelligence.strongest.currency} ${intelligence.strongest.score.toFixed(1)}` : "—"}</strong></div>
            <div className="mxIntelStat"><small>WEAKEST</small><strong>{intelligence ? `${intelligence.weakest.currency} ${intelligence.weakest.score.toFixed(1)}` : "—"}</strong></div>
            <div className="mxIntelStat"><small>ENGINE</small><strong>{intelligence?.engine ?? "—"}</strong></div>
          </div>
          <div className="mxIntelReason">{intelligence?.reason ?? "Waiting for enough MT5 matrix data to form a judgment."}</div>
          <div className="mxIntelRows">
            <div className="mxIntelList">
              <b>Evidence</b>
              <span>Supporting: {intelligence?.supporting_timeframes?.join(" · ") || "none"}</span><br />
              <span>Conflicting: {intelligence?.conflicting_timeframes?.join(" · ") || "none"}</span>
            </div>
            <div className="mxIntelList">
              <b>Risk controls</b>
              <span>{intelligence?.risk_flags?.map((flag) => flag.replaceAll("_", " ")).join(" · ") || "Waiting for assessment"}</span>
            </div>
          </div>
          {intelligence?.candidate_pairs?.length ? (
            <div className="mxIntelList">
              <b>Highest relative-strength FX candidates</b>
              <span>{intelligence.candidate_pairs.map((pair) => `${pair.symbol} ${pair.direction} (${pair.strength_gap.toFixed(1)})`).join(" · ")}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mxGrid">
        <div className="mxPanel">
          <div className="mxPanelHead">
            <h2>Live Tick Summary</h2>
            <span>Reference pairs for current movement</span>
          </div>
          <div className="mxTickerStrip">
            {snapshot?.symbols?.map((t) => {
              const sym = t.symbol;
              const precision = precisionFor(sym);
              const mid = Number(t.mid ?? 0);
              const prev = symPrevRef.current[sym] ?? mid;
              const delta = mid - prev;
              if (mid !== 0) symPrevRef.current[sym] = mid;
              const cls = delta >= 0 ? "mxUp" : "mxDown";
              return (
                <div className="mxCard" key={sym}>
                  <small>
                    {sym} · {t.source ?? "—"}
                  </small>
                  <strong>{mid.toFixed(precision)}</strong>
                  <em className={cls}>
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(precision)}
                  </em>
                </div>
              );
            }) ??
              (loading ? (
                <div className="mxMuted" style={{ padding: "12px" }}>
                  Waiting for feed…
                </div>
              ) : null)}
          </div>
        </div>

        <div className="mxStack">
          <div className="mxPanel">
            <div className="mxPanelHead">
              <h2>Top-Down Ranking</h2>
              <span>Follows the active HTF filter and sort direction</span>
            </div>
            <div className="mxMetrics">
              {ranked.map((item) => (
                <div className="mxMetric" key={item.currency}>
                  <strong>{item.currency}</strong>
                  <span className="mxMuted">
                    {item.signal} · HTF {item.htfStrength.toFixed(1)}
                  </span>
                </div>
              ))}
              {ranked.length === 0 && <div className="mxMuted" style={{ padding: "12px" }}>No data yet.</div>}
            </div>
          </div>

          <div className="mxPanel">
            <div className="mxPanelHead">
              <h2>Feed Status</h2>
              <span>Bridge diagnostics</span>
            </div>
            <div className="mxMetrics">
              <div className="mxMetric"><strong>Feed mode</strong><span className="mxMuted">{snapshot?.feed_source ?? "—"}</span></div>
              <div className="mxMetric"><strong>MT5 connected</strong><span className="mxMuted">{snapshot?.mt5_connected ? "YES" : "NO"}</span></div>
              <div className="mxMetric"><strong>Last update Lagos</strong><span className="mxMuted">{formatLagosTime(snapshot?.ts_display)}</span></div>
              <div className="mxMetric"><strong>XAU source</strong><span className="mxMuted">XAUUSD only</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
