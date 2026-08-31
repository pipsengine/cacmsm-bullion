import { NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const url = `${SERVICE_BASE.monitoring}/health/summary`;
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
        reason,
        provider: "web-fallback",
        components: [],
        warnings: [{ level: "warn", scope: "monitoring", message: "Monitoring service offline — dashboard will render with placeholder data." }],
        _serviceBase: SERVICE_BASE.monitoring,
      },
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
}
