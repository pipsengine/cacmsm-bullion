import { NextRequest } from "next/server";
import { withDb, jsonOk } from "../../../../lib/mt5-route-helpers";
import { listSyncLogs, type SyncLogLine } from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDb(async () => {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("account_id") ?? undefined;
    const syncRunId = url.searchParams.get("sync_run_id") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);
    const level = (url.searchParams.get("level") as SyncLogLine["level"] | undefined) ?? undefined;
    const logs = await listSyncLogs({ accountId, syncRunId, limit, level });
    return jsonOk({ ok: true, logs });
  });
}
