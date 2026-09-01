"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AccountMode = "DEMO" | "PROP" | "LIVE";
type AccountStatus = "ACTIVE" | "INACTIVE" | "CONNECTING" | "ERROR" | "DISABLED";
type SyncStatus = "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" | "SKIPPED" | "CANCELLED";

type Mt5Account = {
  id: string;
  broker_name: string;
  account_login: number;
  account_server: string;
  account_password?: string | null;
  account_mode: AccountMode;
  currency: string;
  leverage: number;
  company?: string | null;
  status: AccountStatus;
  is_active: boolean;
  sync_enabled: boolean;
  sync_interval_seconds: number;
  last_sync_at?: string | null;
  last_sync_status?: string | null;
  last_sync_message?: string | null;
  balance?: number | null;
  equity?: number | null;
  margin?: number | null;
  free_margin?: number | null;
  margin_level?: number | null;
  floating_pl?: number | null;
  profit_today?: number | null;
  positions_count?: number | null;
  orders_count?: number | null;
  deals_count?: number | null;
  display_name?: string | null;
  tags?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

type SyncRun = {
  id: string;
  account_id: string;
  started_at: string;
  finished_at?: string | null;
  status: SyncStatus;
  trigger: "MANUAL" | "SCHEDULED" | "API" | "STARTUP" | "RETRY";
  duration_ms?: number | null;
  balance_before?: number | null;
  balance_after?: number | null;
  equity_before?: number | null;
  equity_after?: number | null;
  positions_before?: number | null;
  positions_after?: number | null;
  orders_before?: number | null;
  orders_after?: number | null;
  deals_synced?: number | null;
  positions_synced?: number | null;
  orders_synced?: number | null;
  error_message?: string | null;
  gateway_info?: string | null;
};

type SyncLogLine = {
  id: number;
  sync_run_id?: string | null;
  account_id?: string | null;
  logged_at: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
  category: string;
  message: string;
};

type SyncSummary = {
  accounts_total: number;
  accounts_active: number;
  sync_enabled: number;
  syncs_last_24h: number;
  syncs_success_last_24h: number;
  syncs_failed_last_24h: number;
  total_balance: number;
  total_equity: number;
  total_positions: number;
  last_sync_age_ms?: number | null;
  oldest_sync_age_ms?: number | null;
};

type ControlStatusModeShape = string | { active?: string | null; envelope?: string | null } | null | undefined;
type ControlStatus = {
  running?: boolean | null;
  kill?: boolean | null;
  mode?: ControlStatusModeShape;
  status?: string | null;
  routing?: string | { primary_symbol?: string; routing_mode?: string } | null;
};
type HealthSummary = {
  running?: boolean | null;
  mode?: ControlStatusModeShape;
  kill?: boolean | null;
  last_tick_age_ms: number | null;
  last_decision_age_ms: number | null;
  notes: string[];
};

function toActiveMode(mode: ControlStatusModeShape, fallback = "DEMO"): string {
  if (mode == null) return fallback.toUpperCase();
  if (typeof mode === "string") return mode.toUpperCase();
  if (typeof mode.active === "string") return mode.active.toUpperCase();
  return fallback.toUpperCase();
}

function safeUpper(s: unknown, fallback = ""): string {
  if (typeof s === "string") return s.toUpperCase();
  return fallback;
}

const STYLES = `
  .masPage{ color:#ecf3ff; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; width:min(1760px, 100%); margin:0 auto 48px; }
  .masHero{ display:grid; grid-template-columns: 1fr auto; gap:18px; align-items:flex-end; margin-bottom:14px; }
  .masHero h1{ margin:0; font-size:clamp(1.4rem, 2vw, 2rem); letter-spacing:0.04em; }
  .masHero p{ margin:6px 0 0; color:#91a5c9; line-height:1.45; font-size:0.94rem; }
  .masBreadcrumb{ color:#91a5c9; font-size:12px; margin-bottom:10px; }
  .masBreadcrumb strong{ color:#ecf3ff; font-weight:800; }
  .masToolbar{ display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
  .masChip, .masChipErr, .masChipOk, .masChipWarn{ display:inline-flex; align-items:center; gap:8px; border-radius:999px; border:1px solid #32456a; background:rgba(17,28,47,0.92); color:#ecf3ff; padding:9px 14px; font-weight:600; font-size:0.88rem; }
  .masChipOk{ border-color:#2a7a48; }
  .masChipWarn{ border-color:#a87a1a; }
  .masChipErr{ border-color:#a22; }
  .masDot{ width:10px; height:10px; border-radius:50%; background:#f5c24a; box-shadow:0 0 10px rgba(245,194,74,0.9); }
  .masDotOk{ background:#48d976; box-shadow:0 0 10px rgba(72,217,118,0.9); }
  .masDotErr{ background:#ef5350; box-shadow:0 0 10px rgba(239,83,80,0.9); }
  .masBanner{ padding:11px 16px; border-radius:12px; margin-bottom:14px; border:1px solid #a87a1a; background:rgba(210,160,60,0.10); color:#ffd88a; font-size:0.9rem; display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap; }
  .masBannerErr{ border-color:#a22; background:rgba(220,70,70,0.10); color:#ff9e9e; }
  .masBannerOk{ border-color:#2a7a48; background:rgba(60,180,110,0.08); color:#b5f5c9; }
  .masKpis{ display:grid; grid-template-columns: repeat(8, 1fr); gap:10px; margin-bottom:14px; }
  .masKpi{ border-radius:14px; padding:12px 14px; border:1px solid rgba(255,255,255,0.06); background:linear-gradient(180deg, rgba(26,41,66,0.86), rgba(12,22,39,0.92)); }
  .masKpi > label{ display:block; font-size:0.74rem; color:#91a5c9; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; }
  .masKpi > strong{ display:block; margin-top:6px; font-size:1.2rem; font-variant-numeric:tabular-nums; }
  .masKpi > span{ display:block; margin-top:4px; color:#91a5c9; font-size:0.78rem; }
  .masGridTop{ display:grid; grid-template-columns: 1.6fr 1fr; gap:14px; margin-bottom:14px; }
  .masGridBot{ display:grid; grid-template-columns: 1.4fr 1fr; gap:14px; }
  .masPanel{ background:linear-gradient(180deg, rgba(26,41,66,0.92), rgba(12,22,39,0.96)); border:1px solid #32456a; border-radius:18px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,0.24); }
  .masPanelHead{ display:flex; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid #32456a; background:rgba(255,255,255,0.025); align-items:center; flex-wrap:wrap; }
  .masPanelHead h2{ margin:0; font-size:0.92rem; letter-spacing:0.05em; }
  .masPanelHead span{ color:#91a5c9; font-size:0.84rem; font-variant-numeric:tabular-nums; }
  .masBody{ padding:12px 14px; }
  .masFormGrid{ display:grid; grid-template-columns: repeat(2, 1fr); gap:10px 12px; }
  .masField{ display:grid; gap:5px; }
  .masField.full{ grid-column: 1 / -1; }
  .masField label{ font-size:0.74rem; color:#91a5c9; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; }
  .masField input, .masField select, .masField textarea{ background:rgba(8,14,28,0.7); border:1px solid #32456a; color:#ecf3ff; padding:9px 10px; border-radius:10px; font-size:0.92rem; font-variant-numeric:tabular-nums; outline:none; font-family:inherit; }
  .masField textarea{ resize:vertical; min-height:68px; }
  .masField input:focus, .masField select:focus, .masField textarea:focus{ border-color:#6785bf; }
  .masFieldRow{ display:flex; gap:8px; }
  .masSubmit{ grid-column: 1 / -1; padding:12px 14px; border-radius:12px; border:1px solid #2a7a48; background:linear-gradient(180deg, #2a7a48, #174a2a); color:#fff; font-weight:900; letter-spacing:0.08em; cursor:pointer; }
  .masSubmit:disabled{ opacity:0.5; cursor:not-allowed; }
  .masSubmitDanger{ border-color:#861a1a; background:linear-gradient(180deg, #b92a2a, #691212); }
  .masBtn{ background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); color:#ecf3ff; padding:5px 10px; border-radius:8px; cursor:pointer; font-size:0.78rem; font-weight:700; margin-left:4px; }
  .masBtn:hover{ border-color:#6785bf; background:rgba(103,133,191,0.12); }
  .masBtnDanger{ border-color:#a22; color:#ff8282; }
  .masBtnDanger:hover{ background:rgba(220,70,70,0.10); }
  .masBtnPrimary{ border-color:#2a7a48; color:#65ea8b; }
  .masBtnPrimary:hover{ background:rgba(47,169,95,0.12); }
  .masBtnSmall{ padding:3px 8px; font-size:0.7rem; }
  .masTableWrap{ overflow:auto; max-height:560px; }
  .masTable{ width:100%; min-width:1100px; border-collapse: separate; border-spacing:0; }
  .masTable thead th{ position:sticky; top:0; z-index:3; background:#d9e7f0; color:#10203e; padding:10px 10px; border-right:1px solid #b4c4d6; border-bottom:1px solid #b4c4d6; font-size:0.76rem; letter-spacing:0.06em; font-weight:800; text-transform:uppercase; white-space:nowrap; text-align:left; }
  .masTable thead th:last-child{ text-align:right; }
  .masTable td{ padding:9px 10px; border-bottom:1px solid rgba(255,255,255,0.06); font-size:0.84rem; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .masTable td.num{ text-align:right; }
  .masTable td.act{ text-align:right; }
  .masRow{ transition: background 120ms ease; cursor:pointer; }
  .masRow:hover{ background:rgba(255,255,255,0.025); }
  .masRow.selected{ background:rgba(103,133,191,0.14); }
  .masModeTag, .masStatusTag, .masSyncTag, .masTriggerTag{ padding:3px 8px; border-radius:6px; font-size:0.72rem; font-weight:800; letter-spacing:0.06em; text-transform:uppercase; display:inline-block; }
  .masModeDEMO{ background:rgba(103,133,191,0.16); color:#c9daff; border:1px solid #6785bf60; }
  .masModePROP{ background:rgba(201,162,75,0.14); color:#f0d28a; border:1px solid #c9a24b60; }
  .masModeLIVE{ background:rgba(224,84,84,0.15); color:#ff8282; border:1px solid #e0545480; }
  .masStatusACTIVE, .masStatusRUNNING, .masStatusSUCCESS, .masSyncOk{ background:rgba(47,169,95,0.15); color:#65ea8b; border:1px solid #2fa95f80; }
  .masStatusINACTIVE, .masStatusSKIPPED{ background:rgba(255,255,255,0.04); color:#91a5c9; border:1px solid rgba(255,255,255,0.08); }
  .masStatusCONNECTING, .masStatusPARTIAL{ background:rgba(245,194,74,0.12); color:#ffd88a; border:1px solid #a87a1a60; }
  .masStatusERROR, .masStatusFAILED, .masStatusDISABLED, .masStatusCANCELLED, .masSyncFail{ background:rgba(224,84,84,0.15); color:#ff8282; border:1px solid #e0545480; }
  .masTriggerTag{ background:rgba(103,133,191,0.16); color:#c9daff; border:1px solid #6785bf60; opacity:0.92; }
  .masProfitUp{ color:#65ea8b; font-weight:700; }
  .masProfitDown{ color:#ff8282; font-weight:700; }
  .masEmpty{ padding:26px; color:#91a5c9; text-align:center; font-size:0.9rem; }
  .masKv{ display:grid; grid-template-columns: 160px 1fr; gap:6px 12px; font-size:0.86rem; }
  .masKv dt{ color:#91a5c9; font-weight:700; letter-spacing:0.04em; }
  .masKv dd{ margin:0; color:#ecf3ff; font-variant-numeric:tabular-nums; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .masLogWrap{ max-height:420px; overflow:auto; padding:10px 12px; font-size:0.80rem; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .masLogLine{ display:grid; grid-template-columns: 72px 54px 54px 1fr; gap:8px; padding:4px 2px; border-bottom:1px dashed rgba(255,255,255,0.04); }
  .masLogInfo{ color:#c7d6ee; }
  .masLogOk{ color:#65ea8b; }
  .masLogWarn{ color:#ffd88a; }
  .masLogErr{ color:#ff8282; }
  .masLogCat{ font-weight:900; letter-spacing:0.08em; opacity:0.92; }
  .masSectionTitle{ color:#91a5c9; font-size:0.78rem; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; margin:14px 2px 8px; }
  .masMiniRow{ display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-top:10px; }
  .masMini{ border-radius:12px; padding:10px 12px; border:1px solid rgba(255,255,255,0.06); background:rgba(255,255,255,0.025); }
  .masMini label{ display:block; color:#91a5c9; font-size:0.7rem; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; }
  .masMini strong{ display:block; margin-top:4px; font-size:1rem; font-variant-numeric:tabular-nums; }
  .masDivider{ height:1px; background:rgba(255,255,255,0.06); margin:14px 0; }
  .masTabs{ display:flex; gap:4px; padding:4px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); border-radius:12px; }
  .masTab{ padding:7px 12px; border-radius:8px; cursor:pointer; font-size:0.82rem; font-weight:700; color:#91a5c9; border:none; background:transparent; }
  .masTab.active{ background:rgba(103,133,191,0.18); color:#ecf3ff; }
  @media (max-width: 1520px){
    .masKpis{ grid-template-columns: repeat(4, 1fr); }
    .masGridTop, .masGridBot{ grid-template-columns: 1fr; }
  }
  @media (max-width: 820px){
    .masKpis{ grid-template-columns: repeat(2, 1fr); }
    .masFormGrid{ grid-template-columns: 1fr; }
  }
`;

function fmtNum(v: number | null | undefined, digits = 2, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Number(v);
  return (signed && n > 0 ? "+" : "") + n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtMoney(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const n = Number(v);
  const sign = signed && n > 0 ? "+" : "";
  return sign + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "2-digit", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function logLevelClass(l: SyncLogLine["level"]) {
  if (l === "SUCCESS") return "masLogOk";
  if (l === "WARN") return "masLogWarn";
  if (l === "ERROR") return "masLogErr";
  return "masLogInfo";
}

function modeCls(m: AccountMode) {
  if (m === "DEMO") return "masModeDEMO";
  if (m === "PROP") return "masModePROP";
  return "masModeLIVE";
}

function statusCls(s: AccountStatus | SyncStatus | string | undefined) {
  switch (s) {
    case "ACTIVE": return "masStatusACTIVE";
    case "INACTIVE": return "masStatusINACTIVE";
    case "CONNECTING": return "masStatusCONNECTING";
    case "ERROR": return "masStatusERROR";
    case "DISABLED": return "masStatusDISABLED";
    case "RUNNING": return "masStatusRUNNING";
    case "SUCCESS": return "masStatusSUCCESS";
    case "FAILED": return "masStatusFAILED";
    case "PARTIAL": return "masStatusPARTIAL";
    case "SKIPPED": return "masStatusSKIPPED";
    case "CANCELLED": return "masStatusCANCELLED";
    default: return "masStatusINACTIVE";
  }
}

type BrokerCatalogEntry = {
  servers: string[];
  default_server?: string;
  company?: string;
  default_mode?: AccountMode;
  default_leverage?: number;
};

const BROKER_SERVERS: Record<string, BrokerCatalogEntry> = {
  "IC Markets": {
    servers: [
      "ICMarkets-Demo", "ICMarkets-Demo2",
      "ICMarkets-Live", "ICMarkets-Live02", "ICMarkets-Live03",
      "ICMarkets-Server01", "ICMarkets-Server02", "ICMarkets-Server03",
      "ICMarkets-SC", "ICMarkets-ECN",
      "ICMarketsEU-Demo", "ICMarketsEU-Live", "ICMarketsEU-ECN"
    ],
    default_server: "ICMarkets-Demo",
    company: "IC Markets (EU) Ltd / True ECN Trading Pty Ltd",
    default_leverage: 500
  },
  "FTMO": {
    servers: [
      "FTMO-Demo",
      "FTMO-Challenge", "FTMO-Verification", "FTMO-SwapFree",
      "FTMO-Server", "FTMO-Server2", "FTMO-Server3",
      "FTMO-Funded", "FTMO-ECN"
    ],
    default_server: "FTMO-Challenge",
    company: "FTMO s.r.o.",
    default_mode: "PROP",
    default_leverage: 100
  },
  "My Forex Funds": {
    servers: [
      "MFF-Demo",
      "MFF-Phase1", "MFF-Phase2", "MFF-Funded",
      "MFF-ECN", "MFF-SwapFree", "MFF-REP",
      "MFF-Standard-Phase1", "MFF-Standard-Phase2", "MFF-Standard-Funded",
      "MFF-ECN-Phase1", "MFF-ECN-Phase2", "MFF-ECN-Funded"
    ],
    default_server: "MFF-Phase1",
    company: "My Forex Funds Inc.",
    default_mode: "PROP"
  },
  "The Funded Trader": {
    servers: [
      "TFT-Demo",
      "TFT-Phase1", "TFT-Phase2", "TFT-Funded",
      "TFT-Standard-Phase1", "TFT-Standard-Phase2", "TFT-Standard-Funded",
      "TFT-Rapid-Phase1", "TFT-Rapid-Phase2", "TFT-Rapid-Funded"
    ],
    default_server: "TFT-Phase1",
    company: "The Funded Trader Program LLC",
    default_mode: "PROP"
  },
  "Funded Next": {
    servers: [
      "FundedNext-Demo",
      "FundedNext-Stellar-Phase1", "FundedNext-Stellar-Phase2", "FundedNext-Stellar-Funded",
      "FundedNext-Challenge-Phase1", "FundedNext-Challenge-Phase2", "FundedNext-Challenge-Funded",
      "FundedNext-Express-Phase1", "FundedNext-Express-Phase2", "FundedNext-Express-Funded"
    ],
    default_server: "FundedNext-Stellar-Phase1",
    company: "Funded Next Ltd.",
    default_mode: "PROP"
  },
  "E8 Funding": {
    servers: [
      "E8-Demo",
      "E8-Phase1", "E8-Phase2", "E8-Verification", "E8-Funded",
      "E8-Account-Phase1", "E8-Account-Phase2", "E8-Account-Funded",
      "E8-ELITE-Phase1", "E8-ELITE-Phase2", "E8-ELITE-Funded"
    ],
    default_server: "E8-Phase1",
    company: "E8 Trading LLC",
    default_mode: "PROP"
  },
  "True Forex Funds": {
    servers: [
      "TFF-Demo",
      "TFF-Phase1", "TFF-Phase2", "TFF-Funded",
      "TFF-One-Step", "TFF-One-Step-Funded",
      "TFF-Evaluation", "TFF-Funded-Live"
    ],
    default_server: "TFF-Phase1",
    company: "True Forex Funds Kft.",
    default_mode: "PROP"
  },
  "FTUK": {
    servers: [
      "FTUK-Demo",
      "FTUK-Evaluation", "FTUK-Evaluation-Phase2", "FTUK-Funded",
      "FTUK-Instant", "FTUK-Instant-Funded",
      "FTUK-Hybrid-Evaluation", "FTUK-Hybrid-Funded"
    ],
    default_server: "FTUK-Evaluation",
    company: "FTUK Trading Ltd.",
    default_mode: "PROP"
  },
  "Alpha Capital Group": {
    servers: [
      "ACG-Demo",
      "ACG-Evaluation", "ACG-Evaluation-Phase2", "ACG-Funded",
      "ACG-Two-Step", "ACG-One-Step", "ACG-One-Step-Funded"
    ],
    default_server: "ACG-Evaluation",
    company: "Alpha Capital Group Ltd.",
    default_mode: "PROP"
  },
  "Eightcap": {
    servers: [
      "Eightcap-Demo", "Eightcap-Demo2",
      "Eightcap-Live", "Eightcap-Live2", "Eightcap-Live3",
      "Eightcap-ICTS", "Eightcap-Prime", "Eightcap-ECN",
      "EightcapAU-Demo", "EightcapAU-Live",
      "EightcapUK-Demo", "EightcapUK-Live"
    ],
    default_server: "Eightcap-Demo",
    company: "Eightcap Pty Ltd / Eightcap UK Ltd.",
    default_leverage: 500
  },
  "Pepperstone": {
    servers: [
      "Pepperstone-Demo", "Pepperstone-Demo2",
      "Pepperstone-Live", "Pepperstone-Live-1", "Pepperstone-Live-2",
      "Pepperstone-ECN", "Pepperstone-Standard", "Pepperstone-Razor",
      "PepperstoneAU-Demo", "PepperstoneAU-Live",
      "PepperstoneUK-Demo", "PepperstoneUK-Live"
    ],
    default_server: "Pepperstone-Demo",
    company: "Pepperstone Group Limited",
    default_leverage: 400
  },
  "XM": {
    servers: [
      "XM-Demo", "XM-Demo-2",
      "XM-MT5-Live", "XM-MT5-Live-2",
      "XM-Zero-Live", "XM-Zero-Demo",
      "XM-UltraLow-Demo", "XM-UltraLow-Live"
    ],
    default_server: "XM-Demo",
    company: "XM Global Ltd.",
    default_leverage: 1000
  },
  "FxPro": {
    servers: [
      "FxPro-Demo", "FxPro-Demo-ECN",
      "FxPro-Live", "FxPro-ECN-Live", "FxPro-RawSpread-Live",
      "FxPro-MT5-Demo", "FxPro-MT5-Live"
    ],
    default_server: "FxPro-Demo",
    company: "FxPro Financial Services Ltd.",
    default_leverage: 500
  },
  "Admirals": {
    servers: [
      "Admirals-Demo", "Admirals-MT5-Demo",
      "Admirals-Live", "Admirals-MT5-Live",
      "Admirals-ECN-Demo", "Admirals-ECN-Live",
      "Admiral-Demo", "Admiral-Live"
    ],
    default_server: "Admirals-Demo",
    company: "Admirals Group AS",
    default_leverage: 500
  },
  "Tickmill": {
    servers: [
      "Tickmill-Demo",
      "Tickmill-Live", "Tickmill-Live-2",
      "Tickmill-Pro-Live", "Tickmill-Pro-Demo",
      "Tickmill-VIP-Live", "Tickmill-VIP-Demo",
      "Tickmill-ECN-Demo", "Tickmill-ECN-Live"
    ],
    default_server: "Tickmill-Demo",
    company: "Tickmill Group Ltd.",
    default_leverage: 500
  },
  "RoboForex": {
    servers: [
      "RoboForex-Demo", "RoboForex-MT5-Demo",
      "RoboForex-Live", "RoboForex-Cent-Live", "RoboForex-ECN-Live",
      "RoboForex-Prime", "RoboForex-Pro"
    ],
    default_server: "RoboForex-Demo",
    company: "RoboForex Ltd.",
    default_leverage: 1000
  },
  "HF Markets": {
    servers: [
      "HF-Demo", "HF-MT5-Demo",
      "HF-Live", "HF-Zero-Spread", "HF-ECN-Live",
      "HotForex-Demo", "HotForex-Live"
    ],
    default_server: "HF-Demo",
    company: "HF Markets Ltd.",
    default_leverage: 1000
  },
  "Exness": {
    servers: [
      "Exness-Demo", "Exness-MT5-Demo",
      "Exness-MT5-Live", "Exness-MT5-Live-2",
      "Exness-Cent-Demo", "Exness-Cent-Live",
      "Exness-Pro-Demo", "Exness-Pro-Live",
      "Exness-RawSpread-Demo", "Exness-RawSpread-Live"
    ],
    default_server: "Exness-Demo",
    company: "Exness Holdings CY Ltd.",
    default_leverage: 2000
  },
  "OANDA": {
    servers: [
      "OANDA-Demo", "OANDA-MT5-Demo",
      "OANDA-Live", "OANDA-MT5-Live",
      "OANDA-Live-1", "OANDA-Live-2"
    ],
    default_server: "OANDA-Demo",
    company: "OANDA Global Markets, Inc.",
    default_leverage: 100
  },
  "IG": {
    servers: [
      "IG-Demo", "IG-MT5-Demo",
      "IG-MT5-Live", "IG-MT5-Live-2",
      "IG-Live-Streamed", "IG-Streamed-Demo"
    ],
    default_server: "IG-Demo",
    company: "IG Markets Ltd.",
    default_leverage: 200
  },
  "Swissquote": {
    servers: [
      "Swissquote-Demo", "Swissquote-MT5-Demo",
      "Swissquote-MT5-Live", "Swissquote-Live",
      "Swissquote-Advenced-MT5"
    ],
    default_server: "Swissquote-Demo",
    company: "Swissquote Bank SA",
    default_leverage: 100
  },
  "City Index": {
    servers: [
      "CityIndex-Demo", "CityIndex-MT5-Demo",
      "CityIndex-Live", "CityIndex-MT5-Live",
      "CityIndex-Advanced-Demo"
    ],
    default_server: "CityIndex-Demo",
    company: "City Index Ltd.",
    default_leverage: 200
  },
  "FXCM": {
    servers: [
      "FXCM-Demo", "FXCM-MT5-Demo",
      "FXCM-Live", "FXCM-MT5-Live",
      "FXCM-TradeStation-Demo", "FXCM-Active-Demo"
    ],
    default_server: "FXCM-Demo",
    company: "FXCM LLC / FXCM Markets Ltd.",
    default_leverage: 400
  },
  "Interactive Brokers": {
    servers: [
      "IBKR-Demo", "IBKR-Paper",
      "IBKR-MT5-Demo", "IBKR-MT5-Live",
      "IBKR-Live", "IBKR-Server"
    ],
    default_server: "IBKR-MT5-Demo",
    company: "Interactive Brokers LLC",
    default_leverage: 50
  },
  "Lux Trading Firm": {
    servers: [
      "Lux-Demo",
      "Lux-Challenge-Phase1", "Lux-Challenge-Phase2", "Lux-Funded",
      "Lux-OneStep", "Lux-OneStep-Funded",
      "Lux-Trader-Phase1", "Lux-Trader-Phase2", "Lux-Trader-Funded"
    ],
    default_server: "Lux-Challenge-Phase1",
    company: "Lux Trading Firm Ltd.",
    default_mode: "PROP"
  },
  "Instant Funding Prophets": {
    servers: [
      "IFP-Demo",
      "IFP-Challenge", "IFP-Phase2", "IFP-Funded",
      "IFP-Evaluation", "IFP-OneStep", "IFP-OneStep-Funded"
    ],
    default_server: "IFP-Challenge",
    company: "Instant Funding Prophets Ltd.",
    default_mode: "PROP"
  }
};

const KNOWN_BROKER_NAMES = Object.keys(BROKER_SERVERS).sort();

function findBrokerEntry(name: string): BrokerCatalogEntry | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  for (const brokerName of KNOWN_BROKER_NAMES) {
    if (brokerName.toLowerCase() === key) {
      return BROKER_SERVERS[brokerName];
    }
  }
  return null;
}

function normalizeBrokerName(raw: string): string {
  if (!raw) return "";
  const key = raw.trim().toLowerCase();
  for (const brokerName of KNOWN_BROKER_NAMES) {
    if (brokerName.toLowerCase() === key) {
      return brokerName;
    }
  }
  return raw.trim();
}

const DEFAULT_ACCOUNTS: Omit<Mt5Account, "id" | "created_at" | "updated_at">[] = [];

type MssqlDiagnostics = {
  ok: boolean;
  server_reachable?: boolean;
  tcp_ok?: boolean;
  sql_authentication_enabled?: boolean;
  admin_login_ok?: boolean;
  admin_reason?: string;
  database_exists?: boolean;
  app_login_exists?: boolean;
  app_user_ok?: boolean;
  schema_ok?: boolean;
  app_reason?: string;
  last_error?: string;
  config: {
    server: string;
    port: number;
    database: string;
    admin_user: string;
    admin_password_set: boolean;
    app_user: string;
    app_password_set: boolean;
    encrypt: boolean;
    trust_cert: boolean;
  };
  recovery_steps?: string[];
};

type ApiErrorWithDiagnostics = Error & { diagnostics?: MssqlDiagnostics | null; status?: number };

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : (init?.headers ?? {})
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = typeof data === "object" && data?.message ? data.message : `HTTP ${res.status}`;
    const diagnostics: MssqlDiagnostics | null =
      typeof data === "object" && data?.diagnostics ? (data.diagnostics as MssqlDiagnostics) : null;
    const err = new Error(msg) as ApiErrorWithDiagnostics;
    err.diagnostics = diagnostics;
    err.status = res.status;
    throw err;
  }
  return data as T;
}

