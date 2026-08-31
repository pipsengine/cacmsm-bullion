import { NextResponse } from "next/server";
import { ensureInitialized, getConnectionDiagnostics } from "../../../../lib/mssql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureInitialized();
  } catch {
    // swallow — we intentionally return diagnostics regardless
  }
  return NextResponse.json(
    { ok: true, diagnostics: getConnectionDiagnostics() },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
