"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { follows, user } from "@/lib/db/schema";
import { notify } from "@/lib/db/queries/notifications";
import { usernameSchema } from "@/lib/validation/auth";

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

  const targets = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.username, username))
    .limit(1);
  const target = targets[0];

  if (!target) {
    return { ok: false, message: "That account no longer exists." };
  }

  // `follows` has `CHECK (follower_id <> following_id)`, so a self-follow would
  // be rejected by the database too. Rejecting it here means the user gets a
  // sentence instead of a generic failure, and the button does not have to be
  // hidden for the check to hold.
  if (target.id === viewer.id) {
    return { ok: false, message: "You cannot follow yourself." };
  }

  let result: FollowState;
  try {
    result = await db.transaction(async (tx): Promise<FollowState> => {
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
