import { NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export async function GET() {
  const res = await fetch(`${SERVICE_BASE.market}/api/market/snapshot`, { cache: "no-store" });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
}
