import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth checks only.
 *
 * Next explicitly documents that Proxy is NOT a security boundary: it runs on
 * prefetched routes too, so it must never hit the database. This only peeks at
 * the session cookie to avoid flashing the sign-in screen at a signed-in user.
 * The real checks live in `@/lib/auth/session` and are called by pages, layouts,
 * and every server action.
 */

/** Routes that require a session. */
const PROTECTED_PREFIXES = [
  "/notifications",
  "/bookmarks",
  "/settings",
];

/** Routes a signed-in user has no reason to see. */
const AUTH_ROUTES = ["/sign-in", "/sign-up"];

/**
 * Better Auth's default session cookie. It stores a signed token, so its mere
 * presence is a hint - never proof.
 */
const SESSION_COOKIE = "better-auth.session_token";

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !hasSessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Preserve where they were headed so sign-in can bounce them back.
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && AUTH_ROUTES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals, and static files.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
