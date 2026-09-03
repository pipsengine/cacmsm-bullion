"use client";

import React, { useEffect, useRef, useState } from "react";

const CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"] as const;
type Currency = (typeof CURRENCIES)[number];

const MAX_ROWS = 1000;
const POLL_ROWS = 40;
const POLL_INTERVAL_MS = 1500;
const STATUS_INTERVAL_MS = 10_000;

type HistoryRow = {
  key: string;
  timestamp_utc?: string;
  timestamp_display?: string;
  values: Record<Currency, number>;
  source: string;
  flashTick?: number;
};

type HistoryIntelligence = {
  engine: string;
  advisory_only: boolean;
  verdict: "PERSISTENT" | "DEVELOPING" | "REVERSAL" | "NEUTRAL" | "INSUFFICIENT_DATA" | string;
  symbol?: string;
  direction: "BUY" | "SELL" | "NEUTRAL" | string;
  confidence: number;
  samples: number;
  persistence_percent?: number;
  current_gap?: number;
  gap_change?: number;
  strongest?: { currency: string; score: number };
  weakest?: { currency: string; score: number };
  risk_flags: string[];
  reason: string;
};

type HistoryResp = {
  ts_utc?: string;
  ts_display?: string;
  feed_source?: string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  history_hours?: number;
  row_interval_seconds?: number | null;
  sampling?: string;
  value_unit?: string;
  row_limit?: number;
  currencies?: string[];
  rows?: HistoryRow[];
  intelligence?: HistoryIntelligence;
};

type StatusResp = {
  ts_utc?: string;
  ts_display?: string;
  feed_mode?: string;
  feed_source?: string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  missing_symbols?: string[];
  last_tick_seconds_ago?: number | null;
  history_hours?: number;
};

const cellClass = (v: number) => (v >= 70 ? "positive" : v <= 30 ? "negative" : "neutral");
const signalText = (v: number) => (v >= 70 ? "STRONG" : v <= 30 ? "WEAK" : "NEUTRAL");

