"use client";

import React from "react";

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div
      className="dashboardCard"
      style={{
        borderRadius: "var(--r-xl)",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(19,28,48,0.96), rgba(14,22,39,0.96))",
        padding: 16
      }}
    >
      {title ? <div className="dashboardCardTitle">{title}</div> : null}
      {children}
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="kpiCard"
      style={{
        borderRadius: "var(--r-md)",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
        padding: 14
      }}
    >
      <div style={{ color: "var(--muted)", fontSize: 12, fontWeight: 900, letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, marginTop: 8 }}>{value}</div>
      {hint ? <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6 }}>{hint}</div> : null}
    </div>
  );
}

export function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre
      className="jsonBlock"
      style={{
        margin: 0,
        padding: 12,
        borderRadius: "var(--r-md)",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(11,16,32,0.55)",
        overflowX: "auto",
        color: "rgba(237,242,255,0.92)",
        fontSize: 12
      }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

