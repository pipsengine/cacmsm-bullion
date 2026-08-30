"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"] as const;
const TIMEFRAMES = ["TICK", "M1", "M5", "M15", "M30", "H1", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"] as const;

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

type MatrixRow = { currency: Currency; values: Record<Tf, number> };

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
};

const trendFromValue = (v: number) => (v > 0.045 ? "UP" : v < -0.045 ? "DOWN" : "FLAT");
const cellClass = (v: number) => (v > 0.02 ? "positive" : v < -0.02 ? "negative" : "neutral");

const STYLES = `
  .mxPage{ color:#ecf3ff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .mxHero{ display:flex; justify-content:space-between; align-items:flex-end; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
  .mxHero h1{ margin:0; font-size:clamp(1.6rem, 2.2vw, 2.4rem); letter-spacing:0.04em; }
  .mxHero p{ margin:8px 0 0; color:#91a5c9; max-width:880px; line-height:1.45; }
  .mxToolbar{ display:flex; flex-wrap:wrap; gap:10px; }
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
    background:linear-gradient(180deg, rgba(26,41,66,0.92), rgba(12,22,39,0.96));
    border:1px solid #32456a; border-radius:18px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.28);
  }
  .mxPanelHead{
    display:flex; justify-content:space-between; gap:12px; padding:16px 18px;
    border-bottom:1px solid #32456a; background:rgba(255,255,255,0.025); flex-wrap:wrap;
  }
  .mxPanelHead h2{ margin:0; font-size:1rem; letter-spacing:0.04em; }
  .mxPanelHead span{ color:#91a5c9; font-size:0.92rem; }
  .mxTableWrap{ overflow:auto; }
  .mxTable{ width:100%; min-width:1180px; border-collapse:separate; border-spacing:0; }
  .mxTable thead th{
    position:sticky; top:0; z-index:3; background:#d9e7f0; color:#10203e;
    padding:12px 10px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    text-transform:uppercase; font-size:0.86rem; letter-spacing:0.05em; white-space:nowrap;
  }
  .mxTable thead th:first-child{ left:0; position:sticky; z-index:4; }
  .mxTable tbody th{
    position:sticky; left:0; z-index:2; background:#d9e7f0; color:#10203e;
    padding:14px 12px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6;
    min-width:96px; text-align:left;
  }
  .mxTable td{
    min-width:92px; text-align:center; padding:12px 8px;
    border-right:1px solid rgba(255,255,255,0.08); border-bottom:1px solid rgba(255,255,255,0.08);
    font-variant-numeric:tabular-nums; transition:transform 180ms ease, box-shadow 180ms ease;
  }
  .mxTdPositive{ background:linear-gradient(180deg, rgba(30,150,72,0.96), rgba(16,106,44,0.98)); }
  .mxTdNegative{ background:linear-gradient(180deg, rgba(212,63,63,0.96), rgba(134,23,23,0.98)); }
  .mxTdNeutral{ background:linear-gradient(180deg, rgba(87,105,136,0.92), rgba(59,72,102,0.96)); }
  .mxTdUpdated{ transform:scale(1.02); box-shadow:inset 0 0 0 1px rgba(255,255,255,0.5), 0 0 0 2px rgba(117,168,255,0.3); }
  .mxValue{ display:block; font-weight:700; font-size:1rem; }
  .mxSignal{ display:block; margin-top:4px; font-size:0.72rem; letter-spacing:0.06em; opacity:0.92; }
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
  @media (max-width:1120px){ .mxGrid{ grid-template-columns:1fr; } }
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

export default function MarketMatrixPage({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Record<string, number>>({});
  const tickRef = useRef(0);
  const prevMatrixRef = useRef<Record<Currency, Record<Tf, number>>>(EMPTY_MATRIX);
  const symPrevRef = useRef<Record<string, number>>({});

  const matrixState: Record<Currency, Record<Tf, number>> = useMemo(() => {
    if (!snapshot?.matrix_rows) return prevMatrixRef.current;
    const out = { ...prevMatrixRef.current };
    for (const row of snapshot.matrix_rows) {
      out[row.currency as Currency] = row.values as Record<Tf, number>;
    }
    return out;
  }, [snapshot]);

  useEffect(() => {
    prevMatrixRef.current = matrixState;
  }, [matrixState]);

  const symbolsByKey: Record<string, SymbolTick> = useMemo(() => {
    const out: Record<string, SymbolTick> = {};
    for (const s of snapshot?.symbols ?? []) out[s.symbol] = s;
    return out;
  }, [snapshot]);

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
            if (Math.abs(next - prev) >= 0.005) nowUpdated[`${c}:${tf}`] = tick;
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
    if (snapshot.feed_source === "SIM") return { label: "SIM FALLBACK", kind: "warn" as const };
    return { label: "OFFLINE", kind: "err" as const };
  })();

  const ranked = snapshot?.ranked_bias?.slice(0, 6) ?? [];

  return (
    <div className="mxPage" style={{ width: "min(1500px, calc(100% - 0px))", margin: "0 auto 36px" }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="mxHero">
        <div>
          <h1>CACSMS Bullion Market Matrix</h1>
          <p>
            Live strength matrix across 9 currencies and 13 timeframes. XAU row is derived exclusively from XAUUSD. All
            timestamps are rendered in Africa/Lagos.
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
            Total ticks <strong>{snapshot?.total_ticks ?? 0}</strong>
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

      {snapshot?.feed_source === "SIM" && (
        <div className="mxBanner">
          MT5 is not connected. Running on internal SIMULATOR fallback. Pages will auto-resume when MT5 bridge reconnects.
          {snapshot.mt5_error ? ` — ${snapshot.mt5_error}` : ""}
        </div>
      )}
      {error && !snapshot && (
        <div className="mxBanner mxBannerErr">Market feed unreachable: {error}</div>
      )}

      <div className="mxPanel">
        <div className="mxPanelHead">
          <h2>Strength Matrix</h2>
          <span>Rows: currencies plus XAU | Columns: realtime and timeframe analysis</span>
        </div>
        <div className="mxTableWrap">
          <table className="mxTable">
            <thead>
              <tr>
                <th>Currency</th>
                {TIMEFRAMES.map((tf) => (
                  <th key={tf}>{tf}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CURRENCIES.map((ccy) => (
                <tr key={ccy}>
                  <th scope="row">{ccy}</th>
                  {TIMEFRAMES.map((tf) => {
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
                      <td key={tf} className={clsName}>
                        <span className="mxValue">
                          {v >= 0 ? "+" : ""}
                          {v.toFixed(4)}
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
              <h2>Strongest Bias</h2>
              <span>Current matrix average</span>
            </div>
            <div className="mxMetrics">
              {ranked.map((item) => (
                <div className="mxMetric" key={item.currency}>
                  <strong>{item.currency}</strong>
                  <span className="mxMuted">
                    {item.avg_bias >= 0 ? "+" : ""}
                    {item.avg_bias.toFixed(4)}
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
