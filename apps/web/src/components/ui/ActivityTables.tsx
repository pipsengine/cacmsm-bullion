import React from "react";

type UnknownRecord = Record<string, unknown>;

type FeedResponse = UnknownRecord & {
  ok?: boolean;
  status?: string;
  reason?: string;
  provider?: string;
  items?: unknown[];
  decisions?: unknown[];
  executions?: unknown[];
};

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asFeed(value: unknown): FeedResponse {
  return asRecord(value) as FeedResponse;
}

function textValue(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function formatTime(value: unknown) {
  if (typeof value !== "string") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function statusTone(value: string) {
  const normalized = value.toUpperCase();
  if (["BUY", "FILLED", "ACCEPTED", "RUNNING"].includes(normalized)) return "activityBadgeOk";
  if (["SELL", "REJECTED", "HALTED", "FAILED"].includes(normalized)) return "activityBadgeBad";
  if (["NO_TRADE", "FLAT", "SKIPPED", "PENDING"].includes(normalized)) return "activityBadgeMuted";
  return "activityBadgeWarn";
}

function StatusBadge({ value }: { value: unknown }) {
  const label = textValue(value);
  return <span className={`activityBadge ${statusTone(label)}`}>{label.replaceAll("_", " ")}</span>;
}

function FeedNotice({ response }: { response: FeedResponse }) {
  if (response.ok !== false) return null;
  return (
    <div className="activityNotice" role="status">
      <span className="activityNoticeDot" />
      <div>
        <strong>Live service unavailable</strong>
        <span>{response.reason || "The live feed could not be reached. Synthetic fallback records are hidden."}</span>
      </div>
    </div>
  );
}

function EmptyRows({ columns, loading = false }: { columns: number; loading?: boolean }) {
  return (
    <tr>
      <td className="activityEmpty" colSpan={columns}>
        {loading ? "Loading live data…" : "No live records available."}
      </td>
    </tr>
  );
}

function liveItems(response: FeedResponse, legacyKey: "decisions" | "executions") {
  if (response.ok === false || response.provider === "web-fallback") return [];
  const values = Array.isArray(response.items) ? response.items : response[legacyKey];
  return Array.isArray(values) ? values.map(asRecord) : [];
}

export function DecisionTable({ data }: { data: unknown }) {
  if (data === null) {
    return (
      <div className="activityTableWrap">
        <table className="activityTable">
          <thead><tr><th>Time</th><th>Symbol</th><th>Decision</th><th>Confidence</th><th>Size</th><th>Risk</th><th>Reason</th></tr></thead>
          <tbody><EmptyRows columns={7} loading /></tbody>
        </table>
      </div>
    );
  }

  const response = asFeed(data);
  const rows = liveItems(response, "decisions");

  return (
    <div className="activityFeed">
      <FeedNotice response={response} />
      <div className="activityTableWrap">
        <table className="activityTable">
          <thead>
            <tr><th>Time</th><th>Symbol</th><th>Decision</th><th>Confidence</th><th>Size</th><th>Risk</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRows columns={7} /> : rows.map((row, index) => {
              const action = row.action ?? row.side;
              const confidence = numberValue(row.confidence);
              const size = numberValue(row.size ?? row.qty);
              const stop = numberValue(row.stop_pips ?? row.stopPips);
              const take = numberValue(row.take_pips ?? row.takePips);
              return (
                <tr key={textValue(row.id ?? row.ts ?? row.createdAt, String(index))}>
                  <td className="activityTime">{formatTime(row.ts ?? row.createdAt)}</td>
                  <td><strong>{textValue(row.symbol)}</strong></td>
                  <td><StatusBadge value={action} /></td>
                  <td>{confidence === null ? "—" : `${(confidence <= 1 ? confidence * 100 : confidence).toFixed(0)}%`}</td>
                  <td>{size === null ? "—" : size.toFixed(2)}</td>
                  <td className="activityRisk">{stop === null && take === null ? "—" : `${stop ?? "—"} / ${take ?? "—"}`}</td>
                  <td className="activityMessage">{textValue(row.reason ?? row.strategy)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ExecutionTable({ data }: { data: unknown }) {
  if (data === null) {
    return (
      <div className="activityTableWrap">
        <table className="activityTable">
          <thead><tr><th>Time</th><th>Order ID</th><th>Symbol</th><th>Status</th><th>Fill price</th><th>Message</th></tr></thead>
          <tbody><EmptyRows columns={6} loading /></tbody>
        </table>
      </div>
    );
  }

  const response = asFeed(data);
  const rows = liveItems(response, "executions");

  return (
    <div className="activityFeed">
      <FeedNotice response={response} />
      <div className="activityTableWrap">
        <table className="activityTable">
          <thead>
            <tr><th>Time</th><th>Order ID</th><th>Symbol</th><th>Status</th><th>Fill price</th><th>Message</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRows columns={6} /> : rows.map((row, index) => {
              const orderId = row.client_order_id ?? row.clientOrderId ?? row.id;
              const fill = numberValue(row.fill_price ?? row.fillPrice);
              return (
                <tr key={textValue(`${textValue(orderId, String(index))}-${textValue(row.ts ?? row.createdAt, "")}`)}>
                  <td className="activityTime">{formatTime(row.ts ?? row.createdAt)}</td>
                  <td className="activityOrderId" title={textValue(orderId)}>{textValue(orderId)}</td>
                  <td><strong>{textValue(row.symbol)}</strong></td>
                  <td><StatusBadge value={row.status} /></td>
                  <td>{fill === null ? "—" : fill.toLocaleString("en-US", { maximumFractionDigits: 5 })}</td>
                  <td className="activityMessage">{textValue(row.message ?? row.note)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
