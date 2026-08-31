import { NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url = `${SERVICE_BASE.control}/control/status`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(1500) });
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
    return NextResponse.json(
      {
        ok: false,
        status: "UNAVAILABLE",
        substate: "ServiceOffline",
        reason,
        provider: "web-fallback",
        feed_age_ms: null,
        decision_age_ms: null,
        mode: { envelope: "demo/prop/live", active: "DEMO" },
        routing: { primary_symbol: "XAUUSD", routing_mode: "MT5-first" },
        _serviceBase: SERVICE_BASE.control,
      },
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
}
