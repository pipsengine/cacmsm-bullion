"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { DecisionTable } from "../ui/ActivityTables";

type PipelineState = "pass" | "warn" | "block" | "wait" | "unavailable";

type SymbolTick = { symbol: string; bid?: number; ask?: number; spread?: number; ts_utc?: string };
type Candidate = { symbol?: string; direction?: string; strong_currency?: string; weak_currency?: string; strength_gap?: number };
type Intelligence = {
  advisory_only?: boolean;
  verdict?: string;
  symbol?: string;
  direction?: string;
  confidence?: number;
  regime?: string;
  strength_gap?: number;
  xau_strength?: number;
  usd_strength?: number;
  data_quality?: number;
  supporting_timeframes?: string[];
  conflicting_timeframes?: string[];
  risk_flags?: string[];
  reason?: string;
  candidate_pairs?: Candidate[];
};
type MarketSnapshot = {
  ts_utc?: string;
  feed_source?: string;
  mt5_connected?: boolean;
  mt5_error?: string | null;
  symbols?: SymbolTick[];
  missing_symbols?: string[];
  intelligence?: Intelligence;
};
type ControlStatus = {
  ok?: boolean;
  provider?: string;
  reason?: string;
  running?: boolean;
  kill?: boolean;
  status?: string;
  mode?: string | { active?: string };
};
type MonitoringSummary = {
  ok?: boolean;
  provider?: string;
  reason?: string;
  last_tick_age_ms?: number | null;
  last_decision_age_ms?: number | null;
  notes?: string[];
};
type DecisionResponse = {
  ok?: boolean;
  provider?: string;
  reason?: string;
  items?: Array<Record<string, unknown>>;
  decisions?: Array<Record<string, unknown>>;
};
type Stage = { name: string; state: PipelineState; headline: string; detail: string; metric: string };

function clock(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

function ageMs(value: string | undefined, now: number) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
}

function activeMode(mode: ControlStatus["mode"]) {
  if (typeof mode === "string") return mode.toUpperCase();
  return mode?.active?.toUpperCase() ?? "—";
}

function actualDecisions(response: DecisionResponse | null) {
  if (!response || response.ok === false || response.provider === "web-fallback") return [];
  return Array.isArray(response.items) ? response.items : Array.isArray(response.decisions) ? response.decisions : [];
}

function displayAction(record?: Record<string, unknown>) {
  const value = record?.action ?? record?.side;
  return typeof value === "string" ? value : null;
}

function displayConfidence(record?: Record<string, unknown>) {
  const value = record?.confidence;
  if (typeof value !== "number") return null;
  return value <= 1 ? value * 100 : value;
}

function stageIcon(state: PipelineState) {
  if (state === "pass") return "✓";
  if (state === "warn") return "!";
  if (state === "block") return "×";
  if (state === "unavailable") return "?";
  return "•";
}

