"use client";

import React, { useEffect, useState } from "react";

type ControlStatus = { running: boolean; mode: string; kill: boolean };

function Pill({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color =
    tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--muted)";
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
        color,
        fontSize: 12,
        fontWeight: 800
      }}
    >
      {children}
    </div>
  );
}

export default function Topbar() {
  const [status, setStatus] = useState<ControlStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/control/status", { cache: "no-store" });
        const j = (await res.json()) as ControlStatus;
        if (alive) setStatus(j);
      } catch {
        if (alive) setStatus(null);
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const running = status?.running ?? false;
  const kill = status?.kill ?? false;
  const mode = status?.mode ?? "demo";

  return (
    <div
      style={{
        height: 70,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(11,17,34,0.75)",
        backdropFilter: "blur(12px)"
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Pill tone={kill ? "bad" : running ? "ok" : "warn"}>{kill ? "HALTED" : running ? "RUNNING" : "STOPPED"}</Pill>
        <Pill>{mode.toUpperCase()} MODE</Pill>
        <Pill>XAUUSD - MT5-first</Pill>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Pill>Dark</Pill>
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.03)",
            color: "rgba(237,242,255,0.92)",
            fontSize: 12,
            fontWeight: 800
          }}
        >
          Admin User
          <span style={{ display: "block", color: "var(--muted)", fontSize: 11, fontWeight: 700 }}>Administrator</span>
        </div>
      </div>
    </div>
  );
}
