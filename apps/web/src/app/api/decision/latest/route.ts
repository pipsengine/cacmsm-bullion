import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../_utils";

export async function GET(req: NextRequest) {
  const url = new URL(`${SERVICE_BASE.decision}/decisions/latest`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { cache: "no-store" });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": "application/json" } });
}

