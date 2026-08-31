import { NextResponse } from "next/server";
import { ensureInitialized, getConnectionDiagnostics } from "./mssql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function jsonOk<T extends object>(body: T, status: 200 | 201 = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function jsonErr(
  e: any,
  opts: { status?: 400 | 401 | 403 | 404 | 409 | 500; extra?: object } = {},
) {
  const status = opts.status ?? 500;
  const message: string = e?.message ?? String(e ?? "Unknown error");
  return NextResponse.json(
    {
      ok: false,
      message,
      error: String(e ?? ""),
      ...(opts.extra ?? {}),
      diagnostics: getConnectionDiagnostics(),
    },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function withDb(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    await ensureInitialized();
    return await fn();
  } catch (e: any) {
    return jsonErr(e);
  }
}
