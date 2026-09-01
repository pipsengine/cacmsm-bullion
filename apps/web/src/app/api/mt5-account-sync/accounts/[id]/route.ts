import { NextRequest, NextResponse } from "next/server";
import { withDb, jsonErr, jsonOk } from "../../../../../lib/mt5-route-helpers";
import {
  deleteAccount,
  getAccount,
  updateAccount,
  type AccountUpdateInput
} from "../../../../../lib/mt5-account-sync";
import { ensureInitialized, getConnectionDiagnostics } from "../../../../../lib/mssql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  return withDb(async () => {
    const acc = await getAccount(id);
    if (!acc) return NextResponse.json({ ok: false, message: "Account not found.", diagnostics: getConnectionDiagnostics() }, { status: 404, headers: { "cache-control": "no-store" } });
    return jsonOk({ ok: true, account: acc });
  });
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try { await ensureInitialized(); } catch (e) { return jsonErr(e); }
  let body: AccountUpdateInput;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, message: "Invalid JSON payload.", diagnostics: getConnectionDiagnostics() }, { status: 400, headers: { "cache-control": "no-store" } }); }
  try {
    const updated = await updateAccount(id, body);
    if (!updated) return NextResponse.json({ ok: false, message: "Account not found.", diagnostics: getConnectionDiagnostics() }, { status: 404, headers: { "cache-control": "no-store" } });
    return jsonOk({ ok: true, account: updated });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate") || msg.includes("UNIQUE")) {
      return jsonErr(e, { status: 409, extra: { message: "Duplicate login/server combination." } });
    }
    return jsonErr(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try { await ensureInitialized(); } catch (e) { return jsonErr(e); }
  try {
    const deleted = await deleteAccount(id);
    if (!deleted) return NextResponse.json({ ok: false, message: "Account not found.", diagnostics: getConnectionDiagnostics() }, { status: 404, headers: { "cache-control": "no-store" } });
    return jsonOk({ ok: true, message: "Account deleted." });
  } catch (e) { return jsonErr(e); }
}
