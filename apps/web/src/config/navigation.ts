export type NavItem = {
  title: string;
  href: string;
  badge?: string;
};

export type NavGroup = {
  title: string;
  defaultCollapsed?: boolean;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    title: "Dashboard",
    items: [
      { title: "Executive Overview", href: "/dashboard/executive-overview" },
      { title: "Command Center", href: "/dashboard/command-center" },
      { title: "Daily Summary", href: "/dashboard/daily-summary" },
      { title: "System Health", href: "/dashboard/system-health" }
    ]
  },
  {
    title: "Market Intelligence",
    defaultCollapsed: false,
    items: [
      { title: "Market Matrix", href: "/market/matrix", badge: "LIVE" },
      { title: "24h Tick History", href: "/market/history-24h", badge: "ROLLING" }
    ]
  },
  {
    title: "Trading",
    items: [
      { title: "Market Watch", href: "/trading/market-watch" },
      { title: "Signal Pipeline", href: "/trading/signal-pipeline" },
      { title: "Decision Queue", href: "/trading/decision-queue" },
      { title: "Active Orders", href: "/trading/active-orders" },
      { title: "Open Positions", href: "/trading/open-positions" },
      { title: "Closed Trades", href: "/trading/closed-trades" },
      { title: "Trade Journal", href: "/trading/trade-journal" }
    ]
  },
  {
    title: "Accounts",
    items: [
      { title: "Overview", href: "/accounts/overview" },
      { title: "Demo", href: "/accounts/demo" },
      { title: "Prop Firm", href: "/accounts/prop-firm" },
      { title: "Live", href: "/accounts/live" },
      { title: "Allocation", href: "/accounts/allocation" },
      { title: "Rule Profiles", href: "/accounts/rule-profiles" }
    ]
  },
  {
    title: "Models",
    items: [
      { title: "Strategy Overview", href: "/models/strategy-overview" },
      { title: "Regime Models", href: "/models/regime-models" },
      { title: "Setup Detection", href: "/models/setup-detection" },
      { title: "Entry Models", href: "/models/entry-models" },
      { title: "Risk Models", href: "/models/risk-models" },
      { title: "Execution Models", href: "/models/execution-models" },
      { title: "Drift Detection", href: "/models/drift-detection" },
      { title: "Model Registry", href: "/models/model-registry" },
      { title: "Promotion Queue", href: "/models/promotion-queue" }
    ]
  },
  {
    title: "Execution",
    items: [
      { title: "Overview", href: "/execution/overview" },
      { title: "Connector Manager", href: "/execution/connector-manager" },
      { title: "MT5 Terminal", href: "/execution/mt5-terminal", badge: "MT5" },
      { title: "MT5 Account Sync", href: "/execution/mt5-account-sync" },
      { title: "MT5 Symbol Mapping", href: "/execution/mt5-symbol-mapping" },
      { title: "MT5 Order Flow", href: "/execution/mt5-order-flow" },
      { title: "MT5 Reconciliation", href: "/execution/mt5-reconciliation" },
      { title: "EA Bridge", href: "/execution/ea-bridge" },
      { title: "Live Brokers", href: "/execution/live-brokers" },
      { title: "Routing Engine", href: "/execution/routing-engine" },
      { title: "Execution Logs", href: "/execution/execution-logs" }
    ]
  },
  {
    title: "Risk",
    items: [
      { title: "Overview", href: "/risk/overview" },
      { title: "Prop Rule Engine", href: "/risk/prop-rule-engine" },
      { title: "Daily Loss Guard", href: "/risk/daily-loss-guard" },
      { title: "Exposure Limits", href: "/risk/exposure-limits" },
      { title: "Position Sizing Rules", href: "/risk/position-sizing-rules" },
      { title: "Pre-Trade Guardrails", href: "/risk/pre-trade-guardrails" },
      { title: "Kill Switch Center", href: "/risk/kill-switch-center" },
      { title: "Compliance Audit Trail", href: "/risk/compliance-audit-trail" }
    ]
  },
  {
    title: "Monitoring",
    items: [
      { title: "Overview", href: "/monitoring/overview" },
      { title: "Account Health", href: "/monitoring/account-health" },
      { title: "Broker Health", href: "/monitoring/broker-health" },
      { title: "Market Anomalies", href: "/monitoring/market-anomalies" },
      { title: "Drift Alerts", href: "/monitoring/drift-alerts" },
      { title: "Notifications", href: "/monitoring/notifications" },
      { title: "Incident Timeline", href: "/monitoring/incident-timeline" }
    ]
  },
  {
    title: "Research",
    items: [
      { title: "Replay Engine", href: "/research/replay-engine" },
      { title: "Backtests", href: "/research/backtests" },
      { title: "Forward Tests", href: "/research/forward-tests" },
      { title: "Dataset Builder", href: "/research/dataset-builder" },
      { title: "Feature Store", href: "/research/feature-store" },
      { title: "Training Runs", href: "/research/training-runs" },
      { title: "Validation Reports", href: "/research/validation-reports" },
      { title: "Experiment Tracker", href: "/research/experiment-tracker" }
    ]
  },
  {
    title: "Deployment",
    items: [
      { title: "Environments", href: "/deployment/environments" },
      { title: "Version Registry", href: "/deployment/version-registry" },
      { title: "Rollout Control", href: "/deployment/rollout-control" },
      { title: "Shadow Mode", href: "/deployment/shadow-mode" },
      { title: "Promotion Gates", href: "/deployment/promotion-gates" },
      { title: "Rollback Center", href: "/deployment/rollback-center" }
    ]
  },
  {
    title: "Data",
    items: [
      { title: "Market Data Streams", href: "/data/market-data-streams" },
      { title: "Time-Series Storage", href: "/data/time-series-storage" },
      { title: "Order & Fill Store", href: "/data/order-fill-store" },
      { title: "Event Bus", href: "/data/event-bus" },
      { title: "Data Quality Checks", href: "/data/data-quality-checks" }
    ]
  },
  {
    title: "Admin",
    items: [
      { title: "User Access", href: "/admin/user-access" },
      { title: "Roles & Permissions", href: "/admin/roles-permissions" },
      { title: "System Configuration", href: "/admin/system-configuration" },
      { title: "Trading Sessions", href: "/admin/trading-sessions" },
      { title: "Symbol Settings", href: "/admin/symbol-settings" },
      { title: "Broker Credentials", href: "/admin/broker-credentials" },
      { title: "API Keys & Secrets", href: "/admin/api-keys-secrets" }
    ]
  },
  {
    title: "Help",
    items: [
      { title: "Documentation", href: "/help/documentation" },
      { title: "Operating Playbooks", href: "/help/operating-playbooks" },
      { title: "Error Codes", href: "/help/error-codes" },
      { title: "FAQ", href: "/help/faq" },
      { title: "Support", href: "/help/support" }
    ]
  }
];

export function findNavItem(pathname: string): { group: string; item: NavItem } | null {
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.href === pathname) return { group: g.title, item: it };
    }
  }
  return null;
}

