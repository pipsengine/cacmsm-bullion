import { NextRequest, NextResponse } from "next/server";
import { ensureInitialized } from "../../../../lib/mssql";
import {
  createAccount,
  listAccounts,
  type AccountMode,
  type AccountStatus,
  type AccountInput
} from "../../../../lib/mt5-account-sync";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await ensureInitialized();
    const url = new URL(req.url);
    const includeSecrets = url.searchParams.get("include_secrets") === "1";
    const modes = url.searchParams.get("modes")?.split(",").filter(Boolean) as AccountMode[] | undefined;
    const statuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) as AccountStatus[] | undefined;
    const accounts = await listAccounts({ includeSecrets, modeFilter: modes, statusFilter: statuses });
    return NextResponse.json({ ok: true, accounts }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, message: e?.message ?? String(e), error: String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureInitialized();
    let body: AccountInput & { created_by?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, message: "Invalid JSON payload." }, { status: 400 });
    }
    if (!body.broker_name || !body.account_login || !body.account_server || !body.account_mode) {
      return NextResponse.json(
        { ok: false, message: "Missing required fields: broker_name, account_login, account_server, account_mode." },
        { status: 400 }
      );
    }
    const created = await createAccount(body, body.created_by ?? "WEB-UI");
    return NextResponse.json({ ok: true, account: created }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate") || msg.includes("uq_") || msg.includes("UNIQUE")) {
      return NextResponse.json(
        { ok: false, message: `Account #${(e as any).body?.account_login ?? ""} on this server already exists.` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { ok: false, message: msg, error: String(e) },
      { status: 500 }
    );
  }
}