type FormState = {
  broker_name: string;
  account_login: string;
  account_server: string;
  account_password: string;
  account_mode: AccountMode;
  currency: string;
  leverage: string;
  company: string;
  status: AccountStatus;
  is_active: boolean;
  sync_enabled: boolean;
  sync_interval_seconds: string;
  display_name: string;
  tags: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  broker_name: "",
  account_login: "",
  account_server: "",
  account_password: "",
  account_mode: "DEMO",
  currency: "USD",
  leverage: "100",
  company: "",
  status: "ACTIVE",
  is_active: true,
  sync_enabled: true,
  sync_interval_seconds: "30",
  display_name: "",
  tags: "",
  notes: ""
};

function formToInput(f: FormState) {
  return {
    broker_name: f.broker_name.trim(),
    account_login: parseInt(f.account_login || "0", 10) || 0,
    account_server: f.account_server.trim(),
    account_password: f.account_password || null,
    account_mode: f.account_mode,
    currency: f.currency.trim() || "USD",
    leverage: parseInt(f.leverage || "0", 10) || 0,
    company: f.company.trim() || null,
    status: f.status ?? (f.is_active ? "ACTIVE" : "INACTIVE"),
    is_active: f.is_active,
    sync_enabled: f.sync_enabled,
    sync_interval_seconds: parseInt(f.sync_interval_seconds || "0", 10) || 30,
    display_name: f.display_name.trim() || null,
    tags: f.tags.trim() || null,
    notes: f.notes.trim() || null
  };
}

