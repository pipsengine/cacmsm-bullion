/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useState } from "react";
import { NAV, type NavGroup } from "../../config/navigation";

type ControlStatus = { running: boolean; mode: string; kill: boolean };

function Pill({ label, active }: { label: string; active?: boolean }) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: "center",
        padding: "10px 0",
        borderRadius: 10,
        fontSize: 12,
        fontWeight: 700,
        background: active ? "var(--gold)" : "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        color: active ? "#0D1326" : "var(--muted)"
      }}
    >
      {label}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{
        transition: "transform 180ms ease",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        color: "var(--muted)"
      }}
    >
      <path
        d="M4.5 2.5 8.5 6l-4 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavGroupBlock({
  group,
  collapsed,
  onToggle,
  pathname
}: {
  group: NavGroup;
  collapsed: boolean;
  onToggle: () => void;
  pathname: string | null;
}) {
  const anyActive = group.items.some((it) => it.href === pathname);
  return (
    <div style={{ margin: "10px 8px" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        style={{
          all: "unset",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          boxSizing: "border-box",
          padding: "10px 10px 6px",
          borderRadius: 10
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 900,
            color: anyActive ? "#FFF2CB" : "var(--muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase"
          }}
        >
          {group.title}
        </span>
        <ChevronIcon open={!collapsed} />
      </button>
      <div
        style={{
          display: "grid",
          gap: 8,
          overflow: "hidden",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 220ms ease, margin 220ms ease",
          marginTop: collapsed ? 0 : 2
        }}
      >
        <div style={{ minHeight: 0, display: "grid", gap: 8 }}>
          {group.items.map((it) => {
            const active = pathname === it.href;
            return (
              <Link
                key={it.href}
                href={it.href}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: active ? "1px solid rgba(201,162,75,0.28)" : "1px solid rgba(255,255,255,0.04)",
                  background: active
                    ? "linear-gradient(90deg, rgba(201,162,75,0.18), rgba(201,162,75,0.06))"
                    : "transparent",
                  color: active ? "#FFF2CB" : "rgba(237,242,255,0.92)"
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>{it.title}</span>
                {it.badge ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 900,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "var(--muted)"
                    }}
                  >
                    {it.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of NAV) {
      if (g.defaultCollapsed) initial[g.title] = true;
    }
    return initial;
  });

  const toggleGroup = (title: string) => {
    setCollapsedMap((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const setGroupCollapsedByItemHref = (href: string) => {
    const group = NAV.find((g) => g.items.some((i) => i.href === href));
    if (!group) return;
    if (!collapsedMap[group.title]) return;
    setCollapsedMap((prev) => ({ ...prev, [group.title]: false }));
  };

  useEffect(() => {
    if (!pathname) return;
    setGroupCollapsedByItemHref(pathname);
  }, [pathname]);

  const refresh = async () => {
    try {
      const res = await fetch("/api/control/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as ControlStatus);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, []);

  const postControl = async (path: string, label: string) => {
    setBusy(label);
    try {
      await fetch(`/api/proxy/control/control/${path}`, { method: "POST" });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const mode = status?.mode ?? "demo";

  return (
    <aside
      className="appSidebar"
      style={{
        width: 280,
        padding: 18,
        borderRight: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(180deg, rgba(17,24,42,0.98), rgba(13,19,34,0.96))"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px 14px" }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            color: "#0D1326",
            fontWeight: 900,
            letterSpacing: "0.08em",
            background: "linear-gradient(135deg, #F0C35C, #A77C24)"
          }}
        >
          CB
        </div>
        <div>
          <div style={{ fontWeight: 800 }}>Cacsms-Bullion</div>
          <div style={{ fontSize: 11, color: "var(--gold)", fontWeight: 800, letterSpacing: "0.12em" }}>
            GOLD TRADING OS
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: 8,
          borderRadius: 16,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          margin: "0 8px 14px"
        }}
      >
        <button onClick={() => postControl("mode/demo", "demo")} style={{ all: "unset", flex: 1, cursor: "pointer" }}>
          <Pill label="DEMO" active={mode === "demo"} />
        </button>
        <button onClick={() => postControl("mode/prop", "prop")} style={{ all: "unset", flex: 1, cursor: "pointer" }}>
          <Pill label="PROP" active={mode === "prop"} />
        </button>
        <button onClick={() => postControl("mode/live", "live")} style={{ all: "unset", flex: 1, cursor: "pointer" }}>
          <Pill label="LIVE" active={mode === "live"} />
        </button>
      </div>

      <div
        style={{
          margin: "0 8px 12px",
          padding: 14,
          borderRadius: 16,
          border: "1px dashed rgba(255,255,255,0.10)",
          background: "rgba(255,255,255,0.02)"
        }}
      >
        <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 800, letterSpacing: "0.08em" }}>
          ACTIVE ACCOUNT
        </div>
        <div style={{ marginTop: 8, fontWeight: 700, color: "var(--muted)" }}>
          No account selected
        </div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
          Select an MT5 account from the sync panel
        </div>
      </div>

      <div
        style={{
          margin: "0 8px 12px",
          padding: "10px 12px",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.03)",
          color: "var(--muted)",
          fontSize: 13
        }}
      >
        Search pages, accounts...
      </div>

      <div style={{ margin: "0 8px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          ["Start", "start", "var(--ok)"],
          ["Stop", "stop", "var(--gold)"],
          ["Halt", "halt", "var(--bad)"],
          ["Unhalt", "unhalt", "var(--indigo)"]
        ].map(([label, action, color]) => (
          <button
            key={label}
            onClick={() => postControl(action, label)}
            disabled={busy === label}
            style={{
              cursor: busy ? "wait" : "pointer",
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.03)",
              fontWeight: 800,
              fontSize: 12,
              textAlign: "center",
              color
            }}
          >
            {busy === label ? "..." : label}
          </button>
        ))}
      </div>

      <div style={{ height: "calc(100vh - 420px)", overflowY: "auto", paddingRight: 6 }}>
        {NAV.map((group) => (
          <NavGroupBlock
            key={group.title}
            group={group}
            collapsed={!!collapsedMap[group.title]}
            onToggle={() => toggleGroup(group.title)}
            pathname={pathname}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 12,
          padding: 14,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "linear-gradient(180deg, rgba(22,31,53,0.95), rgba(16,23,40,0.96))"
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 13 }}>MT5 Terminal</div>
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>EA: Off - connector status unavailable</div>
      </div>
    </aside>
  );
}
