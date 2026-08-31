import { NextRequest } from "next/server";
import { withDb, jsonOk } from "../../../../lib/mt5-route-helpers";
import { listSyncRuns, type SyncStatus } from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDb(async () => {
    const url = new URL(req.url);
    const accountId = url.searchParams.get("account_id") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const status = (url.searchParams.get("status") as SyncStatus | undefined) ?? undefined;
    const runs = await listSyncRuns({ accountId, limit, status });
    return jsonOk({ ok: true, runs });
  });
}
