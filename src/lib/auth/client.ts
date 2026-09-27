"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Client-side auth helpers.
 *
 * Deliberately takes no configuration: better-auth's client falls back to the
 * current origin, which is always right for a same-origin app. Do not import
 * `@/lib/env` here - it has no `server-only` guard, so doing so would inline
 * DATABASE_URL and BETTER_AUTH_SECRET into the browser bundle.
 *
 * Never import `@/lib/auth/server` from a client component either.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
