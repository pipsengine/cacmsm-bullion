"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { findNavItem } from "../../../config/navigation";
import { Card, JsonBlock, Kpi } from "../../../components/ui/Cards";
import MarketMatrixPage from "../../../components/pages/MarketMatrixPage";
import History24hPage from "../../../components/pages/History24hPage";
import Mt5TerminalPage from "../../../components/pages/Mt5TerminalPage";
import Mt5AccountSyncPage from "../../../components/pages/Mt5AccountSyncPage";

type ControlStatusModeShape =
  | string
  | { active: string; envelope?: string };

type ControlStatus = {
  running?: boolean;
  kill?: boolean;
  mode?: ControlStatusModeShape;
  status?: string | null;
  routing?: string | { primary_symbol?: string; routing_mode?: string };
};
type HealthSummary = {
  running?: boolean;
  mode?: string | ControlStatusModeShape;
  kill?: boolean;
  last_tick_age_ms: number | null;
  last_decision_age_ms: number | null;
  notes: string[];
};

async function apiGet(path: string) {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

function toActiveMode(mode: ControlStatusModeShape | undefined | null): string {
  if (!mode) return "DEMO";
  if (typeof mode === "string") return mode.toUpperCase();
  if (typeof mode.active === "string") return mode.active.toUpperCase();
  return "DEMO";
}

function Title({ group, title }: { group: string; title: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>Home / {group}</div>
      <div style={{ fontSize: 30, fontWeight: 900, marginTop: 6 }}>{title}</div>
      <div style={{ color: "var(--muted)", marginTop: 6, maxWidth: 900 }}>
        Key pages are wired to live service APIs; the remaining routes are ready for domain widgets without changing routing.
      </div>
    </div>
  );
}

export default function AnyPage() {
  const params = useParams<{ path: string[] }>();
  const router = useRouter();
  const pathname = "/" + (params?.path ?? []).join("/");

  const goMatrix = useCallback(() => router.push("/market/matrix"), [router]);
  const goHistory = useCallback(() => router.push("/market/history-24h"), [router]);

  if (pathname === "/market/matrix") {
    return <MarketMatrixPage onOpenHistory={goHistory} />;
  }
  if (pathname === "/market/history-24h") {
    return <History24hPage onOpenMatrix={goMatrix} />;
  }
  if (pathname === "/execution/mt5-terminal") {
    return <Mt5TerminalPage />;
  }
  if (pathname === "/execution/mt5-account-sync") {
    return <Mt5AccountSyncPage />;
  }

  return <GenericPage pathname={pathname} />;
}

function GenericPage({ pathname }: { pathname: string }) {
  const info = useMemo(() => findNavItem(pathname), [pathname]);

  const [control, setControl] = useState<ControlStatus | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [decisions, setDecisions] = useState<any>(null);
  const [executions, setExecutions] = useState<any>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [c, h] = await Promise.all([apiGet("/api/control/status"), apiGet("/api/monitoring/summary")]);
        if (!alive) return;
        setControl(c);
        setHealth(h);
      } catch {
        if (!alive) return;
        setControl(null);
        setHealth(null);
      }
    };
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const loadPageData = async () => {
      try {
        if (pathname === "/trading/decision-queue" || pathname === "/dashboard/executive-overview") {
          const d = await apiGet("/api/decision/latest?limit=10");
          if (alive) setDecisions(d);
        } else if (alive) {
          setDecisions(null);
        }

        if (pathname === "/execution/execution-logs" || pathname === "/dashboard/executive-overview") {
          const e = await apiGet("/api/execution/latest?limit=10");
          if (alive) setExecutions(e);
        } else if (alive) {
          setExecutions(null);
        }
      } catch {
        if (alive) {
          setDecisions(null);
          setExecutions(null);
        }
      }
    };
    loadPageData();
    const id = setInterval(loadPageData, 4500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pathname]);

  if (!info) {
    return (
      <div>
        <Title group="Unknown" title="Page not in navigation" />
        <Card title="Path">{pathname}</Card>
      </div>
    );
  }

  const { group, item } = info;

  const kpi = [
    { label: "System", value: control?.kill ? "HALTED" : control?.running ? "RUNNING" : "STOPPED", hint: "From Control API" },
    { label: "Mode", value: toActiveMode(control?.mode ?? "DEMO"), hint: "demo / prop / live policy envelope" },
    { label: "Feed age", value: health?.last_tick_age_ms == null ? "-" : `${health.last_tick_age_ms}ms`, hint: "Market freshness" },
    { label: "Decision age", value: health?.last_decision_age_ms == null ? "-" : `${health.last_decision_age_ms}ms`, hint: "Decision freshness" }
  ];

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Title group={group} title={item.title} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {kpi.map((x) => (
          <Kpi key={x.label} label={x.label} value={x.value} hint={x.hint} />
        ))}
      </div>

      {health?.notes?.length ? (
        <Card title="Notes">
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)" }}>
            {health.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {pathname === "/dashboard/executive-overview" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 14 }}>
          <Card title="Decision queue (latest)">{decisions ? <JsonBlock data={decisions} /> : <div>Loading...</div>}</Card>
          <Card title="Execution logs (latest)">{executions ? <JsonBlock data={executions} /> : <div>Loading...</div>}</Card>
        </div>
      ) : null}

      {pathname === "/trading/decision-queue" ? (
        <Card title="Decision queue (latest)">{decisions ? <JsonBlock data={decisions} /> : <div>Loading...</div>}</Card>
      ) : null}

      {pathname === "/execution/execution-logs" ? (
        <Card title="Execution logs (latest)">{executions ? <JsonBlock data={executions} /> : <div>Loading...</div>}</Card>
      ) : null}

      <Card title="Page implementation status">
        <div style={{ color: "var(--muted)" }}>
          This route is implemented and navigable. Add domain widgets here without changing the repo structure.
        </div>
      </Card>
    </div>
  );
}
