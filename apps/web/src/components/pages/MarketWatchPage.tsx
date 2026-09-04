"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";

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

type MarketIntelligence = {
  verdict?: string;
  direction?: string;
  confidence?: number;
  regime?: string;
  xau_strength?: number;
  usd_strength?: number;
  strength_gap?: number;
  data_quality?: number;
  supporting_timeframes?: string[];
  conflicting_timeframes?: string[];
  risk_flags?: string[];
  reason?: string;
};

type Snapshot = {
  ts_utc?: string;
  ts_display?: string;
  feed_source?: string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  total_ticks?: number;
  symbols?: SymbolTick[];
  intelligence?: MarketIntelligence;
};

type MarketStatus = {
  feed_mode?: string;
  feed_source?: string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  configured_symbols?: string[];
  symbols_present?: string[];
  missing_symbols?: string[];
  last_tick_seconds_ago?: number | null;
  account_login?: number;
  account_server?: string;
};

type SymbolFilter = "ALL" | "GOLD" | "MAJORS" | "CROSSES";

const MAJORS = new Set(["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "USDCAD", "AUDUSD", "NZDUSD"]);

function precisionFor(symbol: string) {
  if (symbol === "XAUUSD") return 2;
  if (symbol.endsWith("JPY")) return 3;
  return 5;
}

function formatPrice(value: number | undefined, symbol: string) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(precisionFor(symbol)) : "—";
}

function formatClock(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function ageSeconds(value: string | undefined, now: number) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (now - timestamp) / 1000) : null;
}

function freshness(age: number | null) {
  if (age === null) return { label: "NO DATA", tone: "bad" };
  if (age <= 5) return { label: "LIVE", tone: "ok" };
  if (age <= 20) return { label: "DELAYED", tone: "warn" };
  return { label: "STALE", tone: "bad" };
}

function sessionNames(now: Date) {
  const hour = now.getUTCHours() + now.getUTCMinutes() / 60;
  const day = now.getUTCDay();
  if (day === 6 || (day === 0 && hour < 21) || (day === 5 && hour >= 21)) return [];
  const sessions: string[] = [];
  if (hour >= 21 || hour < 6) sessions.push("Sydney");
  if (hour < 9) sessions.push("Tokyo");
  if (hour >= 7 && hour < 16) sessions.push("London");
  if (hour >= 12 && hour < 21) sessions.push("New York");
  return sessions;
}

function movementClass(delta: number | undefined) {
  if (!delta) return "mwFlat";
  return delta > 0 ? "mwUp" : "mwDown";
}

