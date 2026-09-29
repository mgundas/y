import "server-only";

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/db/schema";

/**
 * Per-user fixed-window rate limiting for authenticated mutations.
 *
 * Better Auth throttles only its own credential endpoints; every server action
 * past that point is unthrottled by default. This is the dampener for those:
 * posts, engagements, follows, blocks, mark-read. Storage is the same
 * `rate_limit` table Better Auth uses, keyed `mutation:{userId}:{scope}` so
 * the two systems never share a counter.
 *
 * Races fail open: two requests landing in the same millisecond can both pass.
 * That is acceptable because the consequence of a missed limit is one extra
 * write, not a security hole - the guard here is abuse cost, not correctness.
 * Correctness guards (composite PKs, recomputed counters) do not fail open.
 */
export async function checkMutationRateLimit({
  userId,
  scope,
  windowSeconds,
  max,
}: {
  userId: string;
  /** e.g. "post", "engagement", "follow". One budget per scope. */
  scope: string;
  windowSeconds: number;
  max: number;
}): Promise<boolean> {
  const key = `mutation:${userId}:${scope}`;
  const now = Date.now();

  const rows = await db
    .select({ count: rateLimit.count, lastRequest: rateLimit.lastRequest })
    .from(rateLimit)
    .where(eq(rateLimit.key, key))
    .limit(1);
  const row = rows[0];

  if (!row || now - row.lastRequest > windowSeconds * 1000) {
    if (!row) {
      await db
        .insert(rateLimit)
        .values({ id: randomUUID(), key, count: 1, lastRequest: now })
        .onConflictDoNothing({ target: rateLimit.key });
    } else {
      await db
        .update(rateLimit)
        .set({ count: 1, lastRequest: now })
        .where(eq(rateLimit.key, key));
    }
    return true;
  }

  if (row.count >= max) return false;

  await db
    .update(rateLimit)
    .set({ count: row.count + 1 })
    .where(eq(rateLimit.key, key));
  return true;
}
