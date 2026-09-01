import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";
import { readMt5MarketData } from "../../../../lib/mt5-terminal-bridge";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const hours = sp.get("hours");
  const symbols = sp.get("symbols");
  const params = new URLSearchParams();
  if (hours) params.set("hours", hours);
  if (symbols) params.set("symbols", symbols);
  const qs = params.toString() ? `?${params.toString()}` : "";
  try {
    const res = await fetch(`${SERVICE_BASE.market}/api/market/history${qs}`, {
      cache: "no-store", signal: AbortSignal.timeout(2_000)
    });
    if (res.ok) {
      const text = await res.text();
      return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
    }
  } catch { /* use the local terminal fallback */ }
  const requestedHours = Math.max(1, Math.min(168, Number(hours) || 24));
  return NextResponse.json(await readMt5MarketData("history", requestedHours), {
    headers: { "cache-control": "no-store", "x-market-source": "mt5-terminal-fallback" }
  });
}