export default function MarketWatchPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SymbolFilter>("ALL");
  const [refreshKey, setRefreshKey] = useState(0);
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const [clock, setClock] = useState(() => new Date());
  const previousMids = useRef<Record<string, number>>({});

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const snapshotResponse = await fetch("/api/market/snapshot", { cache: "no-store" });
        if (!snapshotResponse.ok) throw new Error(`Market API returned HTTP ${snapshotResponse.status}`);
        const nextSnapshot = (await snapshotResponse.json()) as Snapshot;
        if (!alive) return;

        const nextDeltas: Record<string, number> = {};
        for (const quote of nextSnapshot.symbols ?? []) {
          const nextMid = quote.mid;
          const previous = previousMids.current[quote.symbol];
          if (typeof nextMid === "number" && typeof previous === "number") {
            nextDeltas[quote.symbol] = nextMid - previous;
          }
          if (typeof nextMid === "number") previousMids.current[quote.symbol] = nextMid;
        }
        setDeltas(nextDeltas);
        setSnapshot(nextSnapshot);
        setError(null);
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : "Unable to load market data");
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, 1500);
        }
      }
    }

    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [refreshKey]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function loadStatus() {
      try {
        const response = await fetch("/api/market/status", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const nextStatus = (await response.json()) as MarketStatus;
        if (alive) setStatus(nextStatus);
      } catch {
        // The quote request owns the visible error state; retain the last known status.
      } finally {
        if (alive) timer = setTimeout(loadStatus, 10_000);
      }
    }

    void loadStatus();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [refreshKey]);

  const quotes = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return [...(snapshot?.symbols ?? [])]
      .filter((quote) => {
        if (normalized && !quote.symbol.includes(normalized)) return false;
        if (filter === "GOLD") return quote.symbol === "XAUUSD";
        if (filter === "MAJORS") return MAJORS.has(quote.symbol);
        if (filter === "CROSSES") return quote.symbol !== "XAUUSD" && !MAJORS.has(quote.symbol);
        return true;
      })
      .sort((left, right) => {
        if (left.symbol === "XAUUSD") return -1;
        if (right.symbol === "XAUUSD") return 1;
        return left.symbol.localeCompare(right.symbol);
      });
  }, [filter, query, snapshot?.symbols]);

  const gold = snapshot?.symbols?.find((quote) => quote.symbol === "XAUUSD");
  const goldDelta = deltas.XAUUSD;
  const feedAge = ageSeconds(gold?.ts_utc, clock.getTime()) ?? status?.last_tick_seconds_ago ?? null;
  const feedState = freshness(feedAge);
  const connected = Boolean(snapshot?.mt5_connected && status?.mt5_connected !== false);
  const intelligence = snapshot?.intelligence;
  const sessions = sessionNames(clock);
  const presentCount = status?.symbols_present?.length ?? snapshot?.symbols?.length ?? 0;
  const configuredCount = status?.configured_symbols?.length ?? presentCount;

  return (
    <section className="mwPage">
      <header className="mwHero">
        <div>
          <div className="breadcrumbs">Home / Trading</div>
          <h1>Market Watch</h1>
          <p>Live MT5 quotes, feed health, and market intelligence. Prices shown here come directly from the connected terminal.</p>
        </div>
        <div className="mwHeaderActions">
          <Link href="/market/matrix" className="mwGhostButton">Open market matrix</Link>
          <button type="button" className="mwRefreshButton" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }}>
            {loading ? "Refreshing…" : "Refresh now"}
          </button>
        </div>
      </header>

      <div className="mwStatusStrip">
        <div className={`mwStatusChip mwStatus${connected ? "Ok" : "Bad"}`}>
          <span className="mwStatusDot" /> {connected ? "MT5 connected" : "MT5 disconnected"}
        </div>
        <div className={`mwStatusChip mwStatus${feedState.tone === "ok" ? "Ok" : feedState.tone === "warn" ? "Warn" : "Bad"}`}>
          Feed {feedState.label}{feedAge === null ? "" : ` · ${feedAge.toFixed(1)}s`}
        </div>
        <div className="mwStatusChip">Source <strong>{snapshot?.feed_source ?? status?.feed_source ?? "—"}</strong></div>
        <div className="mwStatusChip">Symbols <strong>{presentCount}/{configuredCount}</strong></div>
        <div className="mwStatusChip">Lagos <strong>{formatClock(clock.toISOString())}</strong></div>
        <div className="mwStatusChip">Session <strong>{sessions.length ? sessions.join(" + ") : "Market closed"}</strong></div>
      </div>

      {error || !connected ? (
        <div className="mwAlert" role="status">
          <strong>{error ? "Market data request failed" : "MT5 feed is not connected"}</strong>
          <span>{error ?? snapshot?.mt5_error ?? status?.mt5_error ?? "Waiting for a live terminal connection. No substitute prices are being shown."}</span>
        </div>
      ) : null}

      <div className="mwTopGrid">
        <article className="mwGoldPanel">
          <div className="mwPanelHeading">
            <div>
              <span className="mwEyebrow">Primary instrument</span>
              <h2>XAUUSD <small>Gold / US Dollar</small></h2>
            </div>
            <span className={`mwLiveBadge mwStatus${feedState.tone === "ok" ? "Ok" : feedState.tone === "warn" ? "Warn" : "Bad"}`}>{feedState.label}</span>
          </div>
          <div className="mwQuoteGrid">
            <div className="mwQuoteCell"><span>Bid</span><strong>{formatPrice(gold?.bid, "XAUUSD")}</strong></div>
            <div className="mwQuoteCell"><span>Ask</span><strong>{formatPrice(gold?.ask, "XAUUSD")}</strong></div>
            <div className="mwQuoteCell"><span>Mid</span><strong>{formatPrice(gold?.mid, "XAUUSD")}</strong></div>
            <div className="mwQuoteCell"><span>Spread</span><strong>{formatPrice(gold?.spread, "XAUUSD")}</strong></div>
          </div>
          <div className="mwQuoteFooter">
            <span>Last tick <strong>{formatClock(gold?.ts_utc)}</strong></span>
            <span className={movementClass(goldDelta)}>Tick move <strong>{goldDelta === undefined ? "—" : `${goldDelta >= 0 ? "+" : ""}${goldDelta.toFixed(2)}`}</strong></span>
            <span>Source <strong>{gold?.source ?? "—"}</strong></span>
          </div>
        </article>

        <article className="mwIntelPanel">
          <div className="mwPanelHeading">
            <div><span className="mwEyebrow">System intelligence</span><h2>Current assessment</h2></div>
            <span className={`mwDirection mwDirection${intelligence?.direction ?? "NEUTRAL"}`}>{intelligence?.direction ?? "NO SIGNAL"}</span>
          </div>
          <div className="mwIntelStats">
            <div><span>Verdict</span><strong>{intelligence?.verdict?.replaceAll("_", " ") ?? "—"}</strong></div>
            <div><span>Confidence</span><strong>{typeof intelligence?.confidence === "number" ? `${intelligence.confidence.toFixed(0)}%` : "—"}</strong></div>
            <div><span>Regime</span><strong>{intelligence?.regime ?? "—"}</strong></div>
            <div><span>Data quality</span><strong>{typeof intelligence?.data_quality === "number" ? `${intelligence.data_quality.toFixed(0)}%` : "—"}</strong></div>
          </div>
          <p className="mwIntelReason">{intelligence?.reason ?? "Market intelligence is waiting for sufficient live MT5 data."}</p>
          <div className="mwRiskFlags">
            {(intelligence?.risk_flags?.length ? intelligence.risk_flags : ["NO ACTIVE ASSESSMENT"]).map((flag) => (
              <span key={flag}>{flag.replaceAll("_", " ")}</span>
            ))}
          </div>
        </article>
      </div>

      <article className="mwWatchPanel">
        <div className="mwWatchHeader">
          <div>
            <span className="mwEyebrow">Live watchlist</span>
            <h2>Market quotes <small>{quotes.length} instruments</small></h2>
          </div>
          <div className="mwControls">
            <input aria-label="Search symbols" value={query} onChange={(event) => setQuery(event.target.value.toUpperCase())} placeholder="Search symbol…" />
            <select aria-label="Filter symbols" value={filter} onChange={(event) => setFilter(event.target.value as SymbolFilter)}>
              <option value="ALL">All instruments</option>
              <option value="GOLD">Gold</option>
              <option value="MAJORS">FX majors</option>
              <option value="CROSSES">FX crosses</option>
            </select>
          </div>
        </div>
        <div className="mwTableWrap">
          <table className="mwTable">
            <thead><tr><th>Symbol</th><th>Bid</th><th>Ask</th><th>Mid</th><th>Spread</th><th>Last tick move</th><th>Updated</th><th>Source</th><th>State</th></tr></thead>
            <tbody>
              {quotes.length === 0 ? (
                <tr><td colSpan={9} className="mwEmpty">{loading ? "Loading live MT5 quotes…" : "No symbols match this view."}</td></tr>
              ) : quotes.map((quote) => {
                const quoteAge = ageSeconds(quote.ts_utc, clock.getTime());
                const quoteState = freshness(quoteAge);
                const delta = deltas[quote.symbol];
                const points = typeof quote.spread === "number" ? quote.spread * 10 ** precisionFor(quote.symbol) : null;
                return (
                  <tr key={quote.symbol} className={quote.symbol === "XAUUSD" ? "mwPrimaryRow" : undefined}>
                    <td><strong>{quote.symbol}</strong><small>{quote.symbol === "XAUUSD" ? "Primary" : MAJORS.has(quote.symbol) ? "Major" : "Cross"}</small></td>
                    <td className="mwNumber">{formatPrice(quote.bid, quote.symbol)}</td>
                    <td className="mwNumber">{formatPrice(quote.ask, quote.symbol)}</td>
                    <td className="mwNumber">{formatPrice(quote.mid, quote.symbol)}</td>
                    <td className="mwNumber">{points === null ? "—" : `${points.toFixed(1)} pt`}</td>
                    <td className={`mwNumber ${movementClass(delta)}`}>{delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(precisionFor(quote.symbol))}`}</td>
                    <td>{formatClock(quote.ts_utc)}<small>{quoteAge === null ? "—" : `${quoteAge.toFixed(1)}s ago`}</small></td>
                    <td>{quote.source ?? "—"}</td>
                    <td><span className={`mwTableState mwStatus${quoteState.tone === "ok" ? "Ok" : quoteState.tone === "warn" ? "Warn" : "Bad"}`}>{quoteState.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="mwPanelFooter">
          <span>Account <strong>{status?.account_login ? `#${status.account_login}` : "Not reported"}</strong></span>
          <span>Server <strong>{status?.account_server ?? "Not reported"}</strong></span>
          <span>Snapshot <strong>{formatClock(snapshot?.ts_utc)}</strong></span>
          {status?.missing_symbols?.length ? <span className="mwDown">Missing <strong>{status.missing_symbols.length}</strong></span> : null}
        </footer>
      </article>
    </section>
  );
}
