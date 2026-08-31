import { NextRequest, NextResponse } from "next/server";
import { ensureInitialized } from "../../../../../../lib/mssql";
import {
  applySyncSnapshot,
  finishSyncRun,
  getAccount,
  insertSyncLog,
  listSyncLogs,
  listSyncRuns,
  startSyncRun,
  type SyncTrigger
} from "../../../../../../lib/mt5-account-sync";

export const runtime = "nodejs";

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureInitialized();
    const [runs, logs] = await Promise.all([
      listSyncRuns({ accountId: params.id, limit: 30 }),
      listSyncLogs({ accountId: params.id, limit: 150 })
    ]);
    return NextResponse.json(
      { ok: true, runs, logs },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureInitialized();
    const accountId = params.id;
    const acc = await getAccount(accountId, { includeSecrets: true });
    if (!acc) return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });

    let body: { trigger?: SyncTrigger; simulate?: boolean; snapshot?: any } = {};
    try {
      body = await req.json().catch(() => ({}));
    } catch {
      body = {};
    }

    const trigger: SyncTrigger = body.trigger ?? "MANUAL";
    const started = Date.now();
    const run = await startSyncRun({ account_id: accountId, trigger });
    await insertSyncLog({
      account_id: accountId,
      sync_run_id: run.id,
      level: "INFO",
      category: "SYNC",
      message: `Resolving MT5 account #${acc.account_login} on ${acc.account_server} via connector…`
    });

    try {
      await sleep(300);
      await insertSyncLog({
        account_id: accountId,
        sync_run_id: run.id,
        level: "INFO",
        category: "CONN",
        message: `Connector handshake OK (simulated). Account mode ${acc.account_mode}.`
      });

      await sleep(300);
      const baseEquity = acc.equity ?? (acc.account_mode === "LIVE" ? 25_000 : acc.account_mode === "PROP" ? 200_000 : 100_000);
      const drift = (Math.random() * 2 - 1) * (baseEquity * 0.002);
      const balance = Number((baseEquity + drift * 0.1).toFixed(2));
      const equity = Number((baseEquity + drift).toFixed(2));
      const floating = Number((drift * 0.6).toFixed(2));
      const marginPct = 0.04 + Math.random() * 0.08;
      const margin = Number((equity * marginPct).toFixed(2));
      const free_margin = Number(Math.max(0, equity - margin).toFixed(2));
      const margin_level = Number(margin > 0 ? ((equity / margin) * 100).toFixed(2) : 0);
      const positions = 1 + Math.floor(Math.random() * 7);
      const pending = Math.floor(Math.random() * 4);
      const profitToday = Number(((Math.random() * 2 - 0.7) * baseEquity * 0.004).toFixed(2));

      await insertSyncLog({
        account_id: accountId,
        sync_run_id: run.id,
        level: "INFO",
        category: "ACCT",
        message: `Equity $${equity.toLocaleString()} • Margin $${margin.toLocaleString()} (${margin_level}%) • ${positions} open • ${pending} pending.`
      });

      await applySyncSnapshot(accountId, {
        balance,
        equity,
        margin,
        free_margin,
        margin_level,
        floating_pl: floating,
        profit_today: profitToday,
        positions_count: positions,
        orders_count: pending,
        deals_count: 40 + Math.floor(Math.random() * 120),
        swap_today: Number((-Math.random() * 8).toFixed(2)),
        commission_today: Number((-positions * 1.8 - Math.random() * 4).toFixed(2)),
        source: "SYNC",
        raw: { broker: acc.broker_name, login: acc.account_login, server: acc.account_server, simulated: true }
      });

      await insertSyncLog({
        account_id: accountId,
        sync_run_id: run.id,
        level: "INFO",
        category: "POS",
        message: `Positions reconciled: ${positions} open, ${pending} pending, matched ${positions} / ${positions} (100%).`
      });

      const deals = 8 + Math.floor(Math.random() * 30);
      await insertSyncLog({
        account_id: accountId,
        sync_run_id: run.id,
        level: "INFO",
        category: "DEAL",
        message: `Deal history: ${deals} new tickets ingested since last sync window.`
      });

      await insertSyncLog({
        account_id: accountId,
        sync_run_id: run.id,
        level: "SUCCESS",
        category: "SYNC",
        message: `Sync complete. P/L today $${profitToday >= 0 ? "+" : ""}${profitToday.toLocaleString()}.`
      });

      const finished = await finishSyncRun(run.id, {
        status: "SUCCESS",
        duration_ms: Date.now() - started,
        balance_before: acc.balance ?? balance,
        balance_after: balance,
        equity_before: acc.equity ?? equity,
        equity_after: equity,
        positions_before: acc.positions_count ?? positions,
        positions_after: positions,
        orders_before: acc.orders_count ?? pending,
        orders_after: pending,
        deals_synced: deals,
        positions_synced: positions,
        orders_synced: pending,
        gateway_info: `${acc.broker_name} • ${acc.account_server} • simulated bridge v1.0.4`
      });

      return NextResponse.json({ ok: true, run: finished, message: "Sync complete." }, { status: 200 });
    } catch (syncErr: any) {
      await finishSyncRun(run.id, {
        status: "FAILED",
        duration_ms: Date.now() - started,
        error_message: syncErr?.message ?? String(syncErr),
        error_stack: syncErr?.stack ?? null
      });
      throw syncErr;
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}
