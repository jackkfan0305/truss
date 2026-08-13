import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

import { AGENT_LAUNCH_PATH } from "@/lib/agent-launch";

const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
const SIGN_UP_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL;

// Fail loudly at boot: with no public paths every route is protected, including
// the sign-in page itself, which degrades into an unexplained redirect loop.
if (!SIGN_IN_URL || !SIGN_UP_URL) {
  throw new Error(
    "NEXT_PUBLIC_CLERK_SIGN_IN_URL and NEXT_PUBLIC_CLERK_SIGN_UP_URL must be set"
  );
}

// Derived from the Clerk env vars rather than a hardcoded list so the auth
// routes cannot drift out of sync with the middleware.
// ponytail: `createRouteMatcher` is deprecated in @clerk/nextjs 7.x, and its
// glob patterns cannot read from env anyway — a prefix check covers both.
const AUTH_PUBLIC_PATHS = [SIGN_IN_URL, SIGN_UP_URL];

export function isPublicPath(pathname: string): boolean {
  if (pathname === AGENT_LAUNCH_PATH) {
    return true;
  }

  return AUTH_PUBLIC_PATHS.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

/**
 * A launch payload exists only in the fragment, which browsers omit from the
 * HTTP request. Clerk's development handshake redirects document requests,
 * and a redirect would therefore discard the fragment before the client can
 * move it into tab-scoped storage.
 */
export function isClerkHandshakeBypassPath(pathname: string): boolean {
  return pathname === AGENT_LAUNCH_PATH;
}

// `auth.protect()` answers a redirect, not a 401, so it cannot gate an API
// route: a fetch would receive the HTML sign-in page. Route handlers under
// /api call `auth()` themselves and return a JSON 401 — which is also what
// Clerk 7 recommends now that createRouteMatcher is deprecated. Every new
// handler under /api must do its own check; the middleware will not.
function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

const clerkProxy = clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;

  if (!isPublicPath(pathname) && !isApiPath(pathname)) {
    await auth.protect();
  }
});

export default function proxy(
  request: NextRequest,
  event: Parameters<typeof clerkProxy>[1],
) {
  if (isClerkHandshakeBypassPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return clerkProxy(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
