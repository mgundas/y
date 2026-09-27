import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth/server";

/**
 * Data Access Layer.
 *
 * Next's own guidance: `proxy.ts` may only do optimistic cookie checks, and is
 * not a security boundary. Every page and server action must call into this
 * module, which re-reads the session from the database.
 *
 * `cache` memoizes per render pass, so a page that calls `getSession()` in the
 * layout, the header, and a child component still performs one lookup.
 */

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** The signed-in user, or `null`. Never throws. */
export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * The signed-in user id, or `null`. Use inside server actions for guard
 * clauses; the type narrows to `string` after the check.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/** Redirects to sign-in when there is no session. Use in pages and layouts. */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}

/**
 * Asserts a session inside a server action, where `redirect` would be an
 * awkward way to signal failure. Returns the user id or null so the caller can
 * bail out.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  return getCurrentUserId();
}
