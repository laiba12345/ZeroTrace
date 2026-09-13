import { NextResponse, type NextRequest } from "next/server";

// Gates the whole app behind a single shared operator passcode when
// ZEROTRACE_OPERATOR_SESSION_SECRET is configured — required before any
// public deployment (see README "Deploying"), since this app can trigger
// real provider mutations. If the secret is unset, the gate is a no-op
// (local/dev use, matching prior behavior) — deploying publicly without
// setting it is a mistake, not a supported configuration.
const SESSION_COOKIE = "zt_session";
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"]);

export function proxy(req: NextRequest) {
  const secret = process.env.ZEROTRACE_OPERATOR_SESSION_SECRET;
  if (!secret) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie === secret) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
