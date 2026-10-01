import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/cookies";

/**
 * Optimistic auth checks only.
 *
 * Next explicitly documents that Proxy is NOT a security boundary: it runs on
 * prefetched routes too, so it must never hit the database. The real checks
 * live in `@/lib/auth/session` and are called by pages, layouts, and every
 * server action.
 *
 * Deliberately one-directional: protected routes bounce when the cookie is
 * *absent*, but nothing here bounces when it is *present*. Cookie presence is
 * a hint, never proof - the cookie can be stale (session expired, rotated, or
 * deleted), and bouncing cookie-holders away from `/sign-in` on a hint alone
 * locks a stale-cookie user out of re-authenticating entirely: every
 * protected page sends them to `/sign-in`, which sends them right back out.
 * The `(auth)` layout re-reads the session from the database and is the only
 * thing that decides a signed-in user has no business seeing the form.
 */

/** Routes that require a session. */
const PROTECTED_PREFIXES = [
  "/notifications",
  "/bookmarks",
  "/settings",
];

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

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except API routes, Next internals, and static files.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)",
  ],
};
