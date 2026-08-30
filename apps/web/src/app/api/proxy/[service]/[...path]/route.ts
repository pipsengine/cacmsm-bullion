import { NextRequest, NextResponse } from "next/server";
import { SERVICE_BASE } from "../../../_utils";

export const runtime = "nodejs";

function getBase(service: string): string | null {
  return SERVICE_BASE[service as keyof typeof SERVICE_BASE] ?? null;
}

export async function GET(req: NextRequest, { params }: { params: { service: string; path: string[] } }) {
  const base = getBase(params.service);
  if (!base) return NextResponse.json({ error: "unknown service" }, { status: 400 });
  const target = new URL(base + "/" + params.path.join("/"));
  req.nextUrl.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  const res = await fetch(target.toString(), { cache: "no-store" });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json" } });
}

export async function POST(req: NextRequest, { params }: { params: { service: string; path: string[] } }) {
  const base = getBase(params.service);
  if (!base) return NextResponse.json({ error: "unknown service" }, { status: 400 });
  const target = new URL(base + "/" + params.path.join("/"));
  const body = await req.text();
  const headers = new Headers();
  headers.set("content-type", req.headers.get("content-type") || "application/json");
  if (params.service === "control" && process.env.ADMIN_API_TOKEN) {
    headers.set("x-admin-token", process.env.ADMIN_API_TOKEN);
  }
  const res = await fetch(target.toString(), {
    method: "POST",
    headers,
    body
  });
  const text = await res.text();
  return new NextResponse(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/json" } });
}
