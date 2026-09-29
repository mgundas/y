"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { blocks, follows, user } from "@/lib/db/schema";
import { notify } from "@/lib/db/queries/notifications";
import { checkMutationRateLimit } from "@/lib/ratelimit";
import { usernameSchema } from "@/lib/validation/auth";

/** Same pattern as the engagement and post actions: read vs broken. */
class FollowValidationError extends Error {}

/**
 * Follow / unfollow.
 *
 * Structurally the same operation as the engagement toggles in
 * `engagement.ts`: delete-then-insert against a composite primary key, then
 * recompute the affected counters from the join table rather than incrementing
 * them. The reasoning is written down there; this file is the two-user version.
 */

export type FollowState =
  | { ok: true; following: boolean; followerCount: number; followingCount: number }
  | { ok: false; message: string };

export async function toggleFollowAction(
  rawUsername: unknown,
): Promise<FollowState> {
  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, message: "Sign in to follow people." };
  }

  const parsed = usernameSchema.safeParse(rawUsername);
  if (!parsed.success) {
    return { ok: false, message: "That account no longer exists." };
  }
  const username = parsed.data;

  // Fifty follows an hour per user. Follow-spam is the cheapest form of
  // harassment here, and the budget is high enough no real user notices it.
  const allowed = await checkMutationRateLimit({
    userId: viewer.id,
    scope: "follow",
    windowSeconds: 3600,
    max: 50,
  });
  if (!allowed) {
    return { ok: false, message: "You're following too fast. Slow down." };
  }

  let result: FollowState;
  try {
    result = await db.transaction(async (tx): Promise<FollowState> => {
      // Case-insensitive, like the profile lookup: the follow button lives on
      // `/{username}`, which resolves re-cased URLs, so the action must too
      // instead of 404ing where the page renders. Read inside the transaction
      // so a deleted account cannot slip between the check and the write.
      const targets = await tx
        .select({ id: user.id, username: user.username })
        .from(user)
        .where(sql`lower(${user.username}) = ${username}`)
        .limit(1);
      const target = targets[0];

      if (!target) {
        throw new FollowValidationError("That account no longer exists.");
      }

      // `follows` has `CHECK (follower_id <> following_id)`, so a self-follow
      // would be rejected by the database too. Rejecting it here means the
      // user gets a sentence instead of a generic failure, and the button does
      // not have to be hidden for the check to hold.
      if (target.id === viewer.id) {
        throw new FollowValidationError("You cannot follow yourself.");
      }

      // A block in either direction forbids the follow. Same sentence as a
      // missing account, so neither side's block state leaks to the other.
      const blockRows = await tx
        .select({ blockerId: blocks.blockerId })
        .from(blocks)
        .where(
          sql`(${blocks.blockerId} = ${viewer.id} and ${blocks.blockedId} = ${target.id})
            or (${blocks.blockerId} = ${target.id} and ${blocks.blockedId} = ${viewer.id})`,
        )
        .limit(1);
      if (blockRows.length > 0) {
        throw new FollowValidationError("That account no longer exists.");
      }

      const removed = await tx
        .delete(follows)
        .where(
          and(
            eq(follows.followerId, viewer.id),
            eq(follows.followingId, target.id),
          ),
        )
        .returning({ followingId: follows.followingId });

      if (removed.length === 0) {
        await tx
          .insert(follows)
          .values({ followerId: viewer.id, followingId: target.id })
          .onConflictDoNothing();
      }

      // Both counters are derived, not adjusted. `following_id = user.id` is the
      // count of people following this account; `follower_id = user.id` is how
      // many it follows. Two `update ... returning` statements, each of which
      // is simultaneously the write and the authoritative read-back.
      const [profile] = await tx
        .update(user)
        .set({
          followerCount: sql<number>`(select count(*)::int from ${follows} f where f.following_id = ${user.id})`,
        })
        .where(eq(user.id, target.id))
        .returning({ followerCount: user.followerCount });

      const [self] = await tx
        .update(user)
        .set({
          followingCount: sql<number>`(select count(*)::int from ${follows} f where f.follower_id = ${user.id})`,
        })
        .where(eq(user.id, viewer.id))
        .returning({ followingCount: user.followingCount });

      // Only the activating half notifies - unfollowing is not an event worth a
      // row. `postId` is null because a follow is not attached to a post, which
      // is why the column is nullable.
      if (removed.length === 0) {
        await notify(tx, [
          {
            userId: target.id,
            actorId: viewer.id,
            type: "follow",
            postId: null,
          },
        ]);
      }

      return {
        ok: true,
        following: removed.length === 0,
        followerCount: profile?.followerCount ?? 0,
        followingCount: self?.followingCount ?? 0,
      };
    });
  } catch (error) {
    if (error instanceof FollowValidationError) {
      return { ok: false, message: error.message };
    }
    console.error("toggle follow failed", error);
    return { ok: false, message: "Could not save that. Please try again." };
  }

  if (result.ok) {
    // The follower count appears on the profile page, on the viewer's own
    // profile ("N following"), and in the sidebar's who-to-follow, so both paths
    // are invalidated. The feed is unaffected by a follow.
    revalidatePath(`/${username}`);
    revalidatePath("/");
    revalidatePath("/notifications");
  }

  return result;
}