export default function Mt5AccountSyncPage() {
  const [control, setControl] = useState<ControlStatus | null>(null);
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [accounts, setAccounts] = useState<Mt5Account[]>([]);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [logs, setLogs] = useState<SyncLogLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDiagnostics, setErrorDiagnostics] = useState<MssqlDiagnostics | null>(null);
  const [currentErrorHash, setCurrentErrorHash] = useState<string>("");
  const [bannerOpen, setBannerOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; message: string } | null>(null);
  const [tab, setTab] = useState<"details" | "runs" | "logs">("details");
  const [filters, setFilters] = useState<{ modes: AccountMode[]; statuses: AccountStatus[] }>({ modes: [], statuses: [] });

  const syncingIdsRef = useRef<Set<string>>(new Set());

  const LS_DISMISSED = "mas.errors.dismissed.v1";
  const hashString = (s: string): string => {
    let h1 = 0x811c9dc5, h2 = 0xdeadbeef;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761) >>> 0;
      h2 = Math.imul(h2 ^ c, 1597334677) >>> 0;
    }
    return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16)).slice(0, 12);
  };
  const getDismissedHashes = (): Set<string> => {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem(LS_DISMISSED);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr.filter((x: any) => typeof x === "string") : []);
    } catch { return new Set(); }
  };
  const addDismissedHash = (hash: string) => {
    if (typeof window === "undefined" || !hash) return;
    try {
      const next = Array.from(getDismissedHashes().add(hash)).slice(-64);
      window.localStorage.setItem(LS_DISMISSED, JSON.stringify(next));
    } catch { /* noop */ }
  };
  const errorInfo = useMemo(() => {
    const hash = error
      ? hashString(`${error}|${JSON.stringify(errorDiagnostics?.last_error ?? null)}|${JSON.stringify(errorDiagnostics?.schema_ok ?? null)}`)
      : "";
    const dismissed = getDismissedHashes();
    return {
      hash,
      hasError: !!error,
      dismissed: hash ? dismissed.has(hash) : true,
      newBadge: hash && !dismissed.has(hash) ? 1 : 0,
    };
  }, [error, errorDiagnostics]);

  useEffect(() => {
    if (errorInfo.hash && errorInfo.hash !== currentErrorHash) {
      setCurrentErrorHash(errorInfo.hash);
    }
  }, [errorInfo.hash, currentErrorHash]);

  const dismissCurrent = () => {
    addDismissedHash(errorInfo.hash);
    setBannerOpen(false);
  };

  const showToast = (type: "ok" | "err", message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 3600);
  };

  const loadDashboard = useCallback(async () => {
    type Resp<T> = { ok: true; value: T } | { ok: false; err: ApiErrorWithDiagnostics };
    const safeApi = async <T,>(path: string, init?: RequestInit): Promise<Resp<T>> => {
      try { return { ok: true, value: await api<T>(path, init) }; }
      catch (e: any) { return { ok: false, err: e }; }
    };
    const [c, h, sumR, accR, runsR, logsR] = await Promise.all([
      fetch("/api/control/status", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/monitoring/summary", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      safeApi<{ ok: boolean; summary: SyncSummary }>("/api/mt5-account-sync/summary"),
      safeApi<{ ok: boolean; accounts: Mt5Account[] }>("/api/mt5-account-sync/accounts"),
      safeApi<{ ok: boolean; runs: SyncRun[] }>("/api/mt5-account-sync/sync-runs?limit=60"),
      safeApi<{ ok: boolean; logs: SyncLogLine[] }>("/api/mt5-account-sync/sync-logs?limit=200"),
    ]);
    if (c) setControl(c);
    if (h) setHealth(h);

    let firstDiag: MssqlDiagnostics | null = null;
    let firstMsg: string | null = null;
    const settled: { ok: boolean; err?: ApiErrorWithDiagnostics }[] = [sumR, accR, runsR, logsR];
    for (const r of settled) {
      if (!r.ok) {
        if (!firstMsg) firstMsg = r.err?.message ?? null;
        if (!firstDiag && r.err?.diagnostics) firstDiag = r.err.diagnostics;
      }
    }

    const sumResp = sumR.ok ? sumR.value : null;
    const accResp = accR.ok ? accR.value : null;
    const runsResp = runsR.ok ? runsR.value : null;
    const logsResp = logsR.ok ? logsR.value : null;

    if (sumResp?.ok) setSummary(sumResp.summary);
    if (accResp?.ok) {
      const list = accResp.accounts;
      setAccounts(list);
      if (!selectedId && list.length) setSelectedId(list[0].id);
      if (!list.length && DEFAULT_ACCOUNTS.length) {
        for (const seed of DEFAULT_ACCOUNTS) {
          const seedR = await safeApi<any>("/api/mt5-account-sync/accounts", { method: "POST", body: JSON.stringify(seed) });
          if (!seedR.ok) break;
        }
        const freshR = await safeApi<{ ok: boolean; accounts: Mt5Account[] }>("/api/mt5-account-sync/accounts");
        if (freshR.ok && freshR.value?.ok) {
          setAccounts(freshR.value.accounts);
          if (freshR.value.accounts.length) setSelectedId(freshR.value.accounts[0].id);
        }
      }
    }
    if (runsResp?.ok) setRuns(runsResp.runs);
    if (logsResp?.ok) setLogs(logsResp.logs);

    if (!firstMsg) {
      setError(null);
      setErrorDiagnostics(null);
    } else {
      setError(firstMsg);
      setErrorDiagnostics(firstDiag);
    }
  }, [selectedId]);

  useEffect(() => {
    let alive = true;
    void loadDashboard();
    const id = setInterval(() => {
      if (alive) void loadDashboard();
    }, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [loadDashboard]);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((a) => {
      if (filters.modes.length && !filters.modes.includes(a.account_mode)) return false;
      if (filters.statuses.length && !filters.statuses.includes(a.status)) return false;
      return true;
    });
  }, [accounts, filters]);

  const selected = useMemo(
    () => (selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null),
    [accounts, selectedId]
  );

  const selectedRuns = useMemo(() => selectedId ? runs.filter((r) => r.account_id === selectedId) : runs, [runs, selectedId]);
  const selectedLogs = useMemo(() => selectedId ? logs.filter((l) => l.account_id === selectedId) : logs, [logs, selectedId]);

  const currentBrokerEntry = useMemo<BrokerCatalogEntry | null>(() => findBrokerEntry(form.broker_name), [form.broker_name]);
  const serverOptions = useMemo<string[]>(() => currentBrokerEntry?.servers ?? [], [currentBrokerEntry]);

  const handleBrokerChange = (rawValue: string) => {
    const entry = findBrokerEntry(rawValue);
    const matchedName = entry ? normalizeBrokerName(rawValue) : rawValue.trim();
    setForm((prev) => {
      const next: FormState = { ...prev, broker_name: matchedName };
      if (!entry) return next;
      if (entry.default_server && !prev.account_server.trim()) {
        next.account_server = entry.default_server;
      }
      if (entry.company && !prev.company.trim()) {
        next.company = entry.company;
      }
      if (entry.default_mode && prev.account_mode === EMPTY_FORM.account_mode) {
        next.account_mode = entry.default_mode;
      }
      if (typeof entry.default_leverage === "number" && !prev.leverage.trim()) {
        next.leverage = String(entry.default_leverage);
      }
      if (!prev.display_name.trim()) {
        const modeTag = entry.default_mode ? ` · ${entry.default_mode}` : "";
        next.display_name = `${matchedName}${modeTag}`;
      }
      return next;
    });
  };

  const startCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, account_mode: "DEMO", status: "ACTIVE", is_active: true, sync_enabled: true });
  };

  const startEdit = (acc: Mt5Account) => {
    setEditingId(acc.id);
    setForm({
      broker_name: acc.broker_name,
      account_login: String(acc.account_login),
      account_server: acc.account_server,
      account_password: acc.account_password ?? "",
      account_mode: acc.account_mode,
      currency: acc.currency,
      leverage: String(acc.leverage),
      company: acc.company ?? "",
      status: acc.status,
      is_active: acc.is_active,
      sync_enabled: acc.sync_enabled,
      sync_interval_seconds: String(acc.sync_interval_seconds),
      display_name: acc.display_name ?? "",
      tags: acc.tags ?? "",
      notes: acc.notes ?? ""
    });
  };

  const submitForm = async () => {
    setBusy(editingId ? "update" : "create");
    setError(null);
    try {
      const raw = formToInput(form);
      const input = { ...raw, broker_name: normalizeBrokerName(raw.broker_name) };
      if (!input.broker_name || !input.account_login || !input.account_server) {
        throw new Error("Broker, Login, and Server are required.");
      }
      if (editingId) {
        const resp = await api<{ ok: boolean; account: Mt5Account }>(`/api/mt5-account-sync/accounts/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(input)
        });
        if (resp?.ok) {
          showToast("ok", `Account ${input.broker_name} #${input.account_login} updated.`);
          setEditingId(null);
          setForm({ ...EMPTY_FORM });
          await loadDashboard();
        }
      } else {
        const resp = await api<{ ok: boolean; account: Mt5Account }>("/api/mt5-account-sync/accounts", {
          method: "POST",
          body: JSON.stringify(input)
        });
        if (resp?.ok) {
          showToast("ok", `Account ${input.broker_name} #${input.account_login} added.`);
          setForm({ ...EMPTY_FORM });
          setSelectedId(resp.account.id);
          await loadDashboard();
        }
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
      showToast("err", e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete account ${selected.broker_name} #${selected.account_login}? This removes all sync history.`)) return;
    setBusy("delete");
    try {
      await api(`/api/mt5-account-sync/accounts/${selected.id}`, { method: "DELETE" });
      showToast("ok", `Account #${selected.account_login} deleted.`);
      setSelectedId(null);
      await loadDashboard();
    } catch (e: any) {
      showToast("err", e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const triggerSync = async (accountId: string) => {
    if (syncingIdsRef.current.has(accountId)) return;
    syncingIdsRef.current.add(accountId);
    const idx = accounts.findIndex((a) => a.id === accountId);
    if (idx >= 0) {
      const list = [...accounts];
      list[idx] = { ...list[idx], status: "CONNECTING", last_sync_status: "RUNNING" };
      setAccounts(list);
    }
    try {
      const resp = await api<{ ok: boolean; run: SyncRun; message: string }>(`/api/mt5-account-sync/accounts/${accountId}/sync`, {
        method: "POST",
        body: JSON.stringify({ trigger: "MANUAL" })
      });
      showToast("ok", resp?.message ?? "Sync complete.");
      await loadDashboard();
    } catch (e: any) {
      showToast("err", e?.message ?? String(e));
    } finally {
      syncingIdsRef.current.delete(accountId);
    }
  };

  const toggleModeFilter = (m: AccountMode) => {
    setFilters((f) => ({ ...f, modes: f.modes.includes(m) ? f.modes.filter((x) => x !== m) : [...f.modes, m] }));
  };

  const toggleStatusFilter = (s: AccountStatus) => {
    setFilters((f) => ({ ...f, statuses: f.statuses.includes(s) ? f.statuses.filter((x) => x !== s) : [...f.statuses, s] }));
  };

  const syncAllEnabled = async () => {
    const list = accounts.filter((a) => a.sync_enabled);
    showToast("ok", `Queued ${list.length} accounts for sync…`);
    for (const a of list) void triggerSync(a.id);
  };

  const kpis = useMemo(() => {
    const s = summary;
    return [
      {
        label: "Accounts",
        value: String(s?.accounts_total ?? accounts.length),
        hint: `${s?.accounts_active ?? accounts.filter((a) => a.is_active).length} active`
      },
      {
        label: "Sync Enabled",
        value: String(s?.sync_enabled ?? accounts.filter((a) => a.sync_enabled).length),
        hint: `${s?.sync_enabled ?? accounts.filter((a) => a.sync_enabled).length} monitored`
      },
      {
        label: "Total Balance",
        value: fmtMoney(s?.total_balance ?? accounts.reduce((t, a) => t + (a.balance ?? 0), 0)),
        hint: "Aggregate balances"
      },
      {
        label: "Total Equity",
        value: fmtMoney(s?.total_equity ?? accounts.reduce((t, a) => t + (a.equity ?? 0), 0)),
        hint: "with unrealized P&L"
      },
      {
        label: "Open Positions",
        value: String(s?.total_positions ?? accounts.reduce((t, a) => t + (a.positions_count ?? 0), 0)),
        hint: "across all accounts"
      },
      {
        label: "Syncs (24h)",
        value: String(s?.syncs_last_24h ?? runs.length),
        hint: `${s?.syncs_success_last_24h ?? runs.filter((r) => r.status === "SUCCESS").length} OK`
      },
      {
        label: "Failures (24h)",
        value: String(s?.syncs_failed_last_24h ?? runs.filter((r) => r.status === "FAILED").length),
        hint: "review logs for detail"
      },
      {
        label: "Last Sync",
        value: fmtAge(s?.last_sync_age_ms),
        hint: s?.oldest_sync_age_ms != null && s.oldest_sync_age_ms !== s.last_sync_age_ms ? `oldest ${fmtAge(s.oldest_sync_age_ms)}` : "across accounts"
      }
    ];
  }, [summary, accounts, runs]);

  const systemChips = useMemo(() => {
    const running = control?.kill ? "HALTED" : control?.running ? "RUNNING" : "STOPPED";
    const mode = toActiveMode(control?.mode, "DEMO");
    return [
      { label: running, cls: running === "RUNNING" ? "masChipOk" : running === "HALTED" ? "masChipErr" : "masChipWarn", dot: running === "RUNNING" ? "masDotOk" : running === "HALTED" ? "masDotErr" : "masDot", sub: "From Control API" },
      { label: mode, cls: mode === "LIVE" ? "masChipErr" : mode === "PROP" ? "masChipWarn" : "masChip", dot: "masDot", sub: "demo / prop / live policy envelope" },
      { label: "XAUUSD · MT5-first", cls: "masChip", dot: "masDot", sub: "Primary symbol / routing" }
    ];
  }, [control]);

  return (
    <div className="masPage">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <datalist id="mt5-broker-list">
        {KNOWN_BROKER_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="mt5-server-list">
        {serverOptions.map((srv) => (
          <option key={srv} value={srv} />
        ))}
      </datalist>
      <div className="masBreadcrumb">
        Home / <strong>Execution</strong>
      </div>
      <div className="masHero">
        <div>
          <h1>MT5 Account Sync</h1>
          <p>
            Register MT5 broker accounts (Demo / Prop / Live), configure per-account sync intervals, trigger manual or bulk syncs, and
            review reconciliation history with per-run logs. All account and sync records are persisted in <strong>db_Cacsms-bullion</strong> (MSSQL).
          </p>
        </div>
        <div className="masToolbar">
          {errorInfo.hasError ? (
            <button
              className={`${errorInfo.newBadge > 0 ? "masChipWarn" : "masChip"}`}
              style={{ padding: "9px 14px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 10 }}
              onClick={() => setBannerOpen((o) => !o)}
              title="Toggle MSSQL / connection diagnostics panel"
            >
              <span className="masDot" />
              <div style={{ display: "grid", lineHeight: 1.1, textAlign: "left" }}>
                <span style={{ fontWeight: 900, letterSpacing: "0.05em" }}>
                  ⚙ Diagnostics
                  {errorInfo.newBadge > 0 ? (
                    <span style={{ marginLeft: 8, padding: "1px 8px", borderRadius: 999, background: "#a22", color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: "0.03em" }}>
                      1 new
                    </span>
                  ) : null}
                </span>
                <span style={{ color: "#91a5c9", fontSize: "0.72rem", fontWeight: 600 }}>
                  {errorDiagnostics?.schema_ok === false ? "Schema repair pending" : bannerOpen ? "Close details" : "Open MSSQL / status details"}
                </span>
              </div>
            </button>
          ) : null}
          {systemChips.map((c, i) => (
            <div key={i} className={c.cls}>
              <span className={c.dot} />
              <div style={{ display: "grid", lineHeight: 1.1 }}>
                <span style={{ fontWeight: 900, letterSpacing: "0.05em" }}>{c.label}</span>
                <span style={{ color: "#91a5c9", fontSize: "0.72rem", fontWeight: 600 }}>{c.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {toast ? (
        <div className={`masBanner ${toast.type === "err" ? "masBannerErr" : "masBannerOk"}`} style={{ marginBottom: 14 }}>
          <span>{toast.message}</span>
          <button className="masBtn masBtnSmall" onClick={() => setToast(null)}>DISMISS</button>
        </div>
      ) : null}

      {!!error && bannerOpen === true ? (
        <div className="masBanner masBannerErr" style={{ marginBottom: 14, padding: "10px 14px", display: "block" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: errorDiagnostics ? 10 : 0 }}>
            <span style={{ fontWeight: 600, lineHeight: 1.4 }}>{error}</span>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                className="masBtn masBtnSmall"
                style={{ fontSize: 11, padding: "4px 10px" }}
                onClick={() => {
                  const diag = errorDiagnostics;
                  if (diag) {
                    console.group("MT5 Account Sync · MSSQL diagnostics");
                    console.log(JSON.stringify(diag, null, 2));
                    console.groupEnd();
                  }
                  void loadDashboard();
                }}
                title="Dump structured diagnostics to DevTools console and retry"
              >DIAG + RETRY</button>
              <button className="masBtn masBtnSmall" onClick={() => { setBannerOpen(false); dismissCurrent(); }}>DISMISS &amp; HIDE</button>
              <button className="masBtn masBtnSmall" onClick={() => setBannerOpen(false)}>CLOSE</button>
            </div>
          </div>
          {errorDiagnostics ? (
            <div style={{
              marginTop: 4,
              padding: "10px 12px",
              background: "rgba(18, 27, 51, 0.65)",
              border: "1px solid rgba(170, 90, 90, 0.35)",
              borderRadius: 10,
              fontSize: 12.5,
              color: "#d8ddea",
              lineHeight: 1.55
            }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "6px 16px",
                marginBottom: 10
              }}>
                {[
                  ["SQL Server reachable", errorDiagnostics.tcp_ok === null ? "—" : errorDiagnostics.tcp_ok ? "✅ Yes" : "❌ No"],
                  ["SQL Auth mode", errorDiagnostics.sql_authentication_enabled === null ? "—" : errorDiagnostics.sql_authentication_enabled ? "✅ Mixed/SQL" : "❌ Windows-only (number=233)"],
                  ["Admin login OK", errorDiagnostics.admin_login_ok === null ? "—" : errorDiagnostics.admin_login_ok ? "✅ OK" : errorDiagnostics.config.admin_password_set === false ? "⚠ No password set" : "❌ Failed"],
                  ["DB exists", errorDiagnostics.database_exists === null ? "—" : errorDiagnostics.database_exists ? "✅ Yes" : "❌ Not yet created"],
                  ["App login exists", errorDiagnostics.app_login_exists === null ? "—" : errorDiagnostics.app_login_exists ? "✅ Yes" : "❌ Not yet created"],
                  [`App user (${errorDiagnostics.config.app_user}) connect`, errorDiagnostics.app_user_ok === null ? "—" : errorDiagnostics.app_user_ok ? "✅ OK" : "❌ Failed"],
                  ["Schema applied", errorDiagnostics.schema_ok === null ? "—" : errorDiagnostics.schema_ok ? "✅ Yes" : "❌ No"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#91a5c9" }}>{k}</span>
                    <strong style={{ fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{v}</strong>
                  </div>
                ))}
              </div>
              {errorDiagnostics.last_error ? (
                <div style={{ marginBottom: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, color: "#d4b4b4", wordBreak: "break-word" }}>
                  <span style={{ color: "#91a5c9" }}>Last driver error: </span>
                  {errorDiagnostics.last_error}
                </div>
              ) : null}
              {errorDiagnostics.recovery_steps && errorDiagnostics.recovery_steps.length ? (
                <div>
                  <div style={{ fontWeight: 700, color: "#f4e3b3", marginBottom: 6 }}>🛠  Recovery steps (follow in order):</div>
                  <ol style={{ paddingLeft: 22, margin: 0 }}>
                    {errorDiagnostics.recovery_steps.map((step, i) => (
                      <li key={i} style={{ marginBottom: 3, whiteSpace: "pre-wrap" }}>
                        {step.includes("\n") ? (
                          <>
                            <div>{step.split("\n")[0]}</div>
                            <pre style={{
                              margin: "4px 0 6px 0",
                              padding: "8px 10px",
                              background: "#0b1226",
                              border: "1px solid rgba(100, 130, 200, 0.25)",
                              borderRadius: 6,
                              overflowX: "auto",
                              color: "#bcd2ff",
                              fontSize: 11.5
                            }}>{step.split("\n").slice(1).join("\n")}</pre>
                          </>
                        ) : step}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="masKpis">
        {kpis.map((k) => (
          <div key={k.label} className="masKpi">
            <label>{k.label}</label>
            <strong>{k.value}</strong>
            <span>{k.hint}</span>
          </div>
        ))}
      </div>

      <div className="masGridTop">
        <section className="masPanel">
          <div className="masPanelHead">
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <h2>MT5 Accounts ({filteredAccounts.length})</h2>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {(["DEMO", "PROP", "LIVE"] as AccountMode[]).map((m) => (
                  <button
                    key={m}
                    className={`masTab masTabSmall ${filters.modes.includes(m) ? "active" : ""}`}
                    style={{ padding: "4px 10px" }}
                    onClick={() => toggleModeFilter(m)}
                  >{m}</button>
                ))}
                {(["ACTIVE", "INACTIVE", "ERROR"] as AccountStatus[]).map((s) => (
                  <button
                    key={s}
                    className={`masTab masTabSmall ${filters.statuses.includes(s) ? "active" : ""}`}
                    style={{ padding: "4px 10px" }}
                    onClick={() => toggleStatusFilter(s)}
                  >{s}</button>
                ))}
              </div>
            </div>
            <span>
              <button className="masBtn masBtnPrimary" onClick={() => void syncAllEnabled()} disabled={busy !== null || !accounts.length}>
                ⇄ SYNC ALL
              </button>
              <button className="masBtn" onClick={startCreate} disabled={busy !== null}>
                ＋ NEW ACCOUNT
              </button>
            </span>
          </div>
          <div className="masTableWrap">
            {filteredAccounts.length === 0 ? (
              <div className="masEmpty">
                {accounts.length === 0
                  ? "No accounts registered yet. Use the form or click NEW ACCOUNT to add your first MT5 account."
                  : "No accounts match the current filters."}
              </div>
            ) : (
              <table className="masTable">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Broker</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Sync</th>
                    <th className="num">Balance</th>
                    <th className="num">Equity</th>
                    <th className="num">Margin %</th>
                    <th className="num">P/L Today</th>
                    <th>Last Sync</th>
                    <th className="act">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAccounts.map((a) => (
                    <tr
                      key={a.id}
                      className={`masRow ${selectedId === a.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(a.id)}
                    >
                      <td>
                        <div style={{ fontWeight: 800 }}>
                          {a.display_name || `${a.broker_name} #${a.account_login}`}
                        </div>
                        <div style={{ color: "#91a5c9", fontSize: "0.74rem" }}>
                          #{a.account_login} · {a.account_server} · 1:{a.leverage}
                        </div>
                      </td>
                      <td style={{ color: "#c9daff", fontWeight: 700 }}>{a.broker_name}</td>
                      <td><span className={`masModeTag ${modeCls(a.account_mode)}`}>{a.account_mode}</span></td>
                      <td><span className={`masStatusTag ${statusCls(a.status)}`}>{a.status}</span></td>
                      <td>
                        {a.sync_enabled
                          ? <span className="masStatusTag masStatusACTIVE">ON · {a.sync_interval_seconds}s</span>
                          : <span className="masStatusTag masStatusINACTIVE">OFF</span>}
                      </td>
                      <td className="num">{fmtMoney(a.balance)}</td>
                      <td className="num">{fmtMoney(a.equity)}</td>
                      <td className="num">
                        {a.margin_level != null
                          ? <span className={a.margin_level < 120 ? "masProfitDown" : "masProfitUp"}>{fmtNum(a.margin_level, 1)}%</span>
                          : "—"}
                      </td>
                      <td className="num">
                        {a.profit_today != null
                          ? <span className={a.profit_today >= 0 ? "masProfitUp" : "masProfitDown"}>{fmtMoney(a.profit_today, true)}</span>
                          : "—"}
                      </td>
                      <td>
                        {a.last_sync_at
                          ? (
                            <div>
                              <div style={{ fontWeight: 700, fontSize: "0.76rem" }}>
                                <span className={`masStatusTag ${a.last_sync_status ? statusCls(a.last_sync_status) : "masStatusINACTIVE"}`}>
                                  {a.last_sync_status ?? "—"}
                                </span>
                              </div>
                              <div style={{ color: "#91a5c9", fontSize: "0.72rem" }}>{fmtDateTime(a.last_sync_at)}</div>
                            </div>
                          )
                          : <span style={{ color: "#91a5c9" }}>Never</span>}
                      </td>
                      <td className="act" onClick={(e) => e.stopPropagation()}>
                        <button
                          className="masBtn masBtnPrimary masBtnSmall"
                          onClick={() => void triggerSync(a.id)}
                          disabled={syncingIdsRef.current.has(a.id)}
                        >⇄ Sync</button>
                        <button
                          className="masBtn masBtnSmall"
                          onClick={(e) => { e.stopPropagation(); startEdit(a); }}
                        >✎ Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section className="masPanel">
          <div className="masPanelHead">
            <h2>{editingId ? `Edit Account #${editingId.slice(0, 8)}…` : selected ? `Add / Edit Account` : "Register Account"}</h2>
            <span>{editingId ? "Updating existing record" : "Insert a new MT5 account into MSSQL"}</span>
          </div>
          <div className="masBody">
            <div className="masFormGrid">
              <div className="masField">
                <label>Broker name * {currentBrokerEntry && <span style={{ color: "#7ca46f", fontWeight: 600, marginLeft: 6 }}>✓ Known broker · {serverOptions.length} servers</span>}</label>
                <input
                  list="mt5-broker-list"
                  autoComplete="off"
                  value={form.broker_name}
                  onChange={(e) => handleBrokerChange(e.target.value)}
                  placeholder="e.g. IC Markets, FTMO, Eightcap… start typing to match"
                />
              </div>
              <div className="masField">
                <label>Display name</label>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
                  placeholder="Friendly label in sidebar / menus"
                />
              </div>
              <div className="masField">
                <label>Account login *</label>
                <input
                  type="number"
                  min="0"
                  value={form.account_login}
                  onChange={(e) => setForm((f) => ({ ...f, account_login: e.target.value }))}
                  placeholder="e.g. 40052178"
                />
              </div>
              <div className="masField">
                <label>Server * {currentBrokerEntry ? <span style={{ color: "#7ca46f", fontWeight: 600, marginLeft: 6 }}>↳ preset list · pick from dropdown</span> : <span style={{ color: "#91a5c9", fontWeight: 500, marginLeft: 6 }}>free text</span>}</label>
                {currentBrokerEntry ? (
                  <select
                    value={serverOptions.includes(form.account_server) ? form.account_server : "__custom__"}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__custom__") {
                        setForm((f) => ({ ...f, account_server: "" }));
                      } else {
                        setForm((f) => ({ ...f, account_server: val }));
                      }
                    }}
                  >
                    {serverOptions.map((srv) => (
                      <option key={srv} value={srv}>{srv}</option>
                    ))}
                    <option value="__custom__">⚙ Custom server (type below)</option>
                  </select>
                ) : null}
                {!currentBrokerEntry ||
                (!serverOptions.includes(form.account_server) && form.account_server.length > 0) ? (
                  <input
                    list="mt5-server-list"
                    autoComplete="off"
                    value={form.account_server}
                    onChange={(e) => setForm((f) => ({ ...f, account_server: e.target.value }))}
                    placeholder={currentBrokerEntry ? serverOptions[0] ?? "e.g. Custom-Server-01" : "e.g. ICMarkets-Demo, FTMO-Server2"}
                  />
                ) : null}
              </div>
              <div className="masField">
                <label>Password (optional)</label>
                <input
                  type="password"
                  value={form.account_password}
                  onChange={(e) => setForm((f) => ({ ...f, account_password: e.target.value }))}
                  placeholder="Stored encrypted-ready in MSSQL column"
                />
              </div>
              <div className="masField">
                <label>Account mode *</label>
                <select value={form.account_mode} onChange={(e) => setForm((f) => ({ ...f, account_mode: e.target.value as AccountMode }))}>
                  <option value="DEMO">DEMO - Practice / Simulator</option>
                  <option value="PROP">PROP - Challenge / Funded</option>
                  <option value="LIVE">LIVE - Real capital</option>
                </select>
              </div>
              <div className="masField">
                <label>Currency</label>
                <input
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: safeUpper(e.target.value, f.currency) }))}
                  placeholder="USD, EUR, GBP…"
                />
              </div>
              <div className="masField">
                <label>Leverage (1:X)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.leverage}
                  onChange={(e) => setForm((f) => ({ ...f, leverage: e.target.value }))}
                  placeholder="e.g. 100, 500"
                />
              </div>
              <div className="masField">
                <label>Company</label>
                <input
                  value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                  placeholder="Legal entity of the broker"
                />
              </div>
              <div className="masField">
                <label>Sync interval (seconds)</label>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={form.sync_interval_seconds}
                  onChange={(e) => setForm((f) => ({ ...f, sync_interval_seconds: e.target.value }))}
                />
              </div>
              <div className="masFieldRow" style={{ gridColumn: "1 / -1" }}>
                <label className="masField" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                  <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>Account ACTIVE (routable)</span>
                </label>
                <label className="masField" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.sync_enabled}
                    onChange={(e) => setForm((f) => ({ ...f, sync_enabled: e.target.checked }))}
                  />
                  <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>Sync ENABLED (polled)</span>
                </label>
              </div>
              <div className="masField full">
                <label>Tags (comma-separated)</label>
                <input
                  value={form.tags}
                  onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="e.g. simulator-ready, ny-session, gold-only"
                />
              </div>
              <div className="masField full">
                <label>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Operating notes, routing rules, drawdown limits, prop firm objectives…"
                />
              </div>

              <button
                className="masSubmit"
                onClick={() => void submitForm()}
                disabled={busy !== null}
              >
                {busy === "create" ? "Saving to MSSQL…"
                  : busy === "update" ? "Updating record…"
                  : editingId ? `⟳ UPDATE ACCOUNT #${form.account_login || "?"}`
                  : `＋ CREATE MT5 ACCOUNT ${form.account_login ? "#" + form.account_login : ""}`}
              </button>
              {editingId ? (
                <button
                  className="masSubmit masSubmitDanger"
                  style={{ marginTop: -6 }}
                  onClick={() => { setEditingId(null); setForm({ ...EMPTY_FORM }); }}
                  disabled={busy !== null}
                >
                  ✕ CANCEL EDIT
                </button>
              ) : null}
            </div>
          </div>
        </section>
      </div>

      <div className="masGridBot">
        <section className="masPanel">
          <div className="masPanelHead">
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <h2>
                {selected
                  ? `${selected.display_name || `${selected.broker_name} #${selected.account_login}`} — Detail`
                  : "Select an account"}
              </h2>
              <div className="masTabs" style={{ marginLeft: 10 }}>
                <button className={`masTab ${tab === "details" ? "active" : ""}`} onClick={() => setTab("details")}>Overview</button>
                <button className={`masTab ${tab === "runs" ? "active" : ""}`} onClick={() => setTab("runs")}>Sync Runs ({selectedRuns.length})</button>
                <button className={`masTab ${tab === "logs" ? "active" : ""}`} onClick={() => setTab("logs")}>Logs ({selectedLogs.length})</button>
              </div>
            </div>
            <span>
              {selected ? (
                <>
                  <span className={`masModeTag ${modeCls(selected.account_mode)}`} style={{ marginRight: 6 }}>{selected.account_mode}</span>
                  <button className="masBtn masBtnPrimary masBtnSmall" onClick={() => void triggerSync(selected.id)} disabled={syncingIdsRef.current.has(selected.id)}>
                    ⇄ SYNC NOW
                  </button>
                  <button className="masBtn masBtnSmall" onClick={() => startEdit(selected)}>✎ Edit</button>
                  <button className="masBtn masBtnDanger masBtnSmall" onClick={() => void deleteSelected()} disabled={busy !== null}>
                    🗑 Delete
                  </button>
                </>
              ) : "Click a row above to open detail"}
            </span>
          </div>

          {!selected ? (
            <div className="masBody">
              <div className="masEmpty">Choose an account in the top-left table to inspect overview, sync history, and logs.</div>
            </div>
          ) : tab === "details" ? (
            <div className="masBody">
              <dl className="masKv">
                <dt>Display name</dt><dd>{selected.display_name || "—"}</dd>
                <dt>Broker</dt><dd>{selected.broker_name} {selected.company ? `(${selected.company})` : ""}</dd>
                <dt>Login #</dt><dd style={{ fontWeight: 800 }}>{selected.account_login}</dd>
                <dt>Server</dt><dd>{selected.account_server}</dd>
                <dt>Mode</dt><dd><span className={`masModeTag ${modeCls(selected.account_mode)}`}>{selected.account_mode}</span></dd>
                <dt>Status</dt><dd><span className={`masStatusTag ${statusCls(selected.status)}`}>{selected.status}</span></dd>
                <dt>Account status</dt><dd>{selected.is_active ? <span className="masStatusTag masStatusACTIVE">ROUTABLE</span> : <span className="masStatusTag masStatusINACTIVE">NOT ROUTABLE</span>}</dd>
                <dt>Sync polling</dt><dd>{selected.sync_enabled ? <span className="masStatusTag masStatusACTIVE">EVERY {selected.sync_interval_seconds}s</span> : <span className="masStatusTag masStatusINACTIVE">DISABLED</span>}</dd>
                <dt>Currency</dt><dd>{selected.currency} · 1:{selected.leverage} leverage</dd>
                <dt>Last sync</dt><dd>{selected.last_sync_at ? `${fmtDateTime(selected.last_sync_at)} · ${selected.last_sync_status ?? "—"}` : "Never synced"}</dd>
                <dt>Last message</dt><dd style={{ color: "#c7d6ee", whiteSpace: "normal" }}>{selected.last_sync_message ?? "—"}</dd>
                <dt>Tags</dt><dd style={{ color: "#c7d6ee" }}>{selected.tags ?? "—"}</dd>
                <dt>Created</dt><dd>{fmtDateTime(selected.created_at)}</dd>
                <dt>Updated</dt><dd>{fmtDateTime(selected.updated_at)}</dd>
              </dl>

              <div className="masDivider" />
              <div className="masSectionTitle">Account snapshot (latest from DB)</div>
              <div className="masMiniRow">
                <div className="masMini">
                  <label>Balance</label>
                  <strong>{fmtMoney(selected.balance)}</strong>
                </div>
                <div className="masMini">
                  <label>Equity</label>
                  <strong>{fmtMoney(selected.equity)}</strong>
                </div>
                <div className="masMini">
                  <label>Used margin</label>
                  <strong>{fmtMoney(selected.margin)}</strong>
                </div>
                <div className="masMini">
                  <label>Free margin</label>
                  <strong>{fmtMoney(selected.free_margin)}</strong>
                </div>
                <div className="masMini">
                  <label>Margin level</label>
                  <strong className={selected.margin_level != null && selected.margin_level < 120 ? "masProfitDown" : "masProfitUp"}>
                    {fmtNum(selected.margin_level, 1)}%
                  </strong>
                </div>
                <div className="masMini">
                  <label>Floating P/L</label>
                  <strong className={(selected.floating_pl ?? 0) >= 0 ? "masProfitUp" : "masProfitDown"}>
                    {fmtMoney(selected.floating_pl, true)}
                  </strong>
                </div>
                <div className="masMini">
                  <label>P/L today</label>
                  <strong className={(selected.profit_today ?? 0) >= 0 ? "masProfitUp" : "masProfitDown"}>
                    {fmtMoney(selected.profit_today, true)}
                  </strong>
                </div>
                <div className="masMini">
                  <label>Open / Pending</label>
                  <strong>{selected.positions_count ?? 0} / {selected.orders_count ?? 0}</strong>
                </div>
              </div>

              {selected.notes ? (
                <>
                  <div className="masDivider" />
                  <div className="masSectionTitle">Operator notes</div>
                  <div style={{ padding: "10px 14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "#c7d6ee", whiteSpace: "pre-wrap", fontSize: "0.88rem", lineHeight: 1.55 }}>
                    {selected.notes}
                  </div>
                </>
              ) : null}
            </div>
          ) : tab === "runs" ? (
            <div className="masTableWrap" style={{ maxHeight: 640 }}>
              {selectedRuns.length === 0 ? (
                <div className="masEmpty">No sync runs yet. Trigger a sync to populate this view.</div>
              ) : (
                <table className="masTable">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Trigger</th>
                      <th>Status</th>
                      <th className="num">Bal Δ</th>
                      <th className="num">Eq Δ</th>
                      <th className="num">Pos</th>
                      <th className="num">Deals</th>
                      <th>Gateway / Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRuns.map((r) => {
                      const balDelta = (r.balance_after ?? 0) - (r.balance_before ?? 0);
                      const eqDelta = (r.equity_after ?? 0) - (r.equity_before ?? 0);
                      return (
                        <tr key={r.id} className="masRow">
                          <td style={{ fontWeight: 700 }}>{fmtDateTime(r.started_at)}</td>
                          <td>{fmtDuration(r.duration_ms)}</td>
                          <td><span className="masTriggerTag">{r.trigger}</span></td>
                          <td><span className={`masStatusTag ${statusCls(r.status)}`}>{r.status}</span></td>
                          <td className={`num ${balDelta >= 0 ? "masProfitUp" : "masProfitDown"}`}>{fmtMoney(balDelta, true)}</td>
                          <td className={`num ${eqDelta >= 0 ? "masProfitUp" : "masProfitDown"}`}>{fmtMoney(eqDelta, true)}</td>
                          <td className="num">{r.positions_after ?? 0}</td>
                          <td className="num">{r.deals_synced ?? 0}</td>
                          <td style={{ color: "#91a5c9", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis" }} title={r.error_message ?? r.gateway_info ?? ""}>
                            {r.error_message ?? r.gateway_info ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <div className="masLogWrap">
              {selectedLogs.length === 0 ? (
                <div className="masEmpty">No log lines. Run a sync to capture journal output.</div>
              ) : (
                selectedLogs.map((l) => (
                  <div key={l.id} className={`masLogLine ${logLevelClass(l.level)}`}>
                    <span>{fmtDateTime(l.logged_at)}</span>
                    <span className="masLogCat">{l.category}</span>
                    <span className="masLogCat">[{l.level}]</span>
                    <span style={{ whiteSpace: "normal" }}>{l.message}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        <section className="masPanel">
          <div className="masPanelHead">
            <h2>Recent Sync Runs (all accounts)</h2>
            <span>{runs.length} runs loaded</span>
          </div>
          <div className="masTableWrap" style={{ maxHeight: 640 }}>
            {runs.length === 0 ? (
              <div className="masEmpty">Sync queue is idle. Create or select an account and trigger SYNC NOW to generate a run.</div>
            ) : (
              <table className="masTable">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Started</th>
                    <th>Dur</th>
                    <th>Trigger</th>
                    <th>Status</th>
                    <th className="num">Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 40).map((r) => {
                    const acc = accounts.find((a) => a.id === r.account_id);
                    return (
                      <tr key={r.id} className="masRow" onClick={() => setSelectedId(r.account_id)}>
                        <td>
                          <div style={{ fontWeight: 800 }}>{acc?.broker_name ?? "Unknown"}</div>
                          <div style={{ color: "#91a5c9", fontSize: "0.72rem" }}>#{acc?.account_login ?? "—"}</div>
                        </td>
                        <td>{fmtDateTime(r.started_at)}</td>
                        <td>{fmtDuration(r.duration_ms)}</td>
                        <td><span className="masTriggerTag">{r.trigger}</span></td>
                        <td><span className={`masStatusTag ${statusCls(r.status)}`}>{r.status}</span></td>
                        <td className="num">{r.deals_synced ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="masPanelHead" style={{ borderTop: "1px solid #32456a", borderRadius: 0 }}>
            <h2>Live Sync Log Tail</h2>
            <span>{logs.length} lines · newest first</span>
          </div>
          <div className="masLogWrap" style={{ maxHeight: 380 }}>
            {logs.length === 0 ? (
              <div className="masEmpty">Awaiting sync journal events…</div>
            ) : (
              logs.slice(0, 80).map((l) => (
                <div key={l.id} className={`masLogLine ${logLevelClass(l.level)}`}>
                  <span>{fmtDateTime(l.logged_at)}</span>
                  <span className="masLogCat">{l.category}</span>
                  <span className="masLogCat">[{l.level}]</span>
                  <span style={{ whiteSpace: "normal" }}>{l.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