export default function SignalPipelinePage() {
  const [market, setMarket] = useState<MarketSnapshot | null>(null);
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [monitoring, setMonitoring] = useState<MonitoringSummary | null>(null);
  const [decisions, setDecisions] = useState<DecisionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
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
        const responses = await Promise.all([
          fetch("/api/market/snapshot", { cache: "no-store" }),
          fetch("/api/control/status", { cache: "no-store" }),
          fetch("/api/monitoring/summary", { cache: "no-store" }),
          fetch("/api/decision/latest?limit=8", { cache: "no-store" })
        ]);
        if (!responses[0].ok) throw new Error(`Market API returned HTTP ${responses[0].status}`);
        const [nextMarket, nextControl, nextMonitoring, nextDecisions] = await Promise.all(responses.map((response) => response.json()));
        if (!alive) return;
        setMarket(nextMarket as MarketSnapshot);
        setControl(nextControl as ControlStatus);
        setMonitoring(nextMonitoring as MonitoringSummary);
        setDecisions(nextDecisions as DecisionResponse);
        setError(null);
      } catch (loadError) {
        if (alive) setError(loadError instanceof Error ? loadError.message : "Unable to load pipeline data");
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(load, 3000);
        }
      }
    }

    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [refreshKey]);

  const intelligence = market?.intelligence;
  const gold = market?.symbols?.find((quote) => quote.symbol === "XAUUSD");
  const feedAge = ageMs(gold?.ts_utc, now);
  const decisionRows = actualDecisions(decisions);
  const latestDecision = decisionRows[0];

  const stages = useMemo<Stage[]>(() => {
    const connected = Boolean(market?.mt5_connected && gold);
    const feedState: PipelineState = !market ? "wait" : !connected ? "block" : feedAge !== null && feedAge <= 5000 ? "pass" : "warn";
    const regime = intelligence?.regime?.toUpperCase();
    const regimeState: PipelineState = !intelligence ? "wait" : regime === "DEAD" || regime === "NEWS_RISK" ? "block" : regime === "TREND" ? "pass" : "warn";
    const confidence = intelligence?.confidence ?? 0;
    const direction = intelligence?.direction?.toUpperCase() ?? "NEUTRAL";
    const supporting = intelligence?.supporting_timeframes?.length ?? 0;
    const conflicting = intelligence?.conflicting_timeframes?.length ?? 0;
    const biasState: PipelineState = !intelligence ? "wait" : direction === "NEUTRAL" ? "wait" : confidence >= 70 && supporting > conflicting ? "pass" : "warn";
    const verdict = intelligence?.verdict?.toUpperCase();
    const setupState: PipelineState = !verdict ? "wait" : verdict === "TECHNICAL_READY" ? "pass" : verdict === "NO_TRADE" ? "block" : "warn";
    const controlUnavailable = control?.ok === false || control?.provider === "web-fallback";
    const monitoringUnavailable = monitoring?.ok === false || monitoring?.provider === "web-fallback";
    const riskState: PipelineState = controlUnavailable || monitoringUnavailable ? "unavailable" : control?.kill ? "block" : control?.running ? "pass" : "wait";
    const action = displayAction(latestDecision);
    const decisionState: PipelineState = decisions?.ok === false || decisions?.provider === "web-fallback" ? "unavailable" : !action ? "wait" : action === "BUY" || action === "SELL" ? "pass" : action === "NO_TRADE" || action === "FLAT" ? "block" : "warn";

    return [
      { name: "Market data", state: feedState, headline: connected ? `${market?.feed_source ?? "MT5"} feed received` : "No live quote", detail: connected ? `XAUUSD ${gold?.bid?.toFixed(2) ?? "—"} / ${gold?.ask?.toFixed(2) ?? "—"}` : market?.mt5_error ?? "Waiting for MT5", metric: feedAge === null ? "—" : `${(feedAge / 1000).toFixed(1)}s old` },
      { name: "Market regime", state: regimeState, headline: regime ?? "Waiting", detail: regime === "TREND" ? "Directional conditions detected" : regime ? "Conditions require additional confirmation" : "No regime assessment", metric: `${intelligence?.data_quality?.toFixed(0) ?? "—"}% quality` },
      { name: "Bias alignment", state: biasState, headline: direction, detail: `${supporting} supporting · ${conflicting} conflicting timeframes`, metric: `${confidence.toFixed(0)}% confidence` },
      { name: "Setup detection", state: setupState, headline: verdict?.replaceAll("_", " ") ?? "Waiting", detail: intelligence?.reason ?? "Waiting for technical evidence", metric: `${Math.abs(intelligence?.strength_gap ?? 0).toFixed(1)} strength gap` },
      { name: "Risk validation", state: riskState, headline: controlUnavailable || monitoringUnavailable ? "Services unavailable" : control?.kill ? "Kill switch active" : control?.running ? "Guardrails available" : "System stopped", detail: controlUnavailable ? control?.reason ?? "Control API unavailable" : monitoringUnavailable ? monitoring?.reason ?? "Monitoring unavailable" : monitoring?.notes?.[0] ?? "No active risk warnings", metric: activeMode(control?.mode) },
      { name: "Decision output", state: decisionState, headline: action?.replaceAll("_", " ") ?? "No live decision", detail: decisions?.ok === false ? decisions.reason ?? "Decision service unavailable" : latestDecision && typeof latestDecision.reason === "string" ? latestDecision.reason : "Awaiting a validated decision", metric: displayConfidence(latestDecision) === null ? "—" : `${displayConfidence(latestDecision)?.toFixed(0)}%` }
    ];
  }, [control, decisions, feedAge, gold, intelligence, latestDecision, market, monitoring]);

  const blockers = stages.filter((stage) => stage.state === "block" || stage.state === "unavailable");
  const overallState: PipelineState = blockers.some((stage) => stage.state === "block") ? "block" : blockers.length ? "unavailable" : stages.every((stage) => stage.state === "pass") ? "pass" : "warn";
  const advisoryDirection = intelligence?.direction?.toUpperCase() ?? "NEUTRAL";

  return (
    <section className="spPage">
      <header className="spHero">
        <div>
          <div className="breadcrumbs">Home / Trading</div>
          <h1>Signal Pipeline</h1>
          <p>Follow live market evidence from the MT5 tick through qualification, risk validation, and the final decision.</p>
        </div>
        <div className="spActions">
          <Link href="/trading/market-watch" className="spGhostButton">Open market watch</Link>
          <button type="button" className="spRefreshButton" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }}>{loading ? "Refreshing…" : "Refresh pipeline"}</button>
        </div>
      </header>

      {error ? <div className="spAlert"><strong>Pipeline refresh failed</strong><span>{error}</span></div> : null}

      <div className="spSummary">
        <div className={`spSummaryMark spState-${overallState}`}>{stageIcon(overallState)}</div>
        <div className="spSummaryMain">
          <span className="spEyebrow">Current XAUUSD outcome</span>
          <h2>{overallState === "pass" ? "Pipeline qualified" : overallState === "block" ? "Pipeline blocked" : overallState === "unavailable" ? "Validation unavailable" : "Signal developing"}</h2>
          <p>{blockers.length ? `${blockers.map((stage) => stage.name).join(" and ")} ${blockers.length === 1 ? "is" : "are"} preventing an executable decision.` : intelligence?.reason ?? "Waiting for sufficient market evidence."}</p>
        </div>
        <div className="spSummarySignal">
          <span>Advisory bias</span>
          <strong className={`spBias-${advisoryDirection}`}>{advisoryDirection}</strong>
          <small>{intelligence?.confidence?.toFixed(0) ?? "—"}% confidence</small>
        </div>
        <div className="spSummaryMeta">
          <span>Last market tick <strong>{clock(gold?.ts_utc)}</strong></span>
          <span>Mode <strong>{activeMode(control?.mode)}</strong></span>
          <span>Decision age <strong>{typeof monitoring?.last_decision_age_ms === "number" ? `${(monitoring.last_decision_age_ms / 1000).toFixed(1)}s` : "—"}</strong></span>
        </div>
      </div>

      <article className="spPanel">
        <div className="spPanelHead"><div><span className="spEyebrow">Live processing path</span><h2>Qualification stages</h2></div><span>Evidence flows left to right</span></div>
        <div className="spStages">
          {stages.map((stage, index) => (
            <React.Fragment key={stage.name}>
              <section className={`spStage spState-${stage.state}`}>
                <div className="spStageTop"><span className="spStageIndex">{index + 1}</span><span className="spStageState">{stage.state}</span></div>
                <h3>{stage.name}</h3>
                <strong className="spStageHeadline">{stage.headline}</strong>
                <p>{stage.detail}</p>
                <span className="spStageMetric">{stage.metric}</span>
              </section>
              {index < stages.length - 1 ? <span className="spConnector" aria-hidden="true">›</span> : null}
            </React.Fragment>
          ))}
        </div>
      </article>

      <div className="spDetailGrid">
        <article className="spPanel">
          <div className="spPanelHead"><div><span className="spEyebrow">Evidence</span><h2>Timeframe alignment</h2></div><span>{intelligence?.regime ?? "No regime"}</span></div>
          <div className="spEvidenceBody">
            <div className="spStrengthRow">
              <div><span>XAU strength</span><strong>{intelligence?.xau_strength?.toFixed(1) ?? "—"}</strong></div>
              <div><span>USD strength</span><strong>{intelligence?.usd_strength?.toFixed(1) ?? "—"}</strong></div>
              <div><span>Directional gap</span><strong className={`spBias-${advisoryDirection}`}>{intelligence?.strength_gap?.toFixed(1) ?? "—"}</strong></div>
              <div><span>Data quality</span><strong>{intelligence?.data_quality?.toFixed(0) ?? "—"}%</strong></div>
            </div>
            <div className="spTimeframeGroup"><span>Supporting</span><div>{intelligence?.supporting_timeframes?.length ? intelligence.supporting_timeframes.map((item) => <b className="spTfGood" key={item}>{item}</b>) : <em>None reported</em>}</div></div>
            <div className="spTimeframeGroup"><span>Conflicting</span><div>{intelligence?.conflicting_timeframes?.length ? intelligence.conflicting_timeframes.map((item) => <b className="spTfWarn" key={item}>{item}</b>) : <em>None reported</em>}</div></div>
            <div className="spTimeframeGroup"><span>Risk flags</span><div>{intelligence?.risk_flags?.length ? intelligence.risk_flags.map((item) => <b className="spTfBad" key={item}>{item.replaceAll("_", " ")}</b>) : <em>No flags reported</em>}</div></div>
          </div>
        </article>

        <article className="spPanel">
          <div className="spPanelHead"><div><span className="spEyebrow">Opportunities</span><h2>Candidate pairs</h2></div><span>Advisory only</span></div>
          <div className="spCandidateList">
            {intelligence?.candidate_pairs?.length ? intelligence.candidate_pairs.map((candidate) => (
              <div className="spCandidate" key={`${candidate.symbol}-${candidate.direction}`}>
                <div><strong>{candidate.symbol ?? "—"}</strong><span>{candidate.strong_currency ?? "—"} strong · {candidate.weak_currency ?? "—"} weak</span></div>
                <b className={`spBias-${candidate.direction?.toUpperCase() ?? "NEUTRAL"}`}>{candidate.direction ?? "—"}</b>
                <em>{candidate.strength_gap?.toFixed(1) ?? "—"} gap</em>
              </div>
            )) : <div className="spEmpty">No live candidates meet the current screening rules.</div>}
          </div>
        </article>
      </div>

      <article className="spPanel">
        <div className="spPanelHead"><div><span className="spEyebrow">Decision service</span><h2>Recent validated decisions</h2></div><span>Synthetic fallback events are excluded</span></div>
        <div className="spDecisionBody"><DecisionTable data={decisions} /></div>
      </article>
    </section>
  );
}
