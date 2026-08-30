"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

const CURRENCIES = ["AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU"] as const;
const TIMEFRAMES = ["TICK", "M1", "M5", "M15", "M30", "H1", "H4", "H6", "H8", "H12", "D1", "W1", "MN1"] as const;
const TICKER_PAIRS = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "XAUUSD"] as const;
type TickerPair = (typeof TICKER_PAIRS)[number];
type Currency = (typeof CURRENCIES)[number];
type Tf = (typeof TIMEFRAMES)[number];

const TICKER_BASE: Record<TickerPair, number> = {
  EURUSD: 1.0845,
  GBPUSD: 1.2716,
  USDJPY: 147.22,
  AUDUSD: 0.6648,
  USDCAD: 1.3562,
  USDCHF: 0.8913,
  XAUUSD: 2526.4
};

type PairState = { price: number; delta: number };

const seededValue = (row: number, col: number) => {
  const wave = Math.sin((row + 1) * 0.9 + col * 0.55) * 0.22;
  const bias = (row - 3.8) * 0.028 + (col - 6) * 0.012;
  return Number((wave + bias).toFixed(4));
};

const trendFromValue = (v: number) => (v > 0.045 ? "UP" : v < -0.045 ? "DOWN" : "FLAT");
const cellClass = (v: number) => (v > 0.02 ? "positive" : v < -0.02 ? "negative" : "neutral");

type Ranked = { currency: Currency; avg: number };

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
  .mxDot{ width:10px; height:10px; border-radius:50%; background:#48d976; box-shadow:0 0 10px rgba(72,217,118,0.9); }
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
  @media (max-width:1120px){ .mxGrid{ grid-template-columns:1fr; } }
  @media (prefers-reduced-motion: reduce){
    .mxTable td{ transition:none; }
  }
`;

export default function MarketMatrixPage({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const [state, setState] = useState<Record<Currency, Record<Tf, number>>>(() => {
    const s = {} as Record<Currency, Record<Tf, number>>;
    CURRENCIES.forEach((ccy, rIdx) => {
      s[ccy] = {} as Record<Tf, number>;
      TIMEFRAMES.forEach((tf, cIdx) => {
        s[ccy][tf] = seededValue(rIdx, cIdx);
      });
    });
    return s;
  });

  const [updated, setUpdated] = useState<Record<string, number>>({});
  const [pairState, setPairState] = useState<Record<TickerPair, PairState>>(() => {
    const o = {} as Record<TickerPair, PairState>;
    for (const p of TICKER_PAIRS) o[p] = { price: TICKER_BASE[p], delta: 0 };
    return o;
  });

  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const updatedCounterRef = useRef(0);
  const [refreshRate] = useState(1200);

  const ranked = useMemo<Ranked[]>(() => {
    return CURRENCIES.map((ccy) => {
      const avg = TIMEFRAMES.reduce((sum, tf) => sum + state[ccy][tf], 0) / TIMEFRAMES.length;
      return { currency: ccy, avg };
    })
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 6);
  }, [state]);

  useEffect(() => {
    let alive = true;
    const id = setInterval(() => {
      if (!alive) return;
      const xauDelta = pairState.XAUUSD.delta;
      const newState: Record<Currency, Record<Tf, number>> = {} as any;
      const nowUpdated: Record<string, number> = {};
      const tick = ++updatedCounterRef.current;
      const timeNow = Date.now();
      CURRENCIES.forEach((ccy, rIdx) => {
        newState[ccy] = {} as Record<Tf, number>;
        TIMEFRAMES.forEach((tf, cIdx) => {
          const cur = state[ccy][tf];
          const volatility =
            tf === "TICK" ? 0.045 : tf.startsWith("M") ? 0.03 : tf.startsWith("H") ? 0.022 : 0.016;
          const drift = Math.sin(timeNow / 6000 + rIdx * 0.7 + cIdx * 0.35) * 0.006;
          const noise = (Math.random() - 0.5) * volatility;
          const xauBias = ccy === "XAU" ? (xauDelta * 0.012) + Math.sin(timeNow / 3000 + cIdx) * 0.01 : 0;
          const next = Number((cur + drift + noise + xauBias).toFixed(4));
          newState[ccy][tf] = next;
          if (Math.abs(next - cur) >= 0.005) nowUpdated[`${ccy}:${tf}`] = tick;
        });
      });

      const nextPairs: Record<TickerPair, PairState> = {} as any;
      for (const p of TICKER_PAIRS) {
        const step = p === "XAUUSD" ? 1.1 : p.includes("JPY") ? 0.025 : 0.00035;
        const move = (Math.random() - 0.5) * step * 2;
        const prev = pairState[p];
        nextPairs[p] = { price: prev.price + move, delta: move };
      }

      setPairState(nextPairs);
      setState(newState);
      setUpdated(nowUpdated);
      setLastUpdate(new Date());
    }, refreshRate);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [state, pairState, refreshRate]);

  const currentTick = updatedCounterRef.current;

  return (
    <div className="mxPage" style={{ width: "min(1500px, calc(100% - 0px))", margin: "0 auto 36px" }}>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <div className="mxHero">
        <div>
          <h1>CACSMS Bullion Market Matrix</h1>
          <p>
            Download-ready matrix page for the bullion system. It includes `TICK`, `H6`, `H8`, `H12`, and an `XAU` row
            derived only from `XAUUSD`.
          </p>
        </div>
        <div className="mxToolbar">
          <div className="mxChip">
            <span className="mxDot" />
            <span>Realtime demo feed</span>
          </div>
          <div className="mxChip">
            Refresh <strong>{refreshRate}ms</strong>
          </div>
          <div className="mxChip">
            Last update <strong>{lastUpdate.toLocaleTimeString()}</strong>
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
                    const v = state[ccy][tf];
                    const cls = cellClass(v);
                    const isUpdated = updated[`${ccy}:${tf}`] === currentTick;
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
            {TICKER_PAIRS.map((pair) => {
              const precision = pair === "XAUUSD" ? 2 : pair.includes("JPY") ? 3 : 4;
              const ps = pairState[pair];
              const cls = ps.delta >= 0 ? "mxUp" : "mxDown";
              return (
                <div className="mxCard" key={pair}>
                  <small>{pair}</small>
                  <strong>{ps.price.toFixed(precision)}</strong>
                  <em className={cls}>
                    {ps.delta >= 0 ? "+" : ""}
                    {ps.delta.toFixed(precision)}
                  </em>
                </div>
              );
            })}
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
                    {item.avg >= 0 ? "+" : ""}
                    {item.avg.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mxPanel">
            <div className="mxPanelHead">
              <h2>Notes</h2>
              <span>Integration hints</span>
            </div>
            <div className="mxMetrics">
              <div className="mxCard">
                <small>XAU rule</small>
                <strong>`XAU` is driven from `XAUUSD` only</strong>
              </div>
              <div className="mxCard">
                <small>Feed swap</small>
                <strong>Replace the demo interval with your WebSocket or API layer</strong>
              </div>
              <div className="mxCard">
                <small>Companion page</small>
                <strong>Use the 24h history page for timestamp-first monitoring</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
