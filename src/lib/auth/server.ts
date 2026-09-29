import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * Better Auth owns the `user` / `session` / `account` / `verification` tables.
 * The adapter resolves columns by TypeScript key, so the camelCase keys in
 * `schema.ts` are what must stay in sync with better-auth's expectations.
 */
export const auth = betterAuth({
  appName: "y",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: "pg",
    // Every model must be listed. Anything omitted would be looked up as a
    // table literally named after the model, which does not exist here.
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // Email verification is explicitly out of scope for this app.
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  user: {
    additionalFields: {
      // Not a better-auth core field. `required: true` keeps the session type
      // non-nullable, which matches the NOT NULL column; better-auth then
      // rejects any create that omits it. `input: true` lets it arrive in the
      // sign-up body.
      username: { type: "string", required: true, input: true },
      // Never accepted straight from a client form: the sign-up action only
      // forwards email/password/name/username, and bio is edited later through
      // the authenticated settings action. `input: true` here would let a
      // direct `POST /api/auth/sign-up/email` smuggle a bio past that.
      bio: { type: "string", required: false, input: false },
      // Set by a server action, never accepted straight from a client form.
      bannerUrl: { type: "string", required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },

  /**
   * Enabled from day one rather than waiting for Phase 8: shipping an
   * unthrottled sign-in endpoint is not worth phasing. Storage is the
   * `rate_limit` table because in-memory counters reset on every cold start.
   */
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      // Credential endpoints get a much tighter budget.
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },

  // Must stay last: it flushes Set-Cookie headers after server actions run.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
