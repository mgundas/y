import { z } from "zod";

/**
 * Server-side environment contract.
 *
 * Deliberately NOT marked `server-only`: `scripts/seed.ts` and `drizzle.config.ts`
 * both need to read it from plain Node, where the `server-only` guard throws.
 * The guard lives on the modules that actually reach the database
 * (`@/lib/db`, `@/lib/auth/server`), so nothing here can be pulled into a
 * client bundle without tripping that.
 */
const envSchema = z.object({
  /** Pooled Neon connection string. Used for all runtime queries. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /**
   * Direct (non-pooled) Neon connection string. Only needed by migrations and
   * the seed script; falls back to DATABASE_URL. Kept as its own var because
   * Neon's pooler runs in transaction mode, which is unsafe for DDL.
   */
  DATABASE_URL_DIRECT: z.string().min(1).optional(),
  /** Signs sessions/tokens. Rotating it invalidates every session. */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url("BETTER_AUTH_URL must be a valid URL"),
  NEXT_PUBLIC_APP_URL: z.url().optional(),
  UPLOADS_DIR: z.string().min(1).default("./public/uploads"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

const parsed = envSchema.safeParse({
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_URL_DIRECT: process.env.DATABASE_URL_DIRECT,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  UPLOADS_DIR: process.env.UPLOADS_DIR,
  NODE_ENV: process.env.NODE_ENV,
});

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment variables:\n${details}\n\nCopy .env.example to .env and fill it in.`,
  );
}

export const env = parsed.data;

/** Connection string for migrations and the seed script. */
export const migrationUrl =
  env.DATABASE_URL_DIRECT ?? env.DATABASE_URL;
