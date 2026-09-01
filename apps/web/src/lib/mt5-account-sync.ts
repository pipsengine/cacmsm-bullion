import sql from "mssql";
import { getPool } from "./mssql";

export type AccountMode = "DEMO" | "PROP" | "LIVE";
export type AccountStatus = "ACTIVE" | "INACTIVE" | "CONNECTING" | "ERROR" | "DISABLED";
export type SyncStatus = "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" | "SKIPPED" | "CANCELLED";
export type SyncTrigger = "MANUAL" | "SCHEDULED" | "API" | "STARTUP" | "RETRY";

export interface Mt5Account {
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
  created_by?: string | null;
}

export interface SyncRun {
  id: string;
  account_id: string;
  started_at: string;
  finished_at?: string | null;
  status: SyncStatus;
  trigger: SyncTrigger;
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
  error_stack?: string | null;
  sync_version?: string | null;
  connector_version?: string | null;
  gateway_info?: string | null;
}

export interface SyncLogLine {
  id: number;
  sync_run_id?: string | null;
  account_id?: string | null;
  logged_at: string;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SUCCESS";
  category: string;
  message: string;
  context_json?: string | null;
}

export interface AccountInput {
  broker_name: string;
  account_login: number;
  account_server: string;
  account_password?: string | null;
  account_mode: AccountMode;
  currency?: string;
  leverage?: number;
  company?: string | null;
  status?: AccountStatus;
  is_active?: boolean;
  sync_enabled?: boolean;
  sync_interval_seconds?: number;
  display_name?: string | null;
  tags?: string | null;
  notes?: string | null;
}

export interface AccountUpdateInput extends Partial<AccountInput> {
  status?: AccountStatus;
}

export interface SyncResultSummary {
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
}

type Row = Record<string, any>;

function mapAccount(r: Row): Mt5Account {
  return {
    id: String(r.id),
    broker_name: r.broker_name,
    account_login: Number(r.account_login),
    account_server: r.account_server,
    account_password: r.account_password ?? null,
    account_mode: r.account_mode as AccountMode,
    currency: r.currency,
    leverage: Number(r.leverage),
    company: r.company ?? null,
    status: r.status as AccountStatus,
    is_active: Boolean(r.is_active),
    sync_enabled: Boolean(r.sync_enabled),
    sync_interval_seconds: Number(r.sync_interval_seconds),
    last_sync_at: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
    last_sync_status: r.last_sync_status ?? null,
    last_sync_message: r.last_sync_message ?? null,
    balance: r.balance != null ? Number(r.balance) : null,
    equity: r.equity != null ? Number(r.equity) : null,
    margin: r.margin != null ? Number(r.margin) : null,
    free_margin: r.free_margin != null ? Number(r.free_margin) : null,
    margin_level: r.margin_level != null ? Number(r.margin_level) : null,
    floating_pl: r.floating_pl != null ? Number(r.floating_pl) : null,
    profit_today: r.profit_today != null ? Number(r.profit_today) : null,
    positions_count: r.positions_count != null ? Number(r.positions_count) : null,
    orders_count: r.orders_count != null ? Number(r.orders_count) : null,
    deals_count: r.deals_count != null ? Number(r.deals_count) : null,
    display_name: r.display_name ?? null,
    tags: r.tags ?? null,
    notes: r.notes ?? null,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
    created_by: r.created_by ?? null
  };
}

