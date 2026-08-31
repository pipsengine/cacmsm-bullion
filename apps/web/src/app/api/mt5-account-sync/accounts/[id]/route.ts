import { NextRequest, NextResponse } from "next/server";
import { ensureInitialized } from "../../../../../lib/mssql";
import {
  deleteAccount,
  getAccount,
  updateAccount,
  type AccountUpdateInput
} from "../../../../../lib/mt5-account-sync";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureInitialized();
    const acc = await getAccount(params.id, { includeSecrets: true });
    if (!acc) return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    return NextResponse.json({ ok: true, account: acc }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureInitialized();
    let body: AccountUpdateInput;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
    }
    const updated = await updateAccount(params.id, body);
    if (!updated) return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    return NextResponse.json({ ok: true, account: updated }, { status: 200 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate") || msg.includes("UNIQUE")) {
      return NextResponse.json({ ok: false, message: "Duplicate login/server combination." }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, message: msg, error: String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await ensureInitialized();
    const deleted = await deleteAccount(params.id);
    if (!deleted) return NextResponse.json({ ok: false, message: "Account not found." }, { status: 404 });
    return NextResponse.json({ ok: true, message: "Account deleted." }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}
