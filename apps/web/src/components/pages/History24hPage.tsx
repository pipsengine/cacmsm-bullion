"use client";

import React, { useEffect, useRef, useState } from "react";

const CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"] as const;
type Currency = (typeof CURRENCIES)[number];

const ROW_INTERVAL_MIN = 5;
const MAX_ROWS = 24 * 12; // 5-min intervals for 24 hours = 288 rows
const LIVE_REFRESH_MS = 1200;

type HistoryRow = {
  key: string;
  timestamp: Date;
  values: Record<Currency, number>;
  source: "SNAPSHOT" | "TICK";
  flashTick?: number;
};

const cellClass = (v: number) => (v > 0.02 ? "positive" : v < -0.02 ? "negative" : "neutral");
const signalText = (v: number) => (v > 0.045 ? "UP" : v < -0.045 ? "DOWN" : "FLAT");

const seededValue = (rowIdx: number, ccIdx: number) => {
  const wave = Math.sin(rowIdx * 0.26 + ccIdx * 0.9) * 0.18;
  const bias = (ccIdx - 4) * 0.02;
  return Number((wave + bias).toFixed(4));
};

const makeInitialRows = (): HistoryRow[] => {
  const now = Date.now();
  const rows: HistoryRow[] = [];
  for (let i = 0; i < MAX_ROWS; i++) {
    const ts = new Date(now - i * ROW_INTERVAL_MIN * 60 * 1000);
    const values = {} as Record<Currency, number>;
    CURRENCIES.forEach((ccy, ccIdx) => {
      let val = seededValue(i, ccIdx);
      if (ccy === "XAU") val = Number((val + Math.sin(i * 0.5) * 0.07).toFixed(4));
      values[ccy] = val;
    });
    rows.push({
      key: `${ts.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: ts,
      values,
      source: "SNAPSHOT"
    });
  }
  return rows;
};

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
  .h24Dot{ width:10px; height:10px; border-radius:50%; background:#48d976; box-shadow:0 0 10px rgba(72,217,118,0.9); }
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
  @media (prefers-reduced-motion: reduce){ .h24Table td{ transition:none; } }
`;

function formatTimestamp(d: Date) {
  return d.toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export default function History24hPage({ onOpenMatrix }: { onOpenMatrix?: () => void }) {
  const [rows, setRows] = useState<HistoryRow[]>(() => makeInitialRows());
  const [lastTick, setLastTick] = useState<Date>(() => new Date());
  const flashCounterRef = useRef(0);
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setRows((prev) => {
        const first = prev[0];
        const now = new Date();
        const nextValues = {} as Record<Currency, number>;
        CURRENCIES.forEach((ccy, idx) => {
          const cur = first.values[ccy];
          const volatility = ccy === "XAU" ? 0.06 : 0.035;
          const noise = (Math.random() - 0.5) * volatility;
          const drift = Math.sin(Date.now() / 4000 + idx * 0.8) * 0.005;
          nextValues[ccy] = Number((cur + drift + noise).toFixed(4));
        });
        const next: HistoryRow = {
          key: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: now,
          values: nextValues,
          source: "TICK",
          flashTick: ++flashCounterRef.current
        };
        const arr = [next, ...prev];
        if (arr.length > MAX_ROWS) arr.pop();
        return arr;
      });
      setLastTick(new Date());
      forceTick((x) => (x + 1) % 1_000_000);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const latestFlashId = flashCounterRef.current;

  return (
    <div className="h24Page" style={{ width: "min(1550px, calc(100% - 0px))", margin: "0 auto 36px" }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="h24Hero">
        <div>
          <h1>CACSMS Bullion 24h Tick History</h1>
          <p>
            24-hour rolling board with timestamp on the left, currencies as headers, newest ticks on top, and live
            color-coded updates. `XAU` is included as `XAUUSD`-based analysis.
          </p>
        </div>
        <div className="h24Toolbar">
          <div className="h24Chip">
            <span className="h24Dot" />
            <span>Realtime demo feed</span>
          </div>
          <div className="h24Chip">
            Window <strong>Last 24 hours</strong>
          </div>
          <div className="h24Chip">
            Rows <strong>{rows.length}</strong>
          </div>
          <div className="h24Chip">
            Last tick <strong>{lastTick.toLocaleTimeString()}</strong>
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

      <div className="h24Panel">
        <div className="h24PanelHead">
          <h2>Historical Tick Table</h2>
          <span>Latest row stays on top and older rows roll down through the 24-hour window</span>
        </div>
        <div className="h24TableWrap">
          <table className="h24Table">
            <thead>
              <tr>
                <th>Timestamp</th>
                {CURRENCIES.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isLatest = idx === 0;
                const cls = isLatest ? "h24Latest" : "";
                return (
                  <tr key={row.key} className={cls}>
                    <th scope="row">
                      {formatTimestamp(row.timestamp)}
                      <span className="h24Meta">{row.source}</span>
                    </th>
                    {CURRENCIES.map((ccy) => {
                      const v = row.values[ccy];
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
          Replace the simulated generator with your live feed and keep the same row insertion logic to preserve the
          24-hour view.
        </div>
      </div>
    </div>
  );
}
