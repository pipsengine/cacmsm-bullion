import { NextRequest, NextResponse } from "next/server";
import { ensureInitialized } from "../../../../lib/mssql";
import { listSyncLogs, type SyncLogLine } from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureInitialized();
    const url = new URL(req.url);
    const accountId = url.searchParams.get("account_id") ?? undefined;
    const syncRunId = url.searchParams.get("sync_run_id") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);
    const level = (url.searchParams.get("level") as SyncLogLine["level"] | undefined) ?? undefined;
    const logs = await listSyncLogs({ accountId, syncRunId, limit, level });
    return NextResponse.json({ ok: true, logs }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}
