"use server";

import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import {
  signInSchema,
  signUpSchema,
  type AuthFormState,
} from "@/lib/validation/auth";

/**
 * Every export from a "use server" file must be an async function - no types,
 * constants, or classes - so shared types live in `@/lib/validation/auth`.
 *
 * All validation happens here. The forms re-use the same Zod schemas purely
 * for instant feedback; nothing they do is trusted.
 */

/** Postgres unique_violation. The backstop behind the pre-checks below. */
const UNIQUE_VIOLATION = "23505";

/**
 * Drizzle wraps the postgres.js error in a `DrizzleQueryError`, and better-auth
 * may wrap that again before it reaches the action. The `23505` therefore sits
 * at the bottom of a `cause` chain, not on the error actually thrown - so walk
 * the chain instead of inspecting one level.
 *
 * This matters for the case the unique index exists to handle: two sign-ups
 * that both pass the pre-check above. Reading only `error.code` would miss
 * them and report "Something went wrong" instead of naming the taken username.
 */
const MAX_CAUSE_DEPTH = 5;

function findUniqueViolation(
  error: unknown,
): Record<string, unknown> | undefined {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    const node = current as Record<string, unknown>;
    if (node["code"] === UNIQUE_VIOLATION) return node;
    current = node["cause"];
  }
  return undefined;
}

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors };
  }

  const { name, username, email, password } = parsed.data;

  // Pre-check so the common case gets a fast answer. The message is
  // deliberately generic: naming *which* field clashed would let an
  // unauthenticated caller probe which usernames and emails are registered.
  // The unique index is what actually guarantees uniqueness, since two
  // sign-ups can race past this.
  const clash = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      sql`lower(${userTable.username}) = ${username} or lower(${userTable.email}) = ${email}`,
    )
    .limit(1);

  if (clash[0]) {
    return { message: "An account with those details already exists." };
  }

  try {
    await auth.api.signUpEmail({
      body: { email, password, name, username },
      headers: await headers(),
    });
  } catch (error) {
    // Same generic message on the race path: the `23505` backstop catches two
    // sign-ups that both passed the pre-check, and distinguishing them would
    // reopen the oracle the pre-check just closed.
    if (findUniqueViolation(error)) {
      return { message: "An account with those details already exists." };
    }
    console.error("sign-up failed", error);
    return { message: "Something went wrong. Please try again." };
  }

  // `nextCookies()` has already queued the Set-Cookie headers.
  redirect(safeCallbackUrl(formData.get("callbackUrl")));
}

/**
 * Where to send the user after sign-in/up.
 *
 * `proxy.ts` preserves the deep link as `?callbackUrl=`, but it arrives as
 * untrusted client input, so it is validated here rather than passed through:
 * same-origin path only, starting with exactly one `/`. Anything else -
 * absolute URLs, protocol-relative `//evil`, backslashes - falls back to `/`.
 * Without this, `?callbackUrl=https://evil.example` would be an open redirect.
 */
function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string") return "/";
  if (
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    raw.includes("\n") ||
    raw.includes("\r")
  ) {
    return "/";
  }
  return raw;
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    await auth.api.signInEmail({
      body: parsed.data,
      headers: await headers(),
    });
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    // Deliberately vague: distinguishing "no such email" from "wrong password"
    // would confirm which addresses are registered. Anything unexpected falls
    // through to the generic message rather than leaking the underlying error.
    if (status === "UNAUTHORIZED" || status === "BAD_REQUEST") {
      return { message: "Incorrect email or password." };
    }
    console.error("sign-in failed", error);
    return { message: "Something went wrong. Please try again." };
  }

  redirect(safeCallbackUrl(formData.get("callbackUrl")));
}

export async function signOutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  // Deliberately not inside a try/catch: `redirect` signals by throwing, so a
  // surrounding catch would swallow it.
  redirect("/sign-in");
}
