import { NextRequest, NextResponse } from "next/server";
import { ensureInitialized } from "../../../../lib/mssql";
import { listSyncRuns, type SyncStatus } from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureInitialized();
    const url = new URL(req.url);
    const accountId = url.searchParams.get("account_id") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const status = (url.searchParams.get("status") as SyncStatus | undefined) ?? undefined;
    const runs = await listSyncRuns({ accountId, limit, status });
    return NextResponse.json({ ok: true, runs }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}
