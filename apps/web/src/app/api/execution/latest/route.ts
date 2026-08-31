import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(`${SERVICE_BASE.execution}/executions/latest`);
    req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));
    const res = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(1500) });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    const reason =
      err?.name === "TimeoutError"
        ? "timeout after 1.5 s"
        : err?.cause?.code === "ECONNREFUSED" || err?.code === "ECONNREFUSED"
          ? "service unreachable (ECONNREFUSED)"
          : err?.message?.slice(0, 160) ?? "fetch failed";
    const limit = Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10);
    return NextResponse.json(
      {
        ok: false,
        status: "UNAVAILABLE",
        reason,
        provider: "web-fallback",
        executions: Array.from({ length: limit }, (_, i) => ({
          id: `fallback-exec-${i + 1}`,
          symbol: "XAUUSD",
          side: "FLAT",
          qty: 0,
          status: "SKIPPED",
          broker: "—",
          account: "—",
          note: "Execution service unreachable. Simulator fallback enabled.",
          createdAt: new Date(Date.now() - i * 120_000).toISOString(),
        })),
        _serviceBase: SERVICE_BASE.execution,
      },
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
}
