import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(`${SERVICE_BASE.decision}/decisions/latest`);
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
        decisions: Array.from({ length: limit }, (_, i) => ({
          id: `fallback-${i + 1}`,
          symbol: "XAUUSD",
          side: "FLAT",
          confidence: 0,
          strategy: "offline-simulator",
          createdAt: new Date(Date.now() - i * 60_000).toISOString(),
          context: { offline: true, note: "Decision service unreachable. Simulator fallback enabled." },
        })),
        _serviceBase: SERVICE_BASE.decision,
      },
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
}
