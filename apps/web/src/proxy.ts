import { NextRequest, NextResponse } from "next/server";

function unauthorized(message = "Authentication required") {
  return new NextResponse(message, {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Cacsms Bullion", charset="UTF-8"' },
  });
}

export function proxy(req: NextRequest) {
  const user = process.env.WEB_AUTH_USER;
  const password = process.env.WEB_AUTH_PASSWORD;

  if (!user || !password) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("WEB_AUTH_USER and WEB_AUTH_PASSWORD must be configured", { status: 503 });
    }
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(header.slice(6));
    const separator = decoded.indexOf(":");
    const suppliedUser = separator >= 0 ? decoded.slice(0, separator) : "";
    const suppliedPassword = separator >= 0 ? decoded.slice(separator + 1) : "";
    if (suppliedUser === user && suppliedPassword === password) return NextResponse.next();
  } catch {
    // Invalid base64 credentials are handled as an authentication failure.
  }
  return unauthorized("Invalid credentials");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
