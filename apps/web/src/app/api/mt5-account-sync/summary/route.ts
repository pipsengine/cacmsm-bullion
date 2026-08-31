import { NextRequest, NextResponse } from "next/server";
import { ensureInitialized } from "../../../../lib/mssql";
import { getSummary } from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureInitialized();
    const summary = await getSummary();
    return NextResponse.json({ ok: true, summary }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}
