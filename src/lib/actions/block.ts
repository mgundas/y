"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { blocks, follows, user } from "@/lib/db/schema";
import { checkMutationRateLimit } from "@/lib/ratelimit";
import { usernameSchema } from "@/lib/validation/auth";

/**
 * Block / unblock.
 *
 * Structurally the same toggle as follow: delete-then-insert against a
 * composite PK. Blocking additionally removes follows in both directions in
 * the same transaction - leaving a follow edge behind would mean the blocked
 * account still sees the blocker's posts in a followers-only world, and the
 * blocker still sees the blocked account's count. Both counters are recomputed
 * from the join table, never adjusted.
 *
 * No notification is created. Telling someone "you were blocked" in the
 * product would be a harassment vector with extra steps.
 */

export type BlockState =
  | { ok: true; blocking: boolean }
  | { ok: false; message: string };

/** Same pattern as the follow and engagement actions: read vs broken. */
class BlockValidationError extends Error {}

export async function toggleBlockAction(
  rawUsername: unknown,
): Promise<BlockState> {
  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, message: "Sign in to block people." };
  }

  const parsed = usernameSchema.safeParse(rawUsername);
  if (!parsed.success) {
    return { ok: false, message: "That account no longer exists." };
  }
  const username = parsed.data;

  const allowed = await checkMutationRateLimit({
    userId: viewer.id,
    scope: "block",
    windowSeconds: 3600,
    max: 50,
  });
  if (!allowed) {
    return { ok: false, message: "You're doing that too fast. Slow down." };
  }

  try {
    const blocking = await db.transaction(async (tx) => {
      const targets = await tx
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.username}) = ${username}`)
        .limit(1);
      const target = targets[0];
      if (!target) {
        throw new BlockValidationError("That account no longer exists.");
      }
      if (target.id === viewer.id) {
        throw new BlockValidationError("You cannot block yourself.");
      }

      const removed = await tx
        .delete(blocks)
        .where(
          and(
            eq(blocks.blockerId, viewer.id),
            eq(blocks.blockedId, target.id),
          ),
        )
        .returning({ blockedId: blocks.blockedId });

      if (removed.length > 0) return false;

      await tx
        .insert(blocks)
        .values({ blockerId: viewer.id, blockedId: target.id })
        .onConflictDoNothing();

      // Follows in both directions go with the block. Each counter is
      // recomputed from the join table, because the cascade-free deletes below
      // would otherwise leave all four counts permanently wrong.
      await tx
        .delete(follows)
        .where(
          sql`(${follows.followerId} = ${viewer.id} and ${follows.followingId} = ${target.id})
            or (${follows.followerId} = ${target.id} and ${follows.followingId} = ${viewer.id})`,
        );

      const affected = [viewer.id, target.id];
      for (const id of affected) {
        await tx
          .update(user)
          .set({
            followerCount: sql<number>`(select count(*)::int from ${follows} f where f.following_id = ${user.id})`,
            followingCount: sql<number>`(select count(*)::int from ${follows} f where f.follower_id = ${user.id})`,
          })
          .where(eq(user.id, id));
      }

      return true;
    });

    revalidatePath(`/${username}`);
    revalidatePath("/");
    return { ok: true, blocking };
  } catch (error) {
    if (error instanceof BlockValidationError) {
      return { ok: false, message: error.message };
    }
    console.error("toggle block failed", error);
    return { ok: false, message: "Could not save that. Please try again." };
  }
}
