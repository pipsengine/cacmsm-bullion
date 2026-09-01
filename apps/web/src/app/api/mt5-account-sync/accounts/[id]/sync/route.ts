import { NextRequest, NextResponse } from "next/server";
import { withDb, jsonErr, jsonOk } from "../../../../../../lib/mt5-route-helpers";
import {
  applySyncSnapshot, finishSyncRun, getAccount, insertSyncLog, listSyncLogs,
  listSyncRuns, startSyncRun, type SyncTrigger
} from "../../../../../../lib/mt5-account-sync";
import { ensureInitialized } from "../../../../../../lib/mssql";
import { readMt5Terminal } from "../../../../../../lib/mt5-terminal-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withDb(async () => {
    const [runs, logs] = await Promise.all([
      listSyncRuns({ accountId: id, limit: 30 }), listSyncLogs({ accountId: id, limit: 150 })
    ]);
    return jsonOk({ ok: true, runs, logs });
  });
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try { await ensureInitialized(); } catch (error) { return jsonErr(error); }
  try {
    const acc = await getAccount(id, { includeSecrets: true });
    if (!acc) return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    let body: { trigger?: SyncTrigger } = {};
    try { body = await req.json(); } catch { body = {}; }
    const started = Date.now();
    const run = await startSyncRun({ account_id: id, trigger: body.trigger ?? "MANUAL" });
    await insertSyncLog({ account_id: id, sync_run_id: run.id, level: "INFO", category: "SYNC",
      message: `Resolving MT5 account #${acc.account_login} through the local terminal...` });
    try {
      const terminal = await readMt5Terminal();
      if (!terminal.connected) throw new Error("The local MetaTrader 5 terminal is not connected.");
      if (Number(terminal.account.login) !== Number(acc.account_login)) {
        throw new Error(`MT5 is logged in as #${terminal.account.login}, but this record is #${acc.account_login}.`);
      }
      const account = terminal.account;
      const positions = terminal.positions.length;
      const pending = terminal.pending_orders.length;
      const deals = terminal.deals.length;
      await insertSyncLog({ account_id: id, sync_run_id: run.id, level: "INFO", category: "CONN",
        message: `Connected to ${String(terminal.terminal.name || "MetaTrader 5")} build ${String(terminal.terminal.build || "unknown")} on ${account.server}.` });
      await insertSyncLog({ account_id: id, sync_run_id: run.id, level: "INFO", category: "ACCT",
        message: `Equity $${account.equity.toLocaleString()} | Margin $${account.margin.toLocaleString()} (${account.margin_level}%) | ${positions} open | ${pending} pending.` });
      await applySyncSnapshot(id, {
        login: account.login, server: account.server, company: account.company,
        currency: account.currency, leverage: account.leverage,
        balance: account.balance, equity: account.equity, margin: account.margin,
        free_margin: account.free_margin, margin_level: account.margin_level,
        floating_pl: account.floating_pl, profit_today: account.profit_today,
        swap_today: account.swap_today, commission_today: account.commission_today,
        positions_count: positions, orders_count: pending, deals_count: deals,
        source: "SYNC", raw: terminal
      });
      await insertSyncLog({ account_id: id, sync_run_id: run.id, level: "INFO", category: "POS",
        message: `Positions reconciled from MT5: ${positions} open and ${pending} pending.` });
      await insertSyncLog({ account_id: id, sync_run_id: run.id, level: "INFO", category: "DEAL",
        message: `Deal history read from MT5: ${deals} tickets in the last 24 hours.` });
      await insertSyncLog({ account_id: id, sync_run_id: run.id, level: "SUCCESS", category: "SYNC",
        message: `Sync complete. P/L today $${account.profit_today >= 0 ? "+" : ""}${account.profit_today.toLocaleString()}.` });
      const finished = await finishSyncRun(run.id, {
        status: "SUCCESS", duration_ms: Date.now() - started,
        balance_before: acc.balance ?? account.balance, balance_after: account.balance,
        equity_before: acc.equity ?? account.equity, equity_after: account.equity,
        positions_before: acc.positions_count ?? positions, positions_after: positions,
        orders_before: acc.orders_count ?? pending, orders_after: pending,
        deals_synced: deals, positions_synced: positions, orders_synced: pending,
        gateway_info: `${account.company} | ${account.server} | local MT5 terminal`
      });
      return jsonOk({ ok: true, run: finished, message: "Sync complete." });
    } catch (syncError) {
      const error = syncError instanceof Error ? syncError : new Error(String(syncError));
      await finishSyncRun(run.id, { status: "FAILED", duration_ms: Date.now() - started,
        error_message: error.message, error_stack: error.stack ?? null });
      throw error;
    }
  } catch (error) { return jsonErr(error); }
}