const STYLES = `
  .h24Page{ width:100%; min-width:0; color:#edf4ff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .h24Hero{ display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .h24Hero h1{ margin:0; font-size:clamp(1.5rem, 2vw, 2.3rem); letter-spacing:0.04em; }
  .h24Hero p{ margin:8px 0 0; color:#91a5c9; max-width:900px; line-height:1.45; }
  .h24Toolbar{ display:flex; gap:10px; flex-wrap:wrap; max-width:100%; }
  .h24Chip, .h24NavLink{
    display:inline-flex; align-items:center; gap:8px;
    padding:10px 14px; border-radius:999px; border:1px solid #32456a;
    background:rgba(16,27,46,0.92); color:#edf4ff; text-decoration:none;
    box-shadow:0 12px 30px rgba(0,0,0,0.28); font-size:0.92rem; font-weight:600;
  }
  .h24NavLink:hover{ border-color:#6785bf; cursor:pointer; }
  .h24ChipOk{ border-color:#2a7a48; }
  .h24ChipWarn{ border-color:#a87a1a; }
  .h24ChipErr{ border-color:#a22; }
  .h24Dot{ width:10px; height:10px; border-radius:50%; background:#48d976; box-shadow:0 0 10px rgba(72,217,118,0.9); }
  .h24DotWarn{ background:#f5c24a; box-shadow:0 0 10px rgba(245,194,74,0.9); }
  .h24DotErr{ background:#ef5350; box-shadow:0 0 10px rgba(239,83,80,0.9); }
  .h24Panel{
    width:100%; min-width:0;
    background:linear-gradient(180deg, rgba(26,41,66,0.92), rgba(12,22,39,0.96));
    border:1px solid #32456a; border-radius:18px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.28);
  }
  .h24PanelHead{
    display:flex; justify-content:space-between; gap:12px; padding:16px 18px;
    border-bottom:1px solid #32456a; background:rgba(255,255,255,0.025); flex-wrap:wrap;
  }
  .h24PanelHead h2{ margin:0; font-size:1rem; letter-spacing:0.04em; }
  .h24PanelHead span{ color:#91a5c9; font-size:0.92rem; }
  .h24TableWrap{ width:100%; min-width:0; overflow-x:hidden; overflow-y:auto; max-height:calc(100vh - 220px); }
  .h24Table{
    width:100%; min-width:0; table-layout:fixed; border-collapse:separate; border-spacing:0;
  }
  .h24Table thead th:first-child{ width:18%; }
  .h24Table thead th{
    position:sticky; top:0; z-index:3; background:#d9e7f0; color:#10203e;
    padding:12px clamp(3px, 0.65vw, 10px); border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    text-transform:uppercase; font-size:clamp(0.62rem, 0.8vw, 0.84rem); letter-spacing:0.04em; white-space:nowrap;
  }
  .h24Table thead th:first-child{ left:0; position:sticky; z-index:4; }
  .h24Table tbody th{
    position:sticky; left:0; z-index:2; background:#d9e7f0; color:#10203e;
    padding:12px 12px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    text-align:left; min-width:0; font-size:clamp(0.68rem, 0.85vw, 0.92rem); overflow-wrap:anywhere;
  }
  .h24Table td{
    min-width:0; padding:11px clamp(2px, 0.5vw, 8px); text-align:center;
    border-right:1px solid rgba(255,255,255,0.08); border-bottom:1px solid rgba(255,255,255,0.08);
    font-variant-numeric:tabular-nums;
    transition: background-color 180ms ease, box-shadow 180ms ease;
  }
  .h24Latest td, .h24Latest th{ box-shadow:inset 0 0 0 1px rgba(255,255,255,0.3); }
  .h24TdPositive{ background:linear-gradient(180deg, rgba(30,150,72,0.96), rgba(16,106,44,0.98)); }
  .h24TdNegative{ background:linear-gradient(180deg, rgba(212,63,63,0.96), rgba(134,23,23,0.98)); }
  .h24TdNeutral{ background:linear-gradient(180deg, rgba(196,137,25,0.96), rgba(126,82,12,0.98)); }
  .h24TdFlash{ box-shadow:inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 2px rgba(126,178,255,0.28); }
  .h24Meta{ display:block; margin-top:4px; font-size:0.68rem; opacity:0.9; letter-spacing:0.05em; }
  .h24Footer{ padding:14px 18px 18px; color:#91a5c9; font-size:0.88rem; }
  .h24Banner{
    padding:12px 16px; border-radius:12px; margin-bottom:14px;
    border:1px solid #a87a1a; background:rgba(210,160,60,0.12); color:#ffd88a;
    font-size:0.92rem;
  }
  .h24BannerErr{
    border-color:#a22; background:rgba(220,70,70,0.12); color:#ff9e9e;
  }
  .h24Intel{ margin-bottom:18px; }
  .h24IntelBody{ padding:16px 18px 18px; display:grid; gap:14px; }
  .h24IntelGrid{ display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px; }
  .h24IntelStat{ padding:12px 14px; border-radius:13px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.07); }
  .h24IntelStat small{ display:block; color:#91a5c9; margin-bottom:5px; font-size:0.68rem; font-weight:800; letter-spacing:0.06em; }
  .h24IntelReason{ padding:12px 14px; border-radius:12px; background:rgba(11,21,38,0.7); line-height:1.5; }
  .h24IntelRisks{ color:#91a5c9; font-size:0.82rem; }
  .h24VerdictGood{ color:#65ea8b; }
  .h24VerdictCaution{ color:#ffd26a; }
  .h24VerdictRisk{ color:#ff8282; }
  @media (max-width:1100px){
    .h24Hero{ align-items:flex-start; }
    .h24Toolbar{ width:100%; }
    .h24Chip, .h24NavLink{ padding:8px 10px; font-size:0.78rem; }
    .h24Table thead th:first-child{ width:19%; }
    .h24Table tbody th{ padding:10px 8px; }
    .h24Meta{ font-size:0.58rem; }
    .h24IntelGrid{ grid-template-columns:repeat(3,minmax(0,1fr)); }
  }
  @media (max-width:760px){
    .h24Hero h1{ font-size:1.35rem; }
    .h24Hero p{ font-size:0.86rem; }
    .h24Toolbar{ display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); }
    .h24Chip, .h24NavLink{ min-width:0; justify-content:center; text-align:center; border-radius:12px; box-shadow:none; }
    .h24PanelHead{ padding:13px 14px; }
    .h24PanelHead span{ font-size:0.78rem; }
    .h24TableWrap{ max-height:none; padding:10px; }
    .h24Table, .h24Table tbody{ display:block; width:100%; }
    .h24Table thead{ display:none; }
    .h24Table tbody{ display:grid; gap:10px; }
    .h24Table tbody tr{
      display:grid; grid-template-columns:repeat(3, minmax(0, 1fr));
      overflow:hidden; border:1px solid rgba(255,255,255,0.12); border-radius:12px;
    }
    .h24Table tbody th{
      position:static; grid-column:1 / -1; width:auto; padding:10px 12px;
      border-right:0; font-size:0.78rem;
    }
    .h24Table td{
      display:flex; min-width:0; padding:9px 4px; align-items:center; justify-content:center;
      flex-direction:column; font-size:0.82rem;
    }
    .h24Table td::before{
      content:attr(data-currency); display:block; margin-bottom:3px;
      font-size:0.62rem; font-weight:900; letter-spacing:0.08em; opacity:0.88;
    }
    .h24Latest td, .h24Latest th{ box-shadow:none; }
    .h24Latest{ outline:1px solid rgba(126,178,255,0.65); }
    .h24Footer{ padding:12px 14px 16px; font-size:0.76rem; line-height:1.5; }
    .h24IntelGrid{ grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (max-width:420px){
    .h24Toolbar{ grid-template-columns:1fr; }
    .h24Table tbody tr{ grid-template-columns:repeat(2, minmax(0, 1fr)); }
  }
  @media (prefers-reduced-motion: reduce){ .h24Table td{ transition:none; } }
`;

