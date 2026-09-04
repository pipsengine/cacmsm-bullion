"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type DecisionAction = "BUY" | "SELL" | "NO_TRADE" | "FLAT" | string;
type BiasPoint = { tf?: string; bias?: string; confidence?: number; regime?: string; updated_at?: string };
type Decision = {
  id?: string;
  ts?: string;
  createdAt?: string;
  symbol?: string;
  action?: DecisionAction;
  side?: DecisionAction;
  reason?: string;
  confidence?: number;
  size?: number;
  qty?: number;
  stop_pips?: number;
  take_pips?: number;
  bias?: BiasPoint[];
};
type DecisionResponse = { ok?: boolean; status?: string; provider?: string; reason?: string; items?: Decision[]; decisions?: Decision[] };
type ControlStatus = { ok?: boolean; provider?: string; reason?: string; running?: boolean; kill?: boolean; status?: string; mode?: string | { active?: string } };
type MonitoringSummary = { ok?: boolean; provider?: string; last_decision_age_ms?: number | null; notes?: string[] };
type MarketSnapshot = {
  mt5_connected?: boolean;
  feed_source?: string;
  symbols?: Array<{ symbol: string; bid?: number; ask?: number; ts_utc?: string }>;
  intelligence?: { verdict?: string; direction?: string; confidence?: number; regime?: string; reason?: string; risk_flags?: string[] };
};
type ActionFilter = "ALL" | "ACTIONABLE" | "BUY" | "SELL" | "NO_TRADE";

function actionOf(decision: Decision) {
  return String(decision.action ?? decision.side ?? "UNKNOWN").toUpperCase();
}

