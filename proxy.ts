import { clerkMiddleware } from "@clerk/nextjs/server";

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
const PUBLIC_PATHS = [SIGN_IN_URL, SIGN_UP_URL];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (publicPath) =>
      pathname === publicPath || pathname.startsWith(`${publicPath}/`)
  );
}

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicPath(req.nextUrl.pathname)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
