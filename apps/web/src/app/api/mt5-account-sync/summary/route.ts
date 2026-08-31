import { NextResponse } from "next/server";
import { ensureInitialized, getConnectionDiagnostics } from "../../../../lib/mssql";
import { getSummary } from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureInitialized();
    const summary = await getSummary();
    return NextResponse.json({ ok: true, summary }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e), diagnostics: getConnectionDiagnostics() },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
