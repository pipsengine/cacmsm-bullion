import { NextRequest, NextResponse } from "next/server";
import { withDb, jsonOk, jsonErr } from "../../../../lib/mt5-route-helpers";
import {
  createAccount,
  listAccounts,
  type AccountMode,
  type AccountStatus,
  type AccountInput
} from "../../../../lib/mt5-account-sync";
import { ensureInitialized, getConnectionDiagnostics } from "../../../../lib/mssql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withDb(async () => {
    const url = new URL(req.url);
    const includeSecrets = url.searchParams.get("include_secrets") === "1";
    const modes = url.searchParams.get("modes")?.split(",").filter(Boolean) as AccountMode[] | undefined;
    const statuses = url.searchParams.get("statuses")?.split(",").filter(Boolean) as AccountStatus[] | undefined;
    const accounts = await listAccounts({ includeSecrets, modeFilter: modes, statusFilter: statuses });
    return jsonOk({ ok: true, accounts });
  });
}

export async function POST(req: NextRequest) {
  try {
    await ensureInitialized();
  } catch (e) {
    return jsonErr(e);
  }
  let body: AccountInput & { created_by?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Invalid JSON payload.", diagnostics: getConnectionDiagnostics() },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (!body.broker_name || !body.account_login || !body.account_server || !body.account_mode) {
    return NextResponse.json(
      {
        ok: false,
        message: "Missing required fields: broker_name, account_login, account_server, account_mode.",
        diagnostics: getConnectionDiagnostics(),
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  try {
    const created = await createAccount(body, body.created_by ?? "WEB-UI");
    return NextResponse.json(
      { ok: true, account: created },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (
      msg.toLowerCase().includes("unique") ||
      msg.toLowerCase().includes("duplicate") ||
      msg.includes("UNIQUE")
    ) {
      return jsonErr(e, {
        status: 409,
        extra: { message: `Account #${body.account_login} on ${body.account_server} already exists.` },
      });
    }
    return jsonErr(e);
  }
}
