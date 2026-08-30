"use client";

import React, { useEffect, useRef, useState } from "react";

const CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"] as const;
type Currency = (typeof CURRENCIES)[number];

const MAX_ROWS = 24 * 12;

type HistoryRow = {
  key: string;
  timestamp_utc?: string;
  timestamp_display?: string;
  values: Record<Currency, number>;
  source: string;
  flashTick?: number;
};

type HistoryResp = {
  ts_utc?: string;
  ts_display?: string;
  feed_source?: string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  history_hours?: number;
  row_interval_seconds?: number;
  currencies?: string[];
  rows?: HistoryRow[];
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

const cellClass = (v: number) => (v > 0.02 ? "positive" : v < -0.02 ? "negative" : "neutral");
const signalText = (v: number) => (v > 0.045 ? "UP" : v < -0.045 ? "DOWN" : "FLAT");

const STYLES = `
  .h24Page{ color:#edf4ff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .h24Hero{ display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .h24Hero h1{ margin:0; font-size:clamp(1.5rem, 2vw, 2.3rem); letter-spacing:0.04em; }
  .h24Hero p{ margin:8px 0 0; color:#91a5c9; max-width:900px; line-height:1.45; }
  .h24Toolbar{ display:flex; gap:10px; flex-wrap:wrap; }
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
    background:linear-gradient(180deg, rgba(26,41,66,0.92), rgba(12,22,39,0.96));
    border:1px solid #32456a; border-radius:18px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.28);
  }
  .h24PanelHead{
    display:flex; justify-content:space-between; gap:12px; padding:16px 18px;
    border-bottom:1px solid #32456a; background:rgba(255,255,255,0.025); flex-wrap:wrap;
  }
  .h24PanelHead h2{ margin:0; font-size:1rem; letter-spacing:0.04em; }
  .h24PanelHead span{ color:#91a5c9; font-size:0.92rem; }
  .h24TableWrap{ overflow:auto; max-height:calc(100vh - 220px); }
  .h24Table{
    width:100%; min-width:1150px; border-collapse:separate; border-spacing:0;
  }
  .h24Table thead th{
    position:sticky; top:0; z-index:3; background:#d9e7f0; color:#10203e;
    padding:12px 10px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    text-transform:uppercase; font-size:0.84rem; letter-spacing:0.05em; white-space:nowrap;
  }
  .h24Table thead th:first-child{ left:0; position:sticky; z-index:4; }
  .h24Table tbody th{
    position:sticky; left:0; z-index:2; background:#d9e7f0; color:#10203e;
    padding:12px 12px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    text-align:left; min-width:172px; font-size:0.92rem;
  }
  .h24Table td{
    min-width:92px; padding:11px 8px; text-align:center;
    border-right:1px solid rgba(255,255,255,0.08); border-bottom:1px solid rgba(255,255,255,0.08);
    font-variant-numeric:tabular-nums;
    transition: background-color 180ms ease, box-shadow 180ms ease;
  }
  .h24Latest td, .h24Latest th{ box-shadow:inset 0 0 0 1px rgba(255,255,255,0.3); }
  .h24TdPositive{ background:linear-gradient(180deg, rgba(30,150,72,0.96), rgba(16,106,44,0.98)); }
  .h24TdNegative{ background:linear-gradient(180deg, rgba(212,63,63,0.96), rgba(134,23,23,0.98)); }
  .h24TdNeutral{ background:linear-gradient(180deg, rgba(87,105,136,0.92), rgba(59,72,102,0.96)); }
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
  @media (prefers-reduced-motion: reduce){ .h24Table td{ transition:none; } }
`;

function formatTimestamp(ts?: string): string {
  if (!ts) return "-";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
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

export default function History24hPage({ onOpenMatrix }: { onOpenMatrix?: () => void }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const flashCounterRef = useRef(0);
  const rowIntervalRef = useRef<number>(300);

  useEffect(() => {
    let alive = true;
    let poll: ReturnType<typeof setInterval> | null = null;

    async function fetchAll() {
      try {
        const [histRes, statusRes] = await Promise.all([
          fetch("/api/market/history?hours=24", { cache: "no-store" }),
          fetch("/api/market/status", { cache: "no-store" }),
        ]);
        if (!histRes.ok) throw new Error(`history HTTP ${histRes.status}`);
        if (!statusRes.ok) throw new Error(`status HTTP ${statusRes.status}`);
        const hist = (await histRes.json()) as HistoryResp;
        const stat = (await statusRes.json()) as StatusResp;
        if (!alive) return;
        rowIntervalRef.current = Number(hist.row_interval_seconds ?? 300);
        flashCounterRef.current += 1;
        const flash = flashCounterRef.current;
        const nextRows = (hist.rows ?? []).slice(0, MAX_ROWS).map((r, i) => ({
          ...r,
          values: normalizeValues(r.values),
          flashTick: i === 0 ? flash : undefined,
        }));
        setRows(nextRows);
        setStatus(stat);
        setError(null);
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load history");
        setLoading(false);
      }
    }

    fetchAll();
    poll = setInterval(fetchAll, 1500);

    return () => {
      alive = false;
      if (poll) clearInterval(poll);
    };
  }, []);

  const feedBadgeKind = (() => {
    if (!status) return { label: "LOADING", kind: "warn" as const };
    if (status.mt5_connected) return { label: "MT5 LIVE", kind: "ok" as const };
    if (status.feed_source === "MT5" && !status.mt5_connected) return { label: "MT5 RECONNECTING", kind: "warn" as const };
    if (status.feed_source === "SIM") return { label: "SIM FALLBACK", kind: "warn" as const };
    return { label: "OFFLINE", kind: "err" as const };
  })();

  const latestFlashId = flashCounterRef.current;

  return (
    <div className="h24Page" style={{ width: "min(1550px, calc(100% - 0px))", margin: "0 auto 36px" }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="h24Hero">
        <div>
          <h1>CACSMS Bullion 24h Tick History</h1>
          <p>
            24-hour rolling board with 5-minute aggregated buckets. Newest row on top. All timestamps are Africa/Lagos.
            XAU column is derived exclusively from XAUUSD.
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

      {status?.feed_source === "SIM" && (
        <div className="h24Banner">
          MT5 is not connected; data is generated locally by the simulator. Pages will auto-resume when MT5 bridge
          reconnects.
          {status.mt5_error ? ` — ${status.mt5_error}` : ""}
        </div>
      )}
      {error && rows.length === 0 && <div className="h24Banner h24BannerErr">Market feed unreachable: {error}</div>}

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
                        <td key={ccy} className={clsName}>
                          {v >= 0 ? "+" : ""}
                          {v.toFixed(4)}
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
          Row aggregation interval: {rowIntervalRef.current / 60} minutes · History window: {status?.history_hours ?? 24}h
          · Feed source: {status?.feed_source ?? "—"} · Missing symbols: {status?.missing_symbols?.length ?? 0}
        </div>
      </div>
    </div>
  );
}
