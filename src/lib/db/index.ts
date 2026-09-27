import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Cached on globalThis so Next's dev-mode hot reload doesn't open a new pool on
 * every edit. In production the module is evaluated once and this is a no-op.
 */
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof postgres> | undefined;
};

export const client =
  globalForDb.pgClient ??
  postgres(env.DATABASE_URL, {
    // Neon's pooled endpoint speaks the transaction-mode protocol, which is
    // incompatible with server-side prepared statements.
    prepare: false,
    max: env.NODE_ENV === "production" ? 10 : 1,
    // Keep the pool small enough that Neon does not aggressively idle it out.
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });

export type Database = typeof db;