function mapSyncRun(r: Row): SyncRun {
  return {
    id: String(r.id),
    account_id: String(r.account_id),
    started_at: new Date(r.started_at).toISOString(),
    finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    status: r.status as SyncStatus,
    trigger: r.trigger as SyncTrigger,
    duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    balance_before: r.balance_before != null ? Number(r.balance_before) : null,
    balance_after: r.balance_after != null ? Number(r.balance_after) : null,
    equity_before: r.equity_before != null ? Number(r.equity_before) : null,
    equity_after: r.equity_after != null ? Number(r.equity_after) : null,
    positions_before: r.positions_before != null ? Number(r.positions_before) : null,
    positions_after: r.positions_after != null ? Number(r.positions_after) : null,
    orders_before: r.orders_before != null ? Number(r.orders_before) : null,
    orders_after: r.orders_after != null ? Number(r.orders_after) : null,
    deals_synced: r.deals_synced != null ? Number(r.deals_synced) : null,
    positions_synced: r.positions_synced != null ? Number(r.positions_synced) : null,
    orders_synced: r.orders_synced != null ? Number(r.orders_synced) : null,
    error_message: r.error_message ?? null,
    error_stack: r.error_stack ?? null,
    sync_version: r.sync_version ?? null,
    connector_version: r.connector_version ?? null,
    gateway_info: r.gateway_info ?? null
  };
}

function mapSyncLog(r: Row): SyncLogLine {
  return {
    id: Number(r.id),
    sync_run_id: r.sync_run_id ? String(r.sync_run_id) : null,
    account_id: r.account_id ? String(r.account_id) : null,
    logged_at: new Date(r.logged_at).toISOString(),
    level: r.level as SyncLogLine["level"],
    category: r.category,
    message: r.message,
    context_json: r.context_json ?? null
  };
}

export const MT5_ACCOUNT_SELECT = `
  a.id, a.broker_name, a.account_login, a.account_server,
  CASE WHEN @include_secrets = 1 THEN a.account_password ELSE NULL END AS account_password,
  a.account_mode, a.currency, a.leverage, a.company, a.status, a.is_active,
  a.sync_enabled, a.sync_interval_seconds, a.last_sync_at, a.last_sync_status,
  a.last_sync_message, a.balance, a.equity, a.margin, a.free_margin,
  a.margin_level, a.floating_pl, a.profit_today, a.positions_count,
  a.orders_count, a.deals_count, a.display_name, a.tags, a.notes,
  a.created_at, a.updated_at, a.created_by
`;

export async function listAccounts(opts: { includeSecrets?: boolean; modeFilter?: AccountMode[]; statusFilter?: AccountStatus[] } = {}): Promise<Mt5Account[]> {
  const pool = await getPool();
  const req = pool.request();
  req.input("include_secrets", sql.Bit, opts.includeSecrets ? 1 : 0);
  let where = "";
  const clauses: string[] = [];
  if (opts.modeFilter?.length) {
    const list = opts.modeFilter.map((m, i) => {
      req.input(`mode_${i}`, sql.NVarChar(16), m);
      return `@mode_${i}`;
    }).join(",");
    clauses.push(`a.account_mode IN (${list})`);
  }
  if (opts.statusFilter?.length) {
    const list = opts.statusFilter.map((s, i) => {
      req.input(`status_${i}`, sql.NVarChar(32), s);
      return `@status_${i}`;
    }).join(",");
    clauses.push(`a.status IN (${list})`);
  }
  if (clauses.length) where = "WHERE " + clauses.join(" AND ");
  const r = await req.query<Row>(`SELECT ${MT5_ACCOUNT_SELECT} FROM [mt5].[accounts] a ${where} ORDER BY a.is_active DESC, a.account_mode ASC, a.broker_name ASC, a.account_login ASC`);
  return r.recordset.map(mapAccount);
}

export async function getAccount(id: string, opts: { includeSecrets?: boolean } = {} ): Promise<Mt5Account | null> {
  const pool = await getPool();
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, id);
  req.input("include_secrets", sql.Bit, opts.includeSecrets ? 1 : 0);
  const r = await req.query<Row>(`SELECT ${MT5_ACCOUNT_SELECT} FROM [mt5].[accounts] a WHERE a.id = @id`);
  return r.recordset[0] ? mapAccount(r.recordset[0]) : null;
}