function confidenceOf(decision: Decision) {
  const value = Number(decision.confidence);
  if (!Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function timestampOf(decision: Decision) {
  return decision.ts ?? decision.createdAt;
}

function time(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

function age(value: string | undefined, now: number) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
}

function modeOf(mode: ControlStatus["mode"]) {
  if (typeof mode === "string") return mode.toUpperCase();
  return mode?.active?.toUpperCase() ?? "—";
}

function actualItems(response: DecisionResponse | null) {
  if (!response || response.ok === false || response.provider === "web-fallback") return [];
  return Array.isArray(response.items) ? response.items : Array.isArray(response.decisions) ? response.decisions : [];
}

function decisionKey(decision: Decision, index: number) {
  return decision.id ?? `${timestampOf(decision) ?? "decision"}-${decision.symbol ?? "unknown"}-${index}`;
}

function stateClass(action: string) {
  if (action === "BUY") return "dqBuy";
  if (action === "SELL") return "dqSell";
  return "dqNeutral";
}

function downloadCsv(rows: Decision[]) {
  if (!rows.length) return;
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const header = ["timestamp", "symbol", "action", "confidence_percent", "size", "stop_pips", "take_pips", "reason"];
  const body = rows.map((row) => [timestampOf(row), row.symbol, actionOf(row), confidenceOf(row), row.size ?? row.qty, row.stop_pips, row.take_pips, row.reason].map(quote).join(","));
  const blob = new Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cacsms-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function DecisionQueuePage() {
  const [response, setResponse] = useState<DecisionResponse | null>(null);
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringSummary | null>(null);
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("ALL");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const requests = await Promise.all([
          fetch("/api/decision/latest?limit=25", { cache: "no-store" }),
          fetch("/api/control/status", { cache: "no-store" }),
          fetch("/api/monitoring/summary", { cache: "no-store" }),
          fetch("/api/market/snapshot", { cache: "no-store" })
        ]);
        if (!requests[0].ok) throw new Error(`Decision API returned HTTP ${requests[0].status}`);
        const [nextDecisions, nextControl, nextMonitoring, nextMarket] = await Promise.all(requests.map((item) => item.json()));
        if (!alive) return;
        setResponse(nextDecisions as DecisionResponse);
        setControl(nextControl as ControlStatus);
        setMonitoring(nextMonitoring as MonitoringSummary);
        setMarket(nextMarket as MarketSnapshot);
        setError(null);
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : "Unable to load decision queue");
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, 4000);
        }
      }
    }

    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [refreshKey]);

  const allRows = actualItems(response);
  const rows = useMemo(() => allRows.filter((decision) => {
    const action = actionOf(decision);
    const symbolMatches = !symbolFilter.trim() || decision.symbol?.toUpperCase().includes(symbolFilter.trim().toUpperCase());
    const actionMatches = actionFilter === "ALL" || (actionFilter === "ACTIONABLE" ? action === "BUY" || action === "SELL" : action === actionFilter);
    return symbolMatches && actionMatches;
  }), [actionFilter, allRows, symbolFilter]);

  const selected = useMemo(() => {
    if (!rows.length) return null;
    const located = selectedKey ? rows.find((row, index) => decisionKey(row, index) === selectedKey) : null;
    return located ?? rows[0];
  }, [rows, selectedKey]);

  const offline = response?.ok === false || response?.provider === "web-fallback";
  const actionable = allRows.filter((row) => ["BUY", "SELL"].includes(actionOf(row))).length;
  const noTrade = allRows.filter((row) => ["NO_TRADE", "FLAT"].includes(actionOf(row))).length;
  const latestAge = age(timestampOf(allRows[0] ?? {}), now) ?? monitoring?.last_decision_age_ms ?? null;
  const gold = market?.symbols?.find((quote) => quote.symbol === "XAUUSD");
  const gateState = control?.provider === "web-fallback" || control?.ok === false ? "UNAVAILABLE" : control?.kill ? "HALTED" : control?.running ? "OPEN" : "STOPPED";

  return (
    <section className="dqPage">
      <header className="dqHero">
        <div>
          <div className="breadcrumbs">Home / Trading</div>
          <h1>Decision Queue</h1>
          <p>Review validated decision intents produced by the trading engine before they move into execution.</p>
        </div>
        <div className="dqActions">
          <Link href="/trading/signal-pipeline" className="dqGhostButton">Open signal pipeline</Link>
          <button type="button" className="dqGhostButton" disabled={!rows.length} onClick={() => downloadCsv(rows)}>Export CSV</button>
          <button type="button" className="dqRefreshButton" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }}>{loading ? "Refreshing…" : "Refresh queue"}</button>
        </div>
      </header>

      {error ? <div className="dqAlert"><strong>Queue refresh failed</strong><span>{error}</span></div> : null}
      {offline ? <div className="dqAlert dqAlertWarn"><strong>Decision service unavailable</strong><span>{response?.reason ?? "No validated decisions can be read. Synthetic fallback entries are excluded."}</span></div> : null}

      <div className="dqKpis">
        <div><span>Decision service</span><strong className={offline ? "dqBadText" : "dqGoodText"}>{offline ? "OFFLINE" : "ONLINE"}</strong><small>{offline ? "Connection required" : "Live stream connected"}</small></div>
        <div><span>Records loaded</span><strong>{allRows.length}</strong><small>Latest 25 genuine events</small></div>
        <div><span>Actionable</span><strong className="dqGoodText">{actionable}</strong><small>BUY or SELL intents</small></div>
        <div><span>No trade</span><strong>{noTrade}</strong><small>Filtered or neutral decisions</small></div>
        <div><span>Decision age</span><strong>{latestAge === null ? "—" : `${(latestAge / 1000).toFixed(1)}s`}</strong><small>Newest validated event</small></div>
      </div>

      <div className="dqContextGrid">
        <article className="dqContextCard">
          <span className="dqEyebrow">Current market context</span>
          <div className="dqContextMain"><div><h2>XAUUSD</h2><p>{gold ? `${gold.bid?.toFixed(2) ?? "—"} / ${gold.ask?.toFixed(2) ?? "—"}` : "No live quote"}</p></div><strong className={market?.mt5_connected ? "dqGoodText" : "dqBadText"}>{market?.mt5_connected ? "MT5 LIVE" : "OFFLINE"}</strong></div>
          <div className="dqContextMeta"><span>Assessment <b>{market?.intelligence?.verdict?.replaceAll("_", " ") ?? "—"}</b></span><span>Bias <b className={stateClass(market?.intelligence?.direction ?? "")}>{market?.intelligence?.direction ?? "—"}</b></span><span>Confidence <b>{market?.intelligence?.confidence?.toFixed(0) ?? "—"}%</b></span><span>Regime <b>{market?.intelligence?.regime ?? "—"}</b></span></div>
        </article>
        <article className="dqContextCard">
          <span className="dqEyebrow">Execution gate</span>
          <div className="dqContextMain"><div><h2>{gateState}</h2><p>{control?.reason ?? (gateState === "OPEN" ? "Control service permits decision processing" : "Decisions cannot advance to execution")}</p></div><strong className={gateState === "OPEN" ? "dqGoodText" : gateState === "UNAVAILABLE" ? "dqWarnText" : "dqBadText"}>{modeOf(control?.mode)}</strong></div>
          <div className="dqContextMeta"><span>Running <b>{control?.running ? "YES" : "NO"}</b></span><span>Kill switch <b className={control?.kill ? "dqBadText" : "dqGoodText"}>{control?.kill ? "ACTIVE" : "CLEAR"}</b></span><span>Monitoring <b className={monitoring?.provider === "web-fallback" ? "dqWarnText" : "dqGoodText"}>{monitoring?.provider === "web-fallback" ? "OFFLINE" : "ONLINE"}</b></span></div>
        </article>
      </div>

      <article className="dqPanel">
        <div className="dqPanelHead">
          <div><span className="dqEyebrow">Validated stream</span><h2>Decision ledger <small>{rows.length} shown</small></h2></div>
          <div className="dqFilters">
            <input aria-label="Filter decisions by symbol" value={symbolFilter} onChange={(event) => setSymbolFilter(event.target.value.toUpperCase())} placeholder="Filter symbol…" />
            <select aria-label="Filter decisions by action" value={actionFilter} onChange={(event) => setActionFilter(event.target.value as ActionFilter)}>
              <option value="ALL">All decisions</option><option value="ACTIONABLE">Actionable only</option><option value="BUY">Buy</option><option value="SELL">Sell</option><option value="NO_TRADE">No trade</option>
            </select>
          </div>
        </div>
        <div className="dqWorkspace">
          <div className="dqTableWrap">
            <table className="dqTable">
              <thead><tr><th>Time</th><th>Symbol</th><th>Decision</th><th>Confidence</th><th>Size</th><th>Stop / Take</th><th>Reason</th></tr></thead>
              <tbody>
                {!rows.length ? <tr><td className="dqEmpty" colSpan={7}>{loading ? "Loading validated decisions…" : offline ? "Decision service is offline. No synthetic records are shown." : "No decisions match this view."}</td></tr> : rows.map((decision, index) => {
                  const key = decisionKey(decision, index);
                  const action = actionOf(decision);
                  const confidence = confidenceOf(decision);
                  return <tr key={key} className={selected === decision ? "dqSelectedRow" : undefined} onClick={() => setSelectedKey(key)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedKey(key); }}>
                    <td>{time(timestampOf(decision))}</td><td><strong>{decision.symbol ?? "—"}</strong></td><td><span className={`dqAction ${stateClass(action)}`}>{action.replaceAll("_", " ")}</span></td><td>{confidence === null ? "—" : `${confidence.toFixed(0)}%`}</td><td>{typeof (decision.size ?? decision.qty) === "number" ? Number(decision.size ?? decision.qty).toFixed(2) : "—"}</td><td>{decision.stop_pips ?? "—"} / {decision.take_pips ?? "—"}</td><td className="dqReason">{decision.reason ?? "—"}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>

          <aside className="dqInspector">
            <div className="dqInspectorHead"><span className="dqEyebrow">Selected decision</span><h3>{selected ? `${selected.symbol ?? "—"} · ${actionOf(selected).replaceAll("_", " ")}` : "No decision selected"}</h3></div>
            {selected ? <div className="dqInspectorBody">
              <dl><div><dt>Created</dt><dd>{time(timestampOf(selected))}</dd></div><div><dt>Confidence</dt><dd>{confidenceOf(selected) === null ? "—" : `${confidenceOf(selected)?.toFixed(0)}%`}</dd></div><div><dt>Order size</dt><dd>{selected.size ?? selected.qty ?? "—"}</dd></div><div><dt>Stop / Take</dt><dd>{selected.stop_pips ?? "—"} / {selected.take_pips ?? "—"}</dd></div></dl>
              <div className="dqInspectorReason"><span>Decision rationale</span><p>{selected.reason ?? "No rationale reported."}</p></div>
              <div className="dqBiasList"><span>Timeframe evidence</span>{selected.bias?.length ? selected.bias.map((point) => <div key={point.tf}><b>{point.tf ?? "—"}</b><strong className={point.bias === "UP" ? "dqGoodText" : point.bias === "DOWN" ? "dqBadText" : "dqWarnText"}>{point.bias ?? "—"}</strong><em>{typeof point.confidence === "number" ? `${(point.confidence <= 1 ? point.confidence * 100 : point.confidence).toFixed(0)}%` : "—"}</em><small>{point.regime ?? "—"}</small></div>) : <p>No timeframe evidence was included.</p>}</div>
            </div> : <div className="dqInspectorEmpty">Select a genuine decision to inspect its evidence and risk parameters.</div>}
          </aside>
        </div>
      </article>
    </section>
  );
}
