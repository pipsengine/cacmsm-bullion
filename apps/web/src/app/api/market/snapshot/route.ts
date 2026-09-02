import { NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";
import { readMt5MarketData } from "../../../../lib/mt5-terminal-bridge";

export async function GET() {
  try {
    const res = await fetch(`${SERVICE_BASE.market}/api/market/snapshot`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    if (res.ok) {
      const text = await res.text();
      return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
    }
  } catch { /* use the local terminal fallback */ }
  return NextResponse.json(await readMt5MarketData("snapshot"), {
    headers: { "cache-control": "no-store", "x-market-source": "mt5-terminal-fallback" },
  });
}