export async function findAccountByLogin(login: number, server: string, opts: { includeSecrets?: boolean } = {} ): Promise<Mt5Account | null> {
  const pool = await getPool();
  const req = pool.request();
  req.input("login", sql.BigInt, login);
  req.input("server", sql.NVarChar(256), server);
  req.input("include_secrets", sql.Bit, opts.includeSecrets ? 1 : 0);
  const r = await req.query<Row>(`SELECT ${MT5_ACCOUNT_SELECT} FROM [mt5].[accounts] a WHERE a.account_login = @login AND a.account_server = @server`);
  return r.recordset[0] ? mapAccount(r.recordset[0]) : null;
}

export async function createAccount(input: AccountInput, createdBy = "SYSTEM"): Promise<Mt5Account> {
  const pool = await getPool();
  const req = pool.request();
  req.input("broker_name", sql.NVarChar(128), input.broker_name);
  req.input("account_login", sql.BigInt, input.account_login);
  req.input("account_server", sql.NVarChar(256), input.account_server);
  req.input("account_password", sql.NVarChar(512), input.account_password ?? null);
  req.input("account_mode", sql.NVarChar(16), input.account_mode);
  req.input("currency", sql.NVarChar(8), input.currency ?? "USD");
  req.input("leverage", sql.Int, input.leverage ?? 100);
  req.input("company", sql.NVarChar(256), input.company ?? null);
  req.input("status", sql.NVarChar(32), input.status ?? "ACTIVE");
  req.input("is_active", sql.Bit, input.is_active ?? false);
  req.input("sync_enabled", sql.Bit, input.sync_enabled ?? true);
  req.input("sync_interval_seconds", sql.Int, input.sync_interval_seconds ?? 30);
  req.input("display_name", sql.NVarChar(256), input.display_name ?? null);
  req.input("tags", sql.NVarChar(1024), input.tags ?? null);
  req.input("notes", sql.NVarChar(sql.MAX), input.notes ?? null);
  req.input("created_by", sql.NVarChar(128), createdBy);

  const r = await req.query<Row>(`
    INSERT INTO [mt5].[accounts]
      (broker_name, account_login, account_server, account_password, account_mode, currency, leverage,
       company, status, is_active, sync_enabled, sync_interval_seconds, display_name, tags, notes, created_by)
    OUTPUT INSERTED.id
    VALUES
      (@broker_name, @account_login, @account_server, @account_password, @account_mode, @currency, @leverage,
       @company, @status, @is_active, @sync_enabled, @sync_interval_seconds, @display_name, @tags, @notes, @created_by)
  `);
  const id = String(r.recordset[0].id);
  const created = await getAccount(id, { includeSecrets: true });
  if (!created) throw new Error("Account creation failed to return row");
  await insertSyncLog({
    account_id: id,
    level: "SUCCESS",
    category: "ACCOUNT",
    message: `Account ${input.broker_name} #${input.account_login} registered (mode ${input.account_mode}).`
  });
  return created;
}

export async function updateAccount(id: string, input: AccountUpdateInput): Promise<Mt5Account | null> {
  const existing = await getAccount(id, { includeSecrets: true });
  if (!existing) return null;
  const pool = await getPool();
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, id);
  const sets: string[] = [];
  const map: Record<string, { col: string; type: (() => any) | any; value: any }> = {
    broker_name: { col: "broker_name", type: () => sql.NVarChar(128), value: input.broker_name },
    account_login: { col: "account_login", type: () => sql.BigInt, value: input.account_login },
    account_server: { col: "account_server", type: () => sql.NVarChar(256), value: input.account_server },
    account_password: { col: "account_password", type: () => sql.NVarChar(512), value: input.account_password },
    account_mode: { col: "account_mode", type: () => sql.NVarChar(16), value: input.account_mode },
    currency: { col: "currency", type: () => sql.NVarChar(8), value: input.currency },
    leverage: { col: "leverage", type: () => sql.Int, value: input.leverage },
    company: { col: "company", type: () => sql.NVarChar(256), value: input.company },
    status: { col: "status", type: () => sql.NVarChar(32), value: input.status },
    is_active: { col: "is_active", type: () => sql.Bit, value: input.is_active },
    sync_enabled: { col: "sync_enabled", type: () => sql.Bit, value: input.sync_enabled },
    sync_interval_seconds: { col: "sync_interval_seconds", type: () => sql.Int, value: input.sync_interval_seconds },
    display_name: { col: "display_name", type: () => sql.NVarChar(256), value: input.display_name },
    tags: { col: "tags", type: () => sql.NVarChar(1024), value: input.tags },
    notes: { col: "notes", type: () => sql.NVarChar(sql.MAX), value: input.notes }
  };
  for (const [key, spec] of Object.entries(map)) {
    if (input[key as keyof AccountUpdateInput] === undefined) continue;
    const pname = `p_${key}`;
    const t = typeof spec.type === "function" ? spec.type() : spec.type;
    req.input(pname, t, spec.value ?? null);
    sets.push(`${spec.col} = @${pname}`);
  }
  if (!sets.length) return existing;
  sets.push("updated_at = SYSDATETIMEOFFSET()");
  await req.query(`UPDATE [mt5].[accounts] SET ${sets.join(", ")} WHERE id = @id`);
  return getAccount(id, { includeSecrets: true });
}

