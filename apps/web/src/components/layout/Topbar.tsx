"use client";

import React, { useEffect, useState } from "react";

type ModeShape =
  | string
  | { active: string; envelope?: string };

type RoutingShape =
  | string
  | { primary_symbol?: string; routing_mode?: string };

type ControlStatus = {
  running: boolean;
  kill: boolean;
  mode?: ModeShape | null;
  status?: "STOPPED" | "RUNNING" | "HALTED" | "UNAVAILABLE" | string;
  substate?: string;
  routing?: RoutingShape;
  feed_age_ms?: number | null;
  decision_age_ms?: number | null;
  [k: string]: any;
};

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "bad" | "muted" }) {
  const color =
    tone === "ok"
      ? "var(--ok)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "bad"
          ? "var(--bad)"
          : "var(--muted)";
  return (
    <div
      className="topbarPill"
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
        color,
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {children}
    </div>
  );
}

function coerceStatusTone(status: string | undefined, running: boolean, kill: boolean): "ok" | "warn" | "bad" {
  if (kill || status === "HALTED") return "bad";
  if (running || status === "RUNNING") return "ok";
  if (status === "UNAVAILABLE") return "warn";
  return "warn";
}

function coerceStatusLabel(status: string | undefined, running: boolean, kill: boolean): string {
  if (kill || status === "HALTED") return "HALTED";
  if (running || status === "RUNNING") return "RUNNING";
  if (status === "STOPPED") return "STOPPED";
  if (status === "UNAVAILABLE") return "OFFLINE";
  return "STOPPED";
}

function modeActive(mode: ModeShape | undefined | null): string {
  if (!mode) return "DEMO";
  if (typeof mode === "string") return mode.toUpperCase();
  if (mode && typeof mode === "object" && typeof mode.active === "string") {
    return mode.active.toUpperCase();
  }
  return "DEMO";
}

function routingLabel(routing: RoutingShape | undefined | null, fallbackSymbol = "XAUUSD", fallbackMode = "MT5-first") {
  if (!routing) return `${fallbackSymbol} - ${fallbackMode}`;
  if (typeof routing === "string") return routing;
  if (typeof routing === "object") {
    const sym = (routing.primary_symbol || fallbackSymbol).toUpperCase();
    const mode = routing.routing_mode || fallbackMode;
    return `${sym} - ${mode}`;
  }
  return `${fallbackSymbol} - ${fallbackMode}`;
}

const DEFAULT_STATUS: ControlStatus = {
  running: false,
  kill: false,
  status: "STOPPED",
  mode: { active: "DEMO", envelope: "demo · prop · live policy envelope" },
  routing: { primary_symbol: "XAUUSD", routing_mode: "MT5-first" },
};

export default function Topbar() {
  const [status, setStatus] = useState<ControlStatus>(DEFAULT_STATUS);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/control/status", { cache: "no-store" });
        const j = (await res.json()) as Partial<ControlStatus>;
        if (!alive) return;
        if (!j || typeof j !== "object") {
          setStatus(DEFAULT_STATUS);
          return;
        }
        setStatus((prev) => ({ ...DEFAULT_STATUS, ...prev, ...j }));
      } catch {
        if (alive) {
          setStatus((prev) => ({
            ...DEFAULT_STATUS,
            ...prev,
            status: "UNAVAILABLE",
            running: false,
            kill: false,
          }));
        }
      }
    };
    void tick();
    const id = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const kill = !!status.kill;
  const running = !!status.running;
  const modeStr = modeActive(status.mode);
  const symbolChip = routingLabel(status.routing);
  const statusTone = coerceStatusTone(status.status, running, kill);
  const statusLabel = coerceStatusLabel(status.status, running, kill);

  return (
    <div
      className="appTopbar"
      style={{
        height: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(11,17,34,0.75)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div className="appTopbarStatus" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Pill tone={statusTone}>{statusLabel}</Pill>
        <Pill>{modeStr} MODE</Pill>
        <Pill>{symbolChip}</Pill>
      </div>

      <div className="appTopbarUser" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Pill tone="muted">Dark</Pill>
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.03)",
            color: "rgba(237,242,255,0.92)",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          Admin User
          <span style={{ display: "block", color: "var(--muted)", fontSize: 11, fontWeight: 700 }}>
            Administrator
          </span>
        </div>
      </div>
    </div>
  );
}