function formatTimestamp(ts?: string): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString("en-GB", {
      timeZone: "Africa/Lagos",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function normalizeValues(v?: Record<string, number> | null): Record<Currency, number> {
  const out = {} as Record<Currency, number>;
  for (const c of CURRENCIES) out[c] = Number(v?.[c] ?? 0) || 0;
  return out;
}

function asPercentages(v?: Record<string, number> | null, alreadyPercent = false): Record<Currency, number> {
  const values = normalizeValues(v);
  if (alreadyPercent) {
    for (const c of CURRENCIES) values[c] = Math.max(0, Math.min(100, values[c]));
    return values;
  }
  const raw = CURRENCIES.map((c) => values[c]);
  const low = Math.min(...raw);
  const high = Math.max(...raw);
  if (Math.abs(high - low) < 1e-12) {
    for (const c of CURRENCIES) values[c] = 50;
    return values;
  }
  const lowCount = raw.filter((value) => Math.abs(value - low) < 1e-12).length;
  const highCount = raw.filter((value) => Math.abs(value - high) < 1e-12).length;
  for (const c of CURRENCIES) {
    const rawValue = values[c];
    let percentage = ((rawValue - low) / (high - low)) * 100;
    if (lowCount > 1 && Math.abs(rawValue - low) < 1e-12) percentage = 0.1;
    if (highCount > 1 && Math.abs(rawValue - high) < 1e-12) percentage = 99.9;
    percentage = Math.round(percentage * 10) / 10;
    if (percentage <= 0 && !(lowCount === 1 && Math.abs(rawValue - low) < 1e-12)) percentage = 0.1;
    if (percentage >= 100 && !(highCount === 1 && Math.abs(rawValue - high) < 1e-12)) percentage = 99.9;
    values[c] = percentage;
  }
  return values;
}

export default function History24hPage({ onOpenMatrix }: { onOpenMatrix?: () => void }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intelligence, setIntelligence] = useState<HistoryIntelligence | null>(null);
  const flashCounterRef = useRef(0);
  const initialHistoryLoadedRef = useRef(false);
  const [historyMeta, setHistoryMeta] = useState<Pick<HistoryResp, "sampling" | "value_unit" | "row_limit">>({});

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setTimeout> | null = null;
    let lastStatusFetch = 0;

    async function fetchAll(initial = false) {
      try {
        const now = Date.now();
        const shouldFetchStatus = initial || now - lastStatusFetch >= STATUS_INTERVAL_MS;
        const fullLoad = initial || !initialHistoryLoadedRef.current;
        const historyLimit = fullLoad ? MAX_ROWS : POLL_ROWS;
        const [histRes, statusRes] = await Promise.all([
          fetch(`/api/market/history?hours=24&limit=${historyLimit}`, { cache: "no-store" }),
          shouldFetchStatus ? fetch("/api/market/status", { cache: "no-store" }) : Promise.resolve(null),
        ]);
        if (!histRes.ok) throw new Error(`history HTTP ${histRes.status}`);
        if (statusRes && !statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
        const hist = (await histRes.json()) as HistoryResp;
        const stat = statusRes ? (await statusRes.json()) as StatusResp : null;
        if (!alive) return;
        flashCounterRef.current += 1;
        const flash = flashCounterRef.current;
        const incomingRows = (hist.rows ?? []).map((r, i) => ({
          ...r,
          values: asPercentages(r.values, hist.value_unit === "percent"),
          flashTick: i === 0 ? flash : undefined,
        }));
        setRows((current) => {
          if (fullLoad) return incomingRows.slice(0, MAX_ROWS);
          const byKey = new Map(current.map((row) => [row.key, row]));
          for (const row of incomingRows) byKey.set(row.key, row);
          return [...byKey.values()]
            .sort((left, right) => Date.parse(right.timestamp_utc ?? "") - Date.parse(left.timestamp_utc ?? ""))
            .slice(0, MAX_ROWS);
        });
        initialHistoryLoadedRef.current = true;
        setIntelligence(hist.intelligence ?? null);
        setHistoryMeta((current) => ({
          sampling: hist.sampling,
          value_unit: hist.value_unit,
          row_limit: fullLoad ? hist.row_limit : current.row_limit,
        }));
        if (stat) {
          setStatus(stat);
          lastStatusFetch = now;
        }
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load history");
        setLoading(false);
      } finally {
        if (alive) poll = setTimeout(() => fetchAll(false), POLL_INTERVAL_MS);
      }
    }

    fetchAll(true);

    return () => {
      alive = false;
      if (poll) clearTimeout(poll);
    };
  }, []);

  const feedBadgeKind = (() => {
    if (!status) return { label: "LOADING", kind: "warn" as const };
    if (status.mt5_connected) return { label: "MT5 LIVE", kind: "ok" as const };
    if (status.feed_source === "MT5" && !status.mt5_connected) return { label: "MT5 RECONNECTING", kind: "warn" as const };
    return { label: "OFFLINE", kind: "err" as const };
  })();

  const latestFlashId = flashCounterRef.current;
  const verdictClass = intelligence?.verdict === "PERSISTENT"
    ? "h24VerdictGood"
    : intelligence?.verdict === "REVERSAL" || intelligence?.verdict === "INSUFFICIENT_DATA"
      ? "h24VerdictRisk"
      : "h24VerdictCaution";

  return (
    <div className="h24Page" style={{ maxWidth: 1550, margin: "0 auto 36px" }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="h24Hero">
        <div>
          <h1>CACSMS Bullion 24h Tick History</h1>
          <p>
            MT5-only relative strength from 0 to 100 for each meaningful strength change in the 24-hour window. Newest row on top.
            All timestamps include seconds and use Africa/Lagos. FX strength uses the available 28-pair basket; XAU uses XAUUSD.
          </p>
        </div>
        <div className="h24Toolbar">
          <div
            className={`h24Chip ${
              feedBadgeKind.kind === "ok"
                ? "h24ChipOk"
                : feedBadgeKind.kind === "warn"
                  ? "h24ChipWarn"
                  : "h24ChipErr"
            }`}
          >
            <span
              className={`h24Dot ${
                feedBadgeKind.kind === "ok"
                  ? ""
                  : feedBadgeKind.kind === "warn"
                    ? "h24DotWarn"
                    : "h24DotErr"
              }`}
            />
            <span>{feedBadgeKind.label}</span>
          </div>
          <div className="h24Chip">
            Window <strong>Last 24 hours</strong>
          </div>
          <div className="h24Chip">
            Rows <strong>{rows.length}</strong>
          </div>
          <div className="h24Chip">
            Last status (Lagos) <strong>{formatTimestamp(status?.ts_display)}</strong>
          </div>
          {onOpenMatrix ? (
            <button type="button" onClick={onOpenMatrix} className="h24NavLink">
              Open matrix page
            </button>
          ) : (
            <a href="/market/matrix" className="h24NavLink">
              Open matrix page
            </a>
          )}
        </div>
      </div>

      {status && !status.mt5_connected && (
        <div className="h24Banner h24BannerErr">
          MT5 is disconnected. No substitute or simulated market data will be generated.
          {status.mt5_error ? ` — ${status.mt5_error}` : ""}
        </div>
      )}
      {error && rows.length === 0 && <div className="h24Banner h24BannerErr">Market feed unreachable: {error}</div>}

      <div className="h24Panel h24Intel">
        <div className="h24PanelHead">
          <div>
            <h2>System Intelligence · Persistence</h2>
            <span>Advisory-only analysis of changed XAUUSD strength snapshots</span>
          </div>
          <strong className={verdictClass}>{intelligence?.verdict?.replaceAll("_", " ") ?? "WAITING FOR DATA"}</strong>
        </div>
        <div className="h24IntelBody">
          <div className="h24IntelGrid">
            <div className="h24IntelStat"><small>DIRECTION</small><strong>{intelligence?.direction ?? "—"}</strong></div>
            <div className="h24IntelStat"><small>CONFIDENCE</small><strong>{intelligence ? `${intelligence.confidence}%` : "—"}</strong></div>
            <div className="h24IntelStat"><small>PERSISTENCE</small><strong>{intelligence?.persistence_percent != null ? `${intelligence.persistence_percent}%` : "—"}</strong></div>
            <div className="h24IntelStat"><small>CURRENT GAP</small><strong>{intelligence?.current_gap?.toFixed(1) ?? "—"}</strong></div>
            <div className="h24IntelStat"><small>GAP CHANGE</small><strong>{intelligence?.gap_change != null ? `${intelligence.gap_change >= 0 ? "+" : ""}${intelligence.gap_change.toFixed(1)}` : "—"}</strong></div>
            <div className="h24IntelStat"><small>SAMPLES</small><strong>{intelligence?.samples ?? 0}</strong></div>
          </div>
          <div className="h24IntelReason">{intelligence?.reason ?? "Waiting for enough history to assess persistence."}</div>
          <div className="h24IntelRisks">
            Risk flags: {intelligence?.risk_flags?.map((flag) => flag.replaceAll("_", " ")).join(" · ") || "none detected by the available market data"}
          </div>
        </div>
      </div>

      <div className="h24Panel">
        <div className="h24PanelHead">
          <h2>Historical Tick Table</h2>
          <span>Latest row stays on top and older rows roll down through the 24-hour window</span>
        </div>
        <div className="h24TableWrap">
          <table className="h24Table">
            <thead>
              <tr>
                <th>Timestamp (Lagos)</th>
                {CURRENCIES.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <th scope="row">{loading ? "Loading feed…" : "No data yet"}</th>
                  {CURRENCIES.map((c) => (
                    <td key={c} className="h24TdNeutral">
                      <span className="h24Meta">—</span>
                    </td>
                  ))}
                </tr>
              )}
              {rows.map((row, idx) => {
                const isLatest = idx === 0;
                const cls = isLatest ? "h24Latest" : "";
                return (
                  <tr key={row.key} className={cls}>
                    <th scope="row">
                      {formatTimestamp(row.timestamp_display ?? row.timestamp_utc)}
                      <span className="h24Meta">{row.source}</span>
                    </th>
                    {CURRENCIES.map((ccy) => {
                      const v = row.values?.[ccy] ?? 0;
                      const c = cellClass(v);
                      const clsName =
                        (c === "positive"
                          ? "h24TdPositive"
                          : c === "negative"
                            ? "h24TdNegative"
                            : "h24TdNeutral") +
                        (row.flashTick === latestFlashId && isLatest ? " h24TdFlash" : "");
                      return (
                        <td key={ccy} className={clsName} data-currency={ccy}>
                          {v.toFixed(1)}
                          <span className="h24Meta">{signalText(v)}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="h24Footer">
          Sampling: {historyMeta.sampling === "strength_change" ? "changed strength values" : "per MT5 feed update"} · Values: standardized relative strength score
          · Showing latest {rows.length} changes (display limit {historyMeta.row_limit ?? MAX_ROWS}) from the retained {status?.history_hours ?? 24}h window
          · Feed source: MT5 only · Missing symbols: {status?.missing_symbols?.length ?? 0}
        </div>
      </div>
    </div>
  );
}