export async function deleteAccount(id: string): Promise<boolean> {
  const pool = await getPool();
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, id);
  const r = await req.query("DELETE FROM [mt5].[accounts] OUTPUT DELETED.id WHERE id = @id");
  return r.recordset.length > 0;
}

export async function listSyncRuns(filter: { accountId?: string; limit?: number; status?: SyncStatus } = {}): Promise<SyncRun[]> {
  const pool = await getPool();
  const req = pool.request();
  let where = "";
  const clauses: string[] = [];
  if (filter.accountId) {
    req.input("aid", sql.UniqueIdentifier, filter.accountId);
    clauses.push("account_id = @aid");
  }
  if (filter.status) {
    req.input("st", sql.NVarChar(32), filter.status);
    clauses.push("status = @st");
  }
  if (clauses.length) where = "WHERE " + clauses.join(" AND ");
  const limit = filter.limit ?? 100;
  req.input("limit", sql.Int, limit);
  const r = await req.query<Row>(`SELECT TOP (@limit) * FROM [mt5].[sync_runs] ${where} ORDER BY started_at DESC`);
  return r.recordset.map(mapSyncRun);
}

export async function getSyncRun(id: string): Promise<SyncRun | null> {
  const pool = await getPool();
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, id);
  const r = await req.query<Row>("SELECT * FROM [mt5].[sync_runs] WHERE id = @id");
  return r.recordset[0] ? mapSyncRun(r.recordset[0]) : null;
}

export async function startSyncRun(input: { account_id: string; trigger?: SyncTrigger }): Promise<SyncRun> {
  const pool = await getPool();
  const req = pool.request();
  req.input("account_id", sql.UniqueIdentifier, input.account_id);
  req.input("trigger", sql.NVarChar(32), input.trigger ?? "MANUAL");
  const r = await req.query<Row>(`
    INSERT INTO [mt5].[sync_runs] (account_id, status, trigger)
    OUTPUT INSERTED.id, INSERTED.account_id, INSERTED.started_at, INSERTED.status, INSERTED.trigger
    VALUES (@account_id, 'RUNNING', @trigger)
  `);
  const row = r.recordset[0];
  await insertSyncLog({
    account_id: input.account_id,
    sync_run_id: String(row.id),
    level: "INFO",
    category: "SYNC",
    message: `Sync run started (trigger: ${input.trigger ?? "MANUAL"}).`
  });
  return mapSyncRun(row);
}

