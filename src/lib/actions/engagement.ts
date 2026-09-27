"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bookmarks, likes, posts, reposts } from "@/lib/db/schema";
import { notify } from "@/lib/db/queries/notifications";
import { postIdSchema } from "@/lib/validation/post";

/**
 * Likes, reposts, and bookmarks.
 *
 * One action rather than three. The three are the same operation against a
 * different table, they share a guard, and a single entry point means the client
 * has one import and one call shape to reason about. The per-kind work is three
 * small functions below - explicit rather than generic, because Drizzle's
 * `tx.delete`/`tx.insert` over a *union* of three differently-typed tables does
 * not narrow cleanly, and the strictness here is worth more than the
 * abstraction.
 *
 * Every export from a "use server" file must be an async function, so the shared
 * types live here as types only.
 */

export type EngagementKind = "like" | "repost" | "bookmark";

/**
 * The kind arrives from the client, so it is validated like any other input.
 * Without this, an unrecognised value falls through the `switch` below with no
 * `default` branch and the action 500s on `result.active` instead of rejecting.
 */
const engagementKindSchema = z.enum(["like", "repost", "bookmark"]);

export type EngagementResult = {
  active: boolean;
  count: number;
};

export type EngagementState =
  | { ok: true; active: boolean; count: number }
  | { ok: false; message: string };

/** The transaction handle, derived so the driver type is not imported by name. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Counters are recomputed from the join table rather than incremented.
 *
 * Incrementing is the usual approach and it is where drift comes from: every
 * crash, retry, or lost update between the two statements leaves the counter
 * permanently wrong, and the only repair is `pnpm db:recount`. A single
 * `update ... set count = (select count(*) ...)` is one statement, so it cannot
 * disagree with the rows it is counting, and it is self-healing rather than
 * merely correct-on-the-happy-path.
 */
async function toggleLike(
  tx: Tx,
  postId: number,
  userId: string,
): Promise<EngagementResult> {
  const removed = await tx
    .delete(likes)
    .where(and(eq(likes.postId, postId), eq(likes.userId, userId)))
    .returning({ postId: likes.postId });

  if (removed.length === 0) {
    // `on conflict do nothing` is what makes a double-fire harmless: the
    // composite primary key rejects the second insert instead of double-counting.
    await tx.insert(likes).values({ postId, userId }).onConflictDoNothing();
  }

  // `update ... returning` is both the write and the authoritative read-back, so
  // the number returned to the client is the number in the database.
  const [row] = await tx
    .update(posts)
    .set({
      likeCount: sql<number>`(select count(*)::int from ${likes} where ${likes.postId} = ${posts.id})`,
    })
    .where(eq(posts.id, postId))
    .returning({ count: posts.likeCount });

  return { active: removed.length === 0, count: row?.count ?? 0 };
}

async function toggleRepost(
  tx: Tx,
  postId: number,
  userId: string,
): Promise<EngagementResult> {
  const removed = await tx
    .delete(reposts)
    .where(and(eq(reposts.postId, postId), eq(reposts.userId, userId)))
    .returning({ postId: reposts.postId });

  if (removed.length === 0) {
    await tx.insert(reposts).values({ postId, userId }).onConflictDoNothing();
  }

  const [row] = await tx
    .update(posts)
    .set({
      repostCount: sql<number>`(select count(*)::int from ${reposts} where ${reposts.postId} = ${posts.id})`,
    })
    .where(eq(posts.id, postId))
    .returning({ count: posts.repostCount });

  return { active: removed.length === 0, count: row?.count ?? 0 };
}

async function toggleBookmark(
  tx: Tx,
  postId: number,
  userId: string,
): Promise<EngagementResult> {
  const removed = await tx
    .delete(bookmarks)
    .where(and(eq(bookmarks.postId, postId), eq(bookmarks.userId, userId)))
    .returning({ postId: bookmarks.postId });

  if (removed.length === 0) {
    await tx.insert(bookmarks).values({ postId, userId }).onConflictDoNothing();
  }

  const [row] = await tx
    .update(posts)
    .set({
      bookmarkCount: sql<number>`(select count(*)::int from ${bookmarks} where ${bookmarks.postId} = ${posts.id})`,
    })
    .where(eq(posts.id, postId))
    .returning({ count: posts.bookmarkCount });

  return { active: removed.length === 0, count: row?.count ?? 0 };
}

/**
 * Toggles one of the three engagement edges and returns the authoritative state.
 *
 * A signed-out caller is rejected rather than redirected. The three buttons stay
 * visible to signed-out readers because hiding them would only move the
 * affordance somewhere else, and the client sends them to `/sign-in` instead -
 * but this check is the actual guard. The button being absent, greyed out, or
 * unclicked in the DOM is never what stops an unauthorized write.
 */
export async function toggleEngagementAction(
  rawKind: EngagementKind,
  rawPostId: unknown,
): Promise<EngagementState> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, message: "Sign in to do that." };
  }

  const kind = engagementKindSchema.safeParse(rawKind);
  if (!kind.success) {
    return { ok: false, message: "Unknown action." };
  }

  const postId = postIdSchema.safeParse(rawPostId);
  if (!postId.success) {
    return { ok: false, message: "That post no longer exists." };
  }

  // The author is needed for the notification, and confirming the post exists
  // also turns a stale id into a clean rejection instead of a foreign-key
  // violation surfacing as a generic failure.
  const targets = await db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId.data))
    .limit(1);
  const target = targets[0];
  if (!target) {
    return { ok: false, message: "That post no longer exists." };
  }

  let result: EngagementResult;
  try {
    result = await db.transaction(async (tx) => {
      const toggled =
        kind.data === "like"
          ? await toggleLike(tx, postId.data, user.id)
          : kind.data === "repost"
            ? await toggleRepost(tx, postId.data, user.id)
            : await toggleBookmark(tx, postId.data, user.id);

      // Only the *activating* half notifies. Unliking a post is not an event the
      // author wants a notification for, and notifying on both halves would make
      // a single like/unlike pair produce two rows.
      if (toggled.active && kind.data !== "bookmark") {
        await notify(tx, [
          {
            userId: target.authorId,
            actorId: user.id,
            type: kind.data,
            postId: postId.data,
          },
        ]);
      }

      return toggled;
    });
  } catch (error) {
    console.error(`toggle ${kind.data} failed`, error);
    return { ok: false, message: "Could not save that. Please try again." };
  }

  // The feed, the post detail page, and the bookmarks page all read these
  // counters, and they are reached by many URLs, so the cheap correct move is to
  // drop the cached renders of the entry points rather than try to enumerate
  // every page a given post appears on. The pages themselves are dynamic (they
  // read the session cookie), so they re-render regardless.
  revalidatePath("/");
  // The author may have gained a notification, which changes their nav badge.
  revalidatePath("/notifications");

  return { ok: true, active: result.active, count: result.count };
}
