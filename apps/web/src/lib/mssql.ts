import sql, { config as SqlConfig, ConnectionPool, IResult } from "mssql";

export const MSSQL_CONFIG = {
  server: process.env.MSSQL_SERVER || "localhost",
  port: parseInt(process.env.MSSQL_PORT || "1433", 10),
  user: process.env.MSSQL_ADMIN_USER || "sa",
  password: process.env.MSSQL_ADMIN_PASSWORD || "",
  database: process.env.MSSQL_DATABASE || "db_Cacsms-bullion",
  appUser: process.env.MSSQL_APP_USER || "cacsms",
  appPassword: process.env.MSSQL_APP_PASSWORD || "P@882w0rd",
  options: {
    encrypt: process.env.MSSQL_ENCRYPT === "true",
    trustServerCertificate: process.env.MSSQL_TRUST_CERT !== "false",
    enableArithAbort: true
  },
  pool: {
    max: 20,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

export type AppDbConfig = typeof MSSQL_CONFIG;

export type MssqlConnectionDiagnostics = {
  ok: boolean;
  initialized_at: string | null;
  server_reachable: boolean | null;
  tcp_ok: boolean | null;
  sql_authentication_enabled: boolean | null;
  admin_login_ok: boolean | null;
  admin_reason: string | null;
  database_exists: boolean | null;
  app_login_exists: boolean | null;
  app_user_ok: boolean | null;
  schema_ok: boolean | null;
  app_reason: string | null;
  last_error: string | null;
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
  recovery_steps: string[];
};

let masterPool: ConnectionPool | null = null;
let appPool: ConnectionPool | null = null;
let initPromise: Promise<ConnectionPool> | null = null;

let lastDiagnostics: MssqlConnectionDiagnostics = {
  ok: false,
  initialized_at: null,
  server_reachable: null,
  tcp_ok: null,
  sql_authentication_enabled: null,
  admin_login_ok: null,
  admin_reason: null,
  database_exists: null,
  app_login_exists: null,
  app_user_ok: null,
  schema_ok: null,
  app_reason: null,
  last_error: null,
  config: {
    server: MSSQL_CONFIG.server,
    port: MSSQL_CONFIG.port,
    database: MSSQL_CONFIG.database,
    admin_user: MSSQL_CONFIG.user,
    admin_password_set: !!MSSQL_CONFIG.password,
    app_user: MSSQL_CONFIG.appUser,
    app_password_set: !!MSSQL_CONFIG.appPassword,
    encrypt: !!MSSQL_CONFIG.options.encrypt,
    trust_cert: !!MSSQL_CONFIG.options.trustServerCertificate,
  },
  recovery_steps: [],
};

function classifyMssqlError(err: any): { code: string | null; isTcp: boolean; isLogin: boolean; reason: string } {
  const message: string = (err?.message ?? String(err ?? "")).toString();
  const rawCode: string | null =
    (err as any)?.code ??
    (err as any)?.cause?.code ??
    (err as any)?.originalError?.code ??
    null;
  const number: number | null =
    (err as any)?.number ??
    (err as any)?.originalError?.info?.number ??
    null;
  const state: number | null =
    (err as any)?.state ??
    (err as any)?.originalError?.info?.state ??
    null;
  const isTcp =
    !!rawCode && ["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(rawCode) ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    message.includes("Connection refused") ||
    message.includes("Failed to connect to") ||
    message.includes("Server name cannot be determined");
  const isLogin =
    number === 18456 ||
    message.includes("Login failed for user") ||
    (number === 233 && state === 0) /* Login handshake failure (SQL auth disabled) */ ||
    /login\s+failed/i.test(message);
  return {
    code: rawCode,
    isTcp,
    isLogin,
    reason: message.slice(0, 400),
  };
}

function buildRecoverySteps(d: MssqlConnectionDiagnostics): string[] {
  const steps: string[] = [];
  const envBlock =
    `MSSQL_SERVER=${MSSQL_CONFIG.server}\n` +
    `MSSQL_PORT=${MSSQL_CONFIG.port}\n` +
    `MSSQL_ADMIN_USER=sa\n` +
    `MSSQL_ADMIN_PASSWORD=<your-sa-password>\n` +
    `MSSQL_DATABASE=${MSSQL_CONFIG.database}\n` +
    `MSSQL_APP_USER=${MSSQL_CONFIG.appUser}\n` +
    `MSSQL_APP_PASSWORD=${MSSQL_CONFIG.appPassword}\n` +
    `MSSQL_ENCRYPT=false\n` +
    `MSSQL_TRUST_CERT=true`;

  if (d.tcp_ok === false) {
    steps.push(`SQL Server is unreachable at ${MSSQL_CONFIG.server}:${MSSQL_CONFIG.port}.`);
    steps.push("Confirm the SQL Server service is RUNNING (services.msc → SQL Server (MSSQLSERVER) or SQLEXPRESS).");
    steps.push("Confirm TCP/IP is enabled: Sql Server Configuration Manager → SQL Server Network Config → Protocols → TCP/IP = Enabled, and IPAll TCP Port = 1433. Restart SQL Server service.");
    steps.push("If using a named instance (e.g. SQLEXPRESS): set MSSQL_PORT to the dynamic port found in SQL Server Error Log, or set MSSQL_SERVER=localhost\\SQLEXPRESS and enable SQL Server Browser service.");
    steps.push("Allow TCP 1433 inbound in Windows Firewall (wf.msc → Inbound Rules → New Rule → Port 1433 TCP).");
  }
  if (d.sql_authentication_enabled === false) {
    steps.push("SQL Server is rejecting logins with number=233 state=0. This usually means Mixed-Mode (SQL + Windows) authentication is DISABLED.");
    steps.push("Enable Mixed-Mode: SSMS → Right-click Server → Properties → Security → Server authentication → 'SQL Server and Windows Authentication mode' → OK → Restart SQL Server service.");
  }
  if (d.admin_login_ok === false) {
    if (!MSSQL_CONFIG.password) {
      steps.push("MSSQL_ADMIN_PASSWORD is empty. The app cannot bootstrap the database + app login without SA-equivalent credentials.");
    } else {
      steps.push(`Admin login '${MSSQL_CONFIG.user}' failed. Verify the SA (or admin) password, or grant your admin login ALTER ANY LOGIN + CREATE ANY DATABASE permissions.`);
    }
    steps.push("Paste this into apps/web/.env.local (create the file if missing), then restart the dev server:");
    steps.push(envBlock);
    steps.push("If you don't know the SA password, you can either (a) reset it via SSMS logged in as Windows admin, or (b) pre-create the database + login by running a manual SQL script instead of auto-bootstrap.");
  }
  if (d.admin_login_ok === true && d.app_user_ok === false && d.server_reachable === true) {
    steps.push("Admin auto-create ran but the app login still failed.");
    steps.push("Verify the app login was actually created: run from SSMS → SELECT name FROM sys.sql_logins WHERE name = N'" + MSSQL_CONFIG.appUser + "';");
    steps.push("If missing, run from SSMS: CREATE LOGIN [" + MSSQL_CONFIG.appUser + "] WITH PASSWORD = N'" + MSSQL_CONFIG.appPassword + "', CHECK_POLICY=OFF, DEFAULT_DATABASE=[" + MSSQL_CONFIG.database + "]; USE [" + MSSQL_CONFIG.database + "]; CREATE USER [" + MSSQL_CONFIG.appUser + "] FOR LOGIN [" + MSSQL_CONFIG.appUser + "]; ALTER ROLE [db_owner] ADD MEMBER [" + MSSQL_CONFIG.appUser + "];");
  }
  if (d.app_user_ok === true && d.schema_ok === false) {
    steps.push("Connected but schema creation failed. Open /api/mt5-account-sync/_diag for the detailed error, or run the SCHEMA_STATEMENTS SQL block in apps/web/src/lib/mssql.ts manually from SSMS under the cacsms user.");
  }
  if (!steps.length && d.ok === false) {
    steps.push("General connection check. Ensure apps/web/.env.local contains the block below, matches your local SQL Server, then restart the dev server:");
    steps.push(envBlock);
  }
  return steps;
}

export function getConnectionDiagnostics(): MssqlConnectionDiagnostics {
  return { ...lastDiagnostics, recovery_steps: buildRecoverySteps(lastDiagnostics) };
}

function setDiag(patch: Partial<MssqlConnectionDiagnostics>): void {
  lastDiagnostics = { ...lastDiagnostics, ...patch };
  lastDiagnostics.recovery_steps = buildRecoverySteps(lastDiagnostics);
}

function adminConfig(): SqlConfig {
  return {
    server: MSSQL_CONFIG.server,
    port: MSSQL_CONFIG.port,
    user: MSSQL_CONFIG.user,
    password: MSSQL_CONFIG.password,
    database: "master",
    options: MSSQL_CONFIG.options,
    pool: MSSQL_CONFIG.pool
  };
}

function appConfig(): SqlConfig {
  return {
    server: MSSQL_CONFIG.server,
    port: MSSQL_CONFIG.port,
    user: MSSQL_CONFIG.appUser,
    password: MSSQL_CONFIG.appPassword,
    database: MSSQL_CONFIG.database,
    options: MSSQL_CONFIG.options,
    pool: MSSQL_CONFIG.pool
  };
}

async function getMasterPool(): Promise<ConnectionPool> {
  if (masterPool && masterPool.connected) return masterPool;
  if (masterPool && masterPool.connecting) {
    try {
      await masterPool.connect();
      return masterPool;
    } catch (e) {
      const cls = classifyMssqlError(e);
      if (cls.isTcp) setDiag({ tcp_ok: false, server_reachable: false, admin_login_ok: false, admin_reason: cls.reason, last_error: cls.reason });
      else if (cls.isLogin) setDiag({
        tcp_ok: true,
        server_reachable: true,
        sql_authentication_enabled: ((e as any)?.number ?? 0) !== 233,
        admin_login_ok: false,
        admin_reason: cls.reason,
        last_error: cls.reason,
      });
      else setDiag({ tcp_ok: true, server_reachable: true, admin_login_ok: false, admin_reason: cls.reason, last_error: cls.reason });
      throw e;
    }
  }
  masterPool = new ConnectionPool(adminConfig());
  try {
    await masterPool.connect();
    setDiag({
      tcp_ok: true,
      server_reachable: true,
      sql_authentication_enabled: true,
      admin_login_ok: true,
      admin_reason: null,
    });
    return masterPool;
  } catch (e) {
    const cls = classifyMssqlError(e);
    if (cls.isTcp) setDiag({ tcp_ok: false, server_reachable: false, admin_login_ok: false, admin_reason: cls.reason, last_error: cls.reason });
    else if (cls.isLogin) setDiag({
      tcp_ok: true,
      server_reachable: true,
      sql_authentication_enabled: ((e as any)?.number ?? 0) !== 233,
      admin_login_ok: false,
      admin_reason: cls.reason,
      last_error: cls.reason,
    });
    else setDiag({ tcp_ok: true, server_reachable: true, admin_login_ok: false, admin_reason: cls.reason, last_error: cls.reason });
    throw e;
  }
}

async function databaseExists(pool: ConnectionPool, dbName: string): Promise<boolean> {
  const r = await pool
    .request()
    .input("dbname", sql.NVarChar(128), dbName)
    .query("SELECT 1 FROM sys.databases WHERE name = @dbname");
  return r.recordset.length > 0;
}

async function loginExists(pool: ConnectionPool, loginName: string): Promise<boolean> {
  const r = await pool
    .request()
    .input("loginname", sql.NVarChar(128), loginName)
    .query("SELECT 1 FROM sys.sql_logins WHERE name = @loginname");
  return r.recordset.length > 0;
}

async function userExists(pool: ConnectionPool, dbName: string, userName: string): Promise<boolean> {
  const r = await pool
    .request()
    .input("dbname", sql.NVarChar(128), dbName)
    .input("username", sql.NVarChar(128), userName)
    .query(
      "SELECT 1 FROM sys.database_principals dp " +
        "INNER JOIN sys.databases d ON d.name = @dbname " +
        "WHERE dp.name = @username AND dp.type = 'S'"
    );
  void r;
  const r2 = await pool
    .request()
    .input("username", sql.NVarChar(128), userName)
    .query(`USE [${dbName}]; SELECT 1 FROM sys.database_principals WHERE name = @username AND type = 'S'`);
  return r2.recordset.length > 0;
}

const SCHEMA_STATEMENTS: string[] = [
  `IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'mt5')
   EXEC('CREATE SCHEMA [mt5] AUTHORIZATION [dbo]');`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'accounts')
   CREATE TABLE [mt5].[accounts] (
     [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
     [broker_name] NVARCHAR(128) NOT NULL,
     [account_login] BIGINT NOT NULL,
     [account_server] NVARCHAR(256) NOT NULL,
     [account_password] NVARCHAR(512) NULL,
     [account_mode] NVARCHAR(16) NOT NULL DEFAULT 'DEMO' CHECK ([account_mode] IN ('DEMO','PROP','LIVE')),
     [currency] NVARCHAR(8) NOT NULL DEFAULT 'USD',
     [leverage] INT NOT NULL DEFAULT 100,
     [company] NVARCHAR(256) NULL,
     [status] NVARCHAR(32) NOT NULL DEFAULT 'INACTIVE' CHECK ([status] IN ('ACTIVE','INACTIVE','CONNECTING','ERROR','DISABLED')),
     [is_active] BIT NOT NULL DEFAULT 0,
     [sync_enabled] BIT NOT NULL DEFAULT 1,
     [sync_interval_seconds] INT NOT NULL DEFAULT 30,
     [last_sync_at] DATETIMEOFFSET NULL,
     [last_sync_status] NVARCHAR(32) NULL,
     [last_sync_message] NVARCHAR(1024) NULL,
     [balance] DECIMAL(18,2) NULL,
     [equity] DECIMAL(18,2) NULL,
     [margin] DECIMAL(18,2) NULL,
     [free_margin] DECIMAL(18,2) NULL,
     [margin_level] DECIMAL(10,2) NULL,
     [floating_pl] DECIMAL(18,2) NULL,
     [profit_today] DECIMAL(18,2) NULL,
     [positions_count] INT NULL,
     [orders_count] INT NULL,
     [deals_count] INT NULL,
     [display_name] NVARCHAR(256) NULL,
     [tags] NVARCHAR(1024) NULL,
     [notes] NVARCHAR(MAX) NULL,
     [created_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     [updated_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     [created_by] NVARCHAR(128) NULL DEFAULT 'SYSTEM',
     UNIQUE ([account_login], [account_server])
   );`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'sync_runs')
   CREATE TABLE [mt5].[sync_runs] (
     [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
     [account_id] UNIQUEIDENTIFIER NOT NULL REFERENCES [mt5].[accounts](id) ON DELETE CASCADE,
     [started_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     [finished_at] DATETIMEOFFSET NULL,
     [status] NVARCHAR(32) NOT NULL CHECK ([status] IN ('RUNNING','SUCCESS','FAILED','PARTIAL','SKIPPED','CANCELLED')),
     [trigger] NVARCHAR(32) NOT NULL DEFAULT 'MANUAL' CHECK ([trigger] IN ('MANUAL','SCHEDULED','API','STARTUP','RETRY')),
     [duration_ms] INT NULL,
     [balance_before] DECIMAL(18,2) NULL,
     [balance_after] DECIMAL(18,2) NULL,
     [equity_before] DECIMAL(18,2) NULL,
     [equity_after] DECIMAL(18,2) NULL,
     [positions_before] INT NULL,
     [positions_after] INT NULL,
     [orders_before] INT NULL,
     [orders_after] INT NULL,
     [deals_synced] INT NULL DEFAULT 0,
     [positions_synced] INT NULL DEFAULT 0,
     [orders_synced] INT NULL DEFAULT 0,
     [error_message] NVARCHAR(MAX) NULL,
     [error_stack] NVARCHAR(MAX) NULL,
     [sync_version] NVARCHAR(64) NULL,
     [connector_version] NVARCHAR(64) NULL,
     [gateway_info] NVARCHAR(1024) NULL
   );`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'sync_logs')
   CREATE TABLE [mt5].[sync_logs] (
     [id] BIGINT NOT NULL IDENTITY(1,1) PRIMARY KEY,
     [sync_run_id] UNIQUEIDENTIFIER NULL REFERENCES [mt5].[sync_runs](id) ON DELETE SET NULL,
     [account_id] UNIQUEIDENTIFIER NULL REFERENCES [mt5].[accounts](id) ON DELETE SET NULL,
     [logged_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     [level] NVARCHAR(16) NOT NULL CHECK ([level] IN ('DEBUG','INFO','WARN','ERROR','SUCCESS')),
     [category] NVARCHAR(64) NOT NULL DEFAULT 'SYNC',
     [message] NVARCHAR(MAX) NOT NULL,
     [context_json] NVARCHAR(MAX) NULL CHECK (ISJSON([context_json])=0 OR ISJSON([context_json])=1)
   );`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'account_snapshots')
   CREATE TABLE [mt5].[account_snapshots] (
     [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
     [account_id] UNIQUEIDENTIFIER NOT NULL REFERENCES [mt5].[accounts](id) ON DELETE CASCADE,
     [sync_run_id] UNIQUEIDENTIFIER NULL REFERENCES [mt5].[sync_runs](id) ON DELETE SET NULL,
     [captured_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     [login] BIGINT NOT NULL,
     [server] NVARCHAR(256) NOT NULL,
     [company] NVARCHAR(256) NULL,
     [currency] NVARCHAR(8) NOT NULL,
     [leverage] INT NOT NULL,
     [balance] DECIMAL(18,2) NOT NULL,
     [equity] DECIMAL(18,2) NOT NULL,
     [margin] DECIMAL(18,2) NOT NULL,
     [free_margin] DECIMAL(18,2) NOT NULL,
     [margin_level] DECIMAL(10,2) NOT NULL,
     [floating_pl] DECIMAL(18,2) NOT NULL,
     [profit_today] DECIMAL(18,2) NOT NULL,
     [swap_today] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [commission_today] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [deposits_total] DECIMAL(18,2) NULL,
     [credit] DECIMAL(18,2) NULL DEFAULT 0,
     [positions_count] INT NOT NULL DEFAULT 0,
     [pending_orders_count] INT NOT NULL DEFAULT 0,
     [deals_24h_count] INT NULL,
     [source] NVARCHAR(32) NOT NULL DEFAULT 'SYNC' CHECK ([source] IN ('SYNC','MANUAL','API','POLL')),
     [raw_json] NVARCHAR(MAX) NULL CHECK (ISJSON([raw_json])=0 OR ISJSON([raw_json])=1)
   );`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'positions')
   CREATE TABLE [mt5].[positions] (
     [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
     [account_id] UNIQUEIDENTIFIER NOT NULL REFERENCES [mt5].[accounts](id) ON DELETE CASCADE,
     [snapshot_id] UNIQUEIDENTIFIER NULL REFERENCES [mt5].[account_snapshots](id) ON DELETE SET NULL,
     [ticket] BIGINT NOT NULL,
     [identifier] BIGINT NULL,
     [open_ts] DATETIMEOFFSET NOT NULL,
     [side] NVARCHAR(8) NOT NULL CHECK ([side] IN ('BUY','SELL')),
     [size_lots] DECIMAL(10,2) NOT NULL,
     [symbol] NVARCHAR(32) NOT NULL,
     [open_price] DECIMAL(18,8) NOT NULL,
     [current_bid] DECIMAL(18,8) NULL,
     [current_ask] DECIMAL(18,8) NULL,
     [stop_loss] DECIMAL(18,8) NULL,
     [take_profit] DECIMAL(18,8) NULL,
     [stop_level] INT NULL,
     [swap] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [commission] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [profit] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [profit_pips] DECIMAL(10,2) NULL,
     [comment] NVARCHAR(256) NULL,
     [magic] INT NULL,
     [external_id] NVARCHAR(128) NULL,
     [is_open] BIT NOT NULL DEFAULT 1,
     [closed_at] DATETIMEOFFSET NULL,
     [closed_reason] NVARCHAR(64) NULL,
     [synced_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     UNIQUE ([account_id], [ticket])
   );`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'pending_orders')
   CREATE TABLE [mt5].[pending_orders] (
     [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
     [account_id] UNIQUEIDENTIFIER NOT NULL REFERENCES [mt5].[accounts](id) ON DELETE CASCADE,
     [snapshot_id] UNIQUEIDENTIFIER NULL REFERENCES [mt5].[account_snapshots](id) ON DELETE SET NULL,
     [ticket] BIGINT NOT NULL,
     [created_ts] DATETIMEOFFSET NOT NULL,
     [order_type] NVARCHAR(16) NOT NULL CHECK ([order_type] IN ('BUY LIMIT','SELL LIMIT','BUY STOP','SELL STOP','BUY STOP LIMIT','SELL STOP LIMIT')),
     [size_lots] DECIMAL(10,2) NOT NULL,
     [symbol] NVARCHAR(32) NOT NULL,
     [price] DECIMAL(18,8) NOT NULL,
     [stop_limit_price] DECIMAL(18,8) NULL,
     [stop_loss] DECIMAL(18,8) NULL,
     [take_profit] DECIMAL(18,8) NULL,
     [volume_filled] DECIMAL(10,2) NOT NULL DEFAULT 0,
     [status] NVARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK ([status] IN ('OPEN','PARTIAL','CANCELLED','FILLED','EXPIRED')),
     [expiration_ts] DATETIMEOFFSET NULL,
     [comment] NVARCHAR(256) NULL,
     [magic] INT NULL,
     [external_id] NVARCHAR(128) NULL,
     [synced_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     UNIQUE ([account_id], [ticket])
   );`,

  `IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'mt5' AND TABLE_NAME = 'deals')
   CREATE TABLE [mt5].[deals] (
     [id] UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
     [account_id] UNIQUEIDENTIFIER NOT NULL REFERENCES [mt5].[accounts](id) ON DELETE CASCADE,
     [snapshot_id] UNIQUEIDENTIFIER NULL REFERENCES [mt5].[account_snapshots](id) ON DELETE SET NULL,
     [deal_ticket] BIGINT NOT NULL,
     [order_ticket] BIGINT NULL,
     [deal_ts] DATETIMEOFFSET NOT NULL,
     [symbol] NVARCHAR(32) NOT NULL,
     [deal_type] NVARCHAR(32) NOT NULL CHECK ([deal_type] IN ('BUY','SELL','BALANCE','CREDIT','CORRECTION','REBATE','FEE','SWAP')),
     [entry] NVARCHAR(8) NULL CHECK ([entry] IN ('IN','OUT','IN/OUT','OUT/IN')),
     [size_lots] DECIMAL(10,2) NOT NULL DEFAULT 0,
     [price] DECIMAL(18,8) NOT NULL DEFAULT 0,
     [stop_loss] DECIMAL(18,8) NULL,
     [take_profit] DECIMAL(18,8) NULL,
     [profit] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [commission] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [swap] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [fee] DECIMAL(18,2) NOT NULL DEFAULT 0,
     [balance_delta] DECIMAL(18,2) NULL,
     [comment] NVARCHAR(256) NULL,
     [magic] INT NULL,
     [external_id] NVARCHAR(128) NULL,
     [synced_at] DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
     UNIQUE ([account_id], [deal_ticket])
   );`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_sync_runs_account_id_started_at' AND object_id = OBJECT_ID(N'mt5.sync_runs'))
   CREATE INDEX [IX_sync_runs_account_id_started_at] ON [mt5].[sync_runs] ([account_id] DESC, [started_at] DESC);`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_sync_logs_account_id_logged_at' AND object_id = OBJECT_ID(N'mt5.sync_logs'))
   CREATE INDEX [IX_sync_logs_account_id_logged_at] ON [mt5].[sync_logs] ([account_id] DESC, [logged_at] DESC);`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_sync_logs_sync_run_id' AND object_id = OBJECT_ID(N'mt5.sync_logs'))
   CREATE INDEX [IX_sync_logs_sync_run_id] ON [mt5].[sync_logs] ([sync_run_id] DESC, [logged_at] DESC);`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_account_snapshots_account_id_captured_at' AND object_id = OBJECT_ID(N'mt5.account_snapshots'))
   CREATE INDEX [IX_account_snapshots_account_id_captured_at] ON [mt5].[account_snapshots] ([account_id] DESC, [captured_at] DESC);`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_positions_account_id_open_ts' AND object_id = OBJECT_ID(N'mt5.positions'))
   CREATE INDEX [IX_positions_account_id_open_ts] ON [mt5].[positions] ([account_id] DESC, [open_ts] DESC) WHERE [is_open] = 1;`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_deals_account_id_deal_ts' AND object_id = OBJECT_ID(N'mt5.deals'))
   CREATE INDEX [IX_deals_account_id_deal_ts] ON [mt5].[deals] ([account_id] DESC, [deal_ts] DESC);`,

  `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = N'IX_pending_orders_account_id_created_ts' AND object_id = OBJECT_ID(N'mt5.pending_orders'))
   CREATE INDEX [IX_pending_orders_account_id_created_ts] ON [mt5].[pending_orders] ([account_id] DESC, [created_ts] DESC) WHERE [status] = 'OPEN';`
];

async function ensureDatabaseAndUser(): Promise<void> {
  const pool = await getMasterPool();
  const dbName = MSSQL_CONFIG.database;
  const loginName = MSSQL_CONFIG.appUser;
  const loginPwd = MSSQL_CONFIG.appPassword;

  const dbExistedBefore = await databaseExists(pool, dbName);
  const loginExistedBefore = await loginExists(pool, loginName);
  setDiag({
    database_exists: dbExistedBefore,
    app_login_exists: loginExistedBefore,
  });

  const tx = pool.transaction();
  try {
    await tx.begin();
    const req = tx.request();

    if (!dbExistedBefore) {
      await req.query(`CREATE DATABASE [${dbName}] 
        ON PRIMARY (NAME = N'${dbName}_dat', FILENAME = N'${dbName}_dat.mdf', SIZE = 8MB, FILEGROWTH = 64MB)
        LOG ON (NAME = N'${dbName}_log', FILENAME = N'${dbName}_log.ldf', SIZE = 8MB, FILEGROWTH = 64MB);`);
    }

    if (!loginExistedBefore) {
      await pool
        .request()
        .input("pwd", sql.NVarChar(512), loginPwd)
        .query(`CREATE LOGIN [${loginName}] WITH PASSWORD = @pwd, CHECK_POLICY = OFF, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = [${dbName}];`);
    }

    await pool
      .request()
      .input("username", sql.NVarChar(128), loginName)
      .query(
        `USE [${dbName}];
         IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @username AND type = 'S')
         BEGIN
           CREATE USER [${loginName}] FOR LOGIN [${loginName}] WITH DEFAULT_SCHEMA = [dbo];
         END
         ALTER ROLE [db_owner] ADD MEMBER [${loginName}];`
      );

    await tx.commit();
    setDiag({
      database_exists: true,
      app_login_exists: true,
    });
  } catch (e) {
    try { await tx.rollback(); } catch { /* noop */ }
    setDiag({ last_error: classifyMssqlError(e).reason });
    throw e;
  }
}

async function ensureSchema(pool: ConnectionPool): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await pool.request().query(stmt);
  }
}

export async function ensureInitialized(): Promise<ConnectionPool> {
  if (appPool && appPool.connected) return appPool;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await ensureDatabaseAndUser();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      if (!msg.toLowerCase().includes("already") && !msg.toLowerCase().includes("duplicate") && !msg.toLowerCase().includes("exists")) {
        console.warn(`[mssql] Proceeding without auto-create: ${msg}`);
      }
    }

    try {
      if (!appPool || appPool.connected === false) {
        appPool = new ConnectionPool(appConfig());
        try {
          await appPool.connect();
          setDiag({
            app_user_ok: true,
            app_reason: null,
            server_reachable: true,
            tcp_ok: true,
          });
        } catch (e) {
          const cls = classifyMssqlError(e);
          const patch: Partial<MssqlConnectionDiagnostics> = {
            app_user_ok: false,
            app_reason: cls.reason,
            last_error: cls.reason,
          };
          if (cls.isTcp) { patch.tcp_ok = false; patch.server_reachable = false; }
          if (cls.isLogin) {
            patch.sql_authentication_enabled = ((e as any)?.number ?? 0) !== 233;
            if (patch.tcp_ok !== false) { patch.tcp_ok = true; patch.server_reachable = true; }
          }
          setDiag(patch);
          throw e;
        }
      }
      try {
        await ensureSchema(appPool);
        setDiag({
          schema_ok: true,
          ok: true,
          initialized_at: new Date().toISOString(),
          last_error: null,
        });
      } catch (e) {
        const cls = classifyMssqlError(e);
        setDiag({
          schema_ok: false,
          last_error: cls.reason,
          ok: false,
        });
        throw e;
      }
      return appPool;
    } catch (e) {
      setDiag({ ok: false });
      console.error("[mssql] Failed to connect as app user:", (e as Error).message);
      throw e;
    }
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

export async function getPool(): Promise<ConnectionPool> {
  return ensureInitialized();
}

export async function query<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<IResult<T>> {
  const pool = await getPool();
  const req = pool.request();
  let sqlText = "";
  for (let i = 0; i < strings.length; i++) {
    sqlText += strings[i];
    if (i < values.length) {
      const pname = `p${i}`;
      const v = values[i];
      if (v == null) {
        req.input(pname, sql.NVarChar, null);
      } else if (typeof v === "number") {
        if (Number.isInteger(v)) req.input(pname, sql.BigInt, v);
        else req.input(pname, sql.Decimal(18, 8), v);
      } else if (typeof v === "boolean") {
        req.input(pname, sql.Bit, v);
      } else if (v instanceof Date) {
        req.input(pname, sql.DateTimeOffset, v);
      } else {
        req.input(pname, sql.NVarChar(sql.MAX), String(v));
      }
      sqlText += `@${pname}`;
    }
  }
  return req.query<T>(sqlText);
}

export async function scalar<T = any>(sqlText: string, params: Record<string, any> = {}): Promise<T | null> {
  const pool = await getPool();
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) req.input(k, sql.NVarChar, null);
    else if (typeof v === "number") req.input(k, Number.isInteger(v) ? sql.BigInt : sql.Decimal(18, 8), v);
    else if (typeof v === "boolean") req.input(k, sql.Bit, v);
    else if (v instanceof Date) req.input(k, sql.DateTimeOffset, v);
    else req.input(k, sql.NVarChar(sql.MAX), String(v));
  }
  const r = await req.query(sqlText);
  const row = r.recordset?.[0];
  if (!row) return null;
  const keys = Object.keys(row);
  return (row[keys[0]] as T | null) ?? null;
}

export function closeAll(): Promise<void[]> {
  const pending: Promise<void>[] = [];
  if (masterPool) pending.push(masterPool.close().catch(() => {}));
  if (appPool) pending.push(appPool.close().catch(() => {}));
  masterPool = null;
  appPool = null;
  return Promise.all(pending);
}