export async function finishSyncRun(id: string, result: {
  status: Exclude<SyncStatus, "RUNNING">;
  duration_ms: number;
  balance_before?: number | null;
  balance_after?: number | null;
  equity_before?: number | null;
  equity_after?: number | null;
  positions_before?: number | null;
  positions_after?: number | null;
  orders_before?: number | null;
  orders_after?: number | null;
  deals_synced?: number;
  positions_synced?: number;
  orders_synced?: number;
  error_message?: string | null;
  error_stack?: string | null;
  gateway_info?: string | null;
}): Promise<SyncRun | null> {
  const pool = await getPool();
  const req = pool.request();
  req.input("id", sql.UniqueIdentifier, id);
  req.input("status", sql.NVarChar(32), result.status);
  req.input("duration_ms", sql.Int, result.duration_ms);
  req.input("balance_before", sql.Decimal(18, 2), result.balance_before ?? null);
  req.input("balance_after", sql.Decimal(18, 2), result.balance_after ?? null);
  req.input("equity_before", sql.Decimal(18, 2), result.equity_before ?? null);
  req.input("equity_after", sql.Decimal(18, 2), result.equity_after ?? null);
  req.input("positions_before", sql.Int, result.positions_before ?? null);
  req.input("positions_after", sql.Int, result.positions_after ?? null);
  req.input("orders_before", sql.Int, result.orders_before ?? null);
  req.input("orders_after", sql.Int, result.orders_after ?? null);
  req.input("deals_synced", sql.Int, result.deals_synced ?? 0);
  req.input("positions_synced", sql.Int, result.positions_synced ?? 0);
  req.input("orders_synced", sql.Int, result.orders_synced ?? 0);
  req.input("error_message", sql.NVarChar(sql.MAX), result.error_message ?? null);
  req.input("error_stack", sql.NVarChar(sql.MAX), result.error_stack ?? null);
  req.input("gateway_info", sql.NVarChar(1024), result.gateway_info ?? null);
  await req.query(`
    UPDATE [mt5].[sync_runs] SET
      finished_at = SYSDATETIMEOFFSET(),
      status = @status,
      duration_ms = @duration_ms,
      balance_before = @balance_before,
      balance_after = @balance_after,
      equity_before = @equity_before,
      equity_after = @equity_after,
      positions_before = @positions_before,
      positions_after = @positions_after,
      orders_before = @orders_before,
      orders_after = @orders_after,
      deals_synced = @deals_synced,
      positions_synced = @positions_synced,
      orders_synced = @orders_synced,
      error_message = @error_message,
      error_stack = @error_stack,
      gateway_info = @gateway_info
    WHERE id = @id
  `);
  if (result.error_message) {
    await insertSyncLog({
      sync_run_id: id,
      level: "ERROR",
      category: "SYNC",
      message: result.error_message,
      context_json: result.error_stack ? JSON.stringify({ stack: result.error_stack }) : undefined
    });
  } else {
    await insertSyncLog({
      sync_run_id: id,
      level: result.status === "FAILED" ? "ERROR" : "SUCCESS",
      category: "SYNC",
      message: `Sync run finished with status ${result.status}.`
    });
  }
  return getSyncRun(id);
}

