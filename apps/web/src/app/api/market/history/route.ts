import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const hours = sp.get("hours");
  const symbols = sp.get("symbols");
  const params = new URLSearchParams();
  if (hours) params.set("hours", hours);
  if (symbols) params.set("symbols", symbols);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetch(`${SERVICE_BASE.market}/api/market/history${qs}`, { cache: "no-store" });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
}