export async function listSyncLogs(filter: { accountId?: string; syncRunId?: string; limit?: number; level?: SyncLogLine["level"] } = {}): Promise<SyncLogLine[]> {
  const pool = await getPool();
  const req = pool.request();
  const clauses: string[] = [];
  if (filter.accountId) {
    req.input("aid", sql.UniqueIdentifier, filter.accountId);
    clauses.push("account_id = @aid");
  }
  if (filter.syncRunId) {
    req.input("rid", sql.UniqueIdentifier, filter.syncRunId);
    clauses.push("sync_run_id = @rid");
  }
  if (filter.level) {
    req.input("lvl", sql.NVarChar(16), filter.level);
    clauses.push("level = @lvl");
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  const limit = filter.limit ?? 200;
  req.input("limit", sql.Int, limit);
  const r = await req.query<Row>(`SELECT TOP (@limit) * FROM [mt5].[sync_logs] ${where} ORDER BY logged_at DESC, id DESC`);
  return r.recordset.map(mapSyncLog);
}

export async function insertSyncLog(input: Omit<SyncLogLine, "id" | "logged_at"> & { logged_at?: Date | string }): Promise<SyncLogLine> {
  const pool = await getPool();
  const req = pool.request();
  req.input("sync_run_id", sql.UniqueIdentifier, input.sync_run_id ?? null);
  req.input("account_id", sql.UniqueIdentifier, input.account_id ?? null);
  req.input("level", sql.NVarChar(16), input.level);
  req.input("category", sql.NVarChar(64), input.category ?? "SYNC");
  req.input("message", sql.NVarChar(sql.MAX), input.message);
  req.input("context_json", sql.NVarChar(sql.MAX), input.context_json ?? null);
  const r = await req.query<Row>(`
    INSERT INTO [mt5].[sync_logs] (sync_run_id, account_id, level, category, message, context_json)
    OUTPUT INSERTED.id, INSERTED.sync_run_id, INSERTED.account_id, INSERTED.logged_at, INSERTED.level, INSERTED.category, INSERTED.message, INSERTED.context_json
    VALUES (@sync_run_id, @account_id, @level, @category, @message, @context_json)
  `);
  return mapSyncLog(r.recordset[0]);
}

export async function getSummary(): Promise<SyncResultSummary> {
  const pool = await getPool();
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const req = pool.request();
  req.input("since", sql.DateTimeOffset, since);
  const r = await req.query<Row>(`
    SELECT
      (SELECT COUNT(*) FROM [mt5].[accounts]) AS accounts_total,
      (SELECT COUNT(*) FROM [mt5].[accounts] WHERE is_active = 1) AS accounts_active,
      (SELECT COUNT(*) FROM [mt5].[accounts] WHERE sync_enabled = 1) AS sync_enabled,
      (SELECT COUNT(*) FROM [mt5].[sync_runs] WHERE started_at >= @since) AS syncs_last_24h,
      (SELECT COUNT(*) FROM [mt5].[sync_runs] WHERE started_at >= @since AND status = 'SUCCESS') AS syncs_success_last_24h,
      (SELECT COUNT(*) FROM [mt5].[sync_runs] WHERE started_at >= @since AND status = 'FAILED') AS syncs_failed_last_24h,
      (SELECT ISNULL(SUM(balance),0) FROM [mt5].[accounts] WHERE balance IS NOT NULL) AS total_balance,
      (SELECT ISNULL(SUM(equity),0) FROM [mt5].[accounts] WHERE equity IS NOT NULL) AS total_equity,
      (SELECT ISNULL(SUM(positions_count),0) FROM [mt5].[accounts] WHERE positions_count IS NOT NULL) AS total_positions,
      (SELECT DATEDIFF(MILLISECOND, MAX(last_sync_at), SYSDATETIMEOFFSET()) FROM [mt5].[accounts] WHERE last_sync_at IS NOT NULL) AS last_sync_age_ms,
      (SELECT DATEDIFF(MILLISECOND, MIN(last_sync_at), SYSDATETIMEOFFSET()) FROM [mt5].[accounts] WHERE last_sync_at IS NOT NULL) AS oldest_sync_age_ms
  `);
  const row = r.recordset[0];
  return {
    accounts_total: Number(row.accounts_total ?? 0),
    accounts_active: Number(row.accounts_active ?? 0),
    sync_enabled: Number(row.sync_enabled ?? 0),
    syncs_last_24h: Number(row.syncs_last_24h ?? 0),
    syncs_success_last_24h: Number(row.syncs_success_last_24h ?? 0),
    syncs_failed_last_24h: Number(row.syncs_failed_last_24h ?? 0),
    total_balance: Number(row.total_balance ?? 0),
    total_equity: Number(row.total_equity ?? 0),
    total_positions: Number(row.total_positions ?? 0),
    last_sync_age_ms: row.last_sync_age_ms != null ? Number(row.last_sync_age_ms) : null,
    oldest_sync_age_ms: row.oldest_sync_age_ms != null ? Number(row.oldest_sync_age_ms) : null
  };
}

export async function applySyncSnapshot(accountId: string, snapshot: {
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  floating_pl: number;
  profit_today: number;
  positions_count: number;
  orders_count: number;
  deals_count?: number;
  swap_today?: number;
  commission_today?: number;
  currency?: string;
  leverage?: number;
  company?: string;
  source?: "SYNC" | "MANUAL" | "API" | "POLL";
  raw?: any;
}): Promise<void> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const req = tx.request();
    req.input("account_id", sql.UniqueIdentifier, accountId);
    req.input("captured_at", sql.DateTimeOffset, new Date());
    req.input("login", sql.BigInt, 0);
    req.input("server", sql.NVarChar(256), "");
    req.input("company", sql.NVarChar(256), snapshot.company ?? null);
    req.input("currency", sql.NVarChar(8), snapshot.currency ?? "USD");
    req.input("leverage", sql.Int, snapshot.leverage ?? 100);
    req.input("balance", sql.Decimal(18, 2), snapshot.balance);
    req.input("equity", sql.Decimal(18, 2), snapshot.equity);
    req.input("margin", sql.Decimal(18, 2), snapshot.margin);
    req.input("free_margin", sql.Decimal(18, 2), snapshot.free_margin);
    req.input("margin_level", sql.Decimal(10, 2), snapshot.margin_level);
    req.input("floating_pl", sql.Decimal(18, 2), snapshot.floating_pl);
    req.input("profit_today", sql.Decimal(18, 2), snapshot.profit_today);
    req.input("swap_today", sql.Decimal(18, 2), snapshot.swap_today ?? 0);
    req.input("commission_today", sql.Decimal(18, 2), snapshot.commission_today ?? 0);
    req.input("positions_count", sql.Int, snapshot.positions_count);
    req.input("pending_orders_count", sql.Int, snapshot.orders_count);
    req.input("deals_24h_count", sql.Int, snapshot.deals_count ?? null);
    req.input("source", sql.NVarChar(32), snapshot.source ?? "SYNC");
    req.input("raw_json", sql.NVarChar(sql.MAX), snapshot.raw ? JSON.stringify(snapshot.raw) : null);

    const snap = await req.query<Row>(`
      UPDATE [mt5].[accounts] SET
        balance = @balance,
        equity = @equity,
        margin = @margin,
        free_margin = @free_margin,
        margin_level = @margin_level,
        floating_pl = @floating_pl,
        profit_today = @profit_today,
        positions_count = @positions_count,
        orders_count = @pending_orders_count,
        deals_count = ISNULL(@deals_24h_count, deals_count),
        currency = ISNULL(NULLIF(@currency, ''), currency),
        leverage = CASE WHEN @leverage > 0 THEN @leverage ELSE leverage END,
        company = ISNULL(NULLIF(@company, ''), company),
        updated_at = SYSDATETIMEOFFSET()
      OUTPUT INSERTED.account_login, INSERTED.account_server, INSERTED.company, INSERTED.currency, INSERTED.leverage
      WHERE id = @account_id;
    `);

    const acc = snap.recordset[0];
    if (acc) {
      req.input("s_login", sql.BigInt, acc.account_login);
      req.input("s_server", sql.NVarChar(256), acc.account_server);
      req.input("s_company", sql.NVarChar(256), acc.company);
      req.input("s_currency", sql.NVarChar(8), acc.currency);
      req.input("s_leverage", sql.Int, acc.leverage);
      await req.query(`
        INSERT INTO [mt5].[account_snapshots]
          (account_id, captured_at, login, server, company, currency, leverage,
           balance, equity, margin, free_margin, margin_level, floating_pl,
           profit_today, swap_today, commission_today, positions_count, pending_orders_count,
           deals_24h_count, source, raw_json)
        VALUES
          (@account_id, @captured_at, @s_login, @s_server, @s_company, @s_currency, @s_leverage,
           @balance, @equity, @margin, @free_margin, @margin_level, @floating_pl,
           @profit_today, @swap_today, @commission_today, @positions_count, @pending_orders_count,
           @deals_24h_count, @source, @raw_json)
      `);
    }
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* noop */ }
    throw e;
  }
}
