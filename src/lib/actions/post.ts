"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getCurrentUser, requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import {
  blocks,
  hashtags,
  postHashtags,
  posts,
  user,
} from "@/lib/db/schema";
import { notify } from "@/lib/db/queries/notifications";
import { checkMutationRateLimit } from "@/lib/ratelimit";
import { extractHashtags, extractMentions, MENTION_MAX } from "@/lib/text";
import {
  createPostSchema,
  postIdSchema,
  type PostFormState,
} from "@/lib/validation/post";

/**
 * Every export from a "use server" file must be an async function, so the
 * shared types live in `@/lib/validation/post`.
 *
 * Signature note: the leading `prevState` is what `useActionState` expects, and
 * React binds it for the no-JavaScript path too - posting this form with JS
 * disabled still renders the returned error state on the server. The composer
 * must therefore use `useActionState`; calling this action directly (as
 * `useTransition` would) shifts `FormData` into `prevState` and throws.
 *
 * Nothing here trusts the form. `parentId`/`quotedPostId` arrive as strings and
 * are parsed and range-checked here, and both parents are confirmed to exist
 * before anything is written - otherwise a client could attach a post id that
 * has since been deleted.
 */

/** A post can be a reply or a quote, never both - the two columns are independent. */

/**
 * A rejection the user should read, thrown from inside the transaction.
 * Anything else thrown in there is a real failure and keeps the generic
 * message. Without this distinction, "post was deleted a second ago" and
 * "the database is down" would have to share one sentence.
 */
class PostValidationError extends Error {}

export async function createPostAction(
  _prevState: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const session = await requireSession();

  const parsed = createPostSchema.safeParse({
    content: formData.get("content"),
    // Absent form fields arrive as null, which `z.coerce.number()` would turn
    // into 0 rather than leaving the field undefined. Normalise first.
    parentId: formData.get("parentId") ?? undefined,
    quotedPostId: formData.get("quotedPostId") ?? undefined,
  });

  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors };
  }

  const { content, parentId, quotedPostId } = parsed.data;

  if (parentId !== undefined && quotedPostId !== undefined) {
    return { message: "A post can be a reply or a quote, not both." };
  }

  const tags = extractHashtags(content);
  const mentions = extractMentions(content);

  if (mentions.length > MENTION_MAX) {
    return {
      message: `Too many mentions - at most ${MENTION_MAX} people per post.`,
    };
  }

  // Twenty posts per ten minutes per user. Generous for humans, expensive for
  // scripts: without it one account can fill the feed faster than anyone reads.
  const allowed = await checkMutationRateLimit({
    userId: session.user.id,
    scope: "post",
    windowSeconds: 600,
    max: 20,
  });
  if (!allowed) {
    return { message: "You're posting too fast. Slow down and try again." };
  }

  try {
    // One transaction: the post, its hashtag edges, the hashtag counters, and
    // every denormalized count either all land or none do. A post whose
    // `like_count`/`post_count` disagreed with its join rows would be drift that
    // only `pnpm db:recount` could detect, so it must not be reachable.
    //
    // Existence of the parent/quoted post is checked *inside* the transaction,
    // not before it. A pre-check followed by a write is a TOCTOU gap: the
    // target can be deleted in between, turning the insert into a foreign-key
    // violation that surfaces as a generic 500 instead of a sentence.
    await db.transaction(async (tx) => {
      if (parentId !== undefined) {
        const parents = await tx
          .select({ id: posts.id, authorId: posts.authorId })
          .from(posts)
          .where(eq(posts.id, parentId))
          .limit(1);
        const parent = parents[0];
        if (!parent) {
          throw new PostValidationError(
            "The post you tried to reply to no longer exists.",
          );
        }
        // Replies are discovery-shaped: answering someone who blocked you, or
        // whom you blocked, routes around the block. Reject with the same
        // sentence as a deleted post so the reply target's block state is not
        // confirmed to the replier. (Replying to one's own post stays legal -
        // that is how threads are built - it only skips the notification.)
        const blockRows = await tx
          .select({ blockerId: blocks.blockerId })
          .from(blocks)
          .where(
            or(
              and(
                eq(blocks.blockerId, session.user.id),
                eq(blocks.blockedId, parent.authorId),
              ),
              and(
                eq(blocks.blockerId, parent.authorId),
                eq(blocks.blockedId, session.user.id),
              ),
            ),
          )
          .limit(1);
        if (blockRows.length > 0) {
          throw new PostValidationError(
            "The post you tried to reply to no longer exists.",
          );
        }
      }

      if (quotedPostId !== undefined) {
        const quoted = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.id, quotedPostId))
          .limit(1);
        if (!quoted[0]) {
          throw new PostValidationError(
            "The post you tried to quote no longer exists.",
          );
        }
      }

      const [created] = await tx
        .insert(posts)
        .values({
          authorId: session.user.id,
          content,
          parentId: parentId ?? null,
          quotedPostId: quotedPostId ?? null,
        })
        .returning({ id: posts.id });

      if (!created) throw new Error("insert returned no row");

      // Recomputed, not incremented - same rule as the engagement toggles.
      // `+ 1` is where drift comes from: a retried request increments twice
      // for one row, and only `db:recount` can see it. A subselect cannot
      // disagree with the rows it counts.
      await tx
        .update(user)
        .set({
          postCount: sql<number>`(select count(*)::int from ${posts} p where p.author_id = ${user.id})`,
        })
        .where(eq(user.id, session.user.id));

      if (parentId !== undefined) {
        await tx
          .update(posts)
          .set({
            replyCount: sql<number>`(select count(*)::int from ${posts} r where r.parent_id = ${posts.id})`,
          })
          .where(eq(posts.id, parentId));
      }

      if (quotedPostId !== undefined) {
        await tx
          .update(posts)
          .set({
            quoteCount: sql<number>`(select count(*)::int from ${posts} q where q.quoted_post_id = ${posts.id})`,
          })
          .where(eq(posts.id, quotedPostId));
      }

      // Notifications, in the same transaction as the post. A committed reply
      // with no notification is a silent gap the recipient cannot detect.
      //
      // This block has to sit *above* the `tags.length === 0` early return
      // below. A bare `reply` or `mention` with no hashtag is the common case,
      // and anything placed after that return is skipped for exactly those
      // posts - which is how a hashtag-less reply silently produced no
      // notification while hashtagged ones worked fine.
      //
      // Mentions resolve to real ids in one query rather than per-mention. A
      // mention of a username that no longer exists is simply dropped, which is
      // the same outcome as the broken `@handle` link the renderer produces.
      const authorIds = new Map<string, string>();
      if (mentions.length > 0) {
        const found = await tx
          .select({ id: user.id, username: user.username })
          .from(user)
          .where(inArray(user.username, mentions));
        for (const row of found) authorIds.set(row.username, row.id);
      }

      const toNotify: {
        userId: string;
        actorId: string;
        type: "reply" | "mention";
        postId: number;
      }[] = [];

      if (parentId !== undefined) {
        const parents = await tx
          .select({ authorId: posts.authorId })
          .from(posts)
          .where(eq(posts.id, parentId))
          .limit(1);
        const parent = parents[0];
        // A reply to one's own post is not a notification. `notify` also filters
        // this, but skipping the query entirely is cheaper and the intent is
        // clearer here.
        if (parent && parent.authorId !== session.user.id) {
          toNotify.push({
            userId: parent.authorId,
            actorId: session.user.id,
            type: "reply",
            postId: created.id,
          });
        }
      }

      for (const mention of mentions) {
        const mentionedId = authorIds.get(mention);
        if (mentionedId === undefined) continue;
        toNotify.push({
          userId: mentionedId,
          actorId: session.user.id,
          type: "mention",
          postId: created.id,
        });
      }

      await notify(tx, toNotify);

      // From here on the post exists and its counters are updated, so nothing
      // below may return early in a way that skips the hashtag work without
      // meaning to. Hashtag-free posts are the case this guards.
      if (tags.length === 0) return;

      // A tag can already exist, and two concurrent posts can both be the first
      // to use it. `on conflict do nothing` then a re-select is race-free: the
      // loser's insert is a no-op and both read the same id.
      const inserted = await tx
        .insert(hashtags)
        .values(tags.map((tag) => ({ tag })))
        .onConflictDoNothing({ target: hashtags.tag })
        .returning({ id: hashtags.id, tag: hashtags.tag });

      const known = new Map(inserted.map((row) => [row.tag, row.id]));
      const missing = tags.filter((tag) => !known.has(tag));
      if (missing.length > 0) {
        const existing = await tx
          .select({ id: hashtags.id, tag: hashtags.tag })
          .from(hashtags)
          .where(inArray(hashtags.tag, missing));
        for (const row of existing) known.set(row.tag, row.id);
      }

      for (const tag of tags) {
        const hashtagId = known.get(tag);
        if (hashtagId === undefined) continue;
        // The same tag twice in one post is already de-duplicated by
        // `extractHashtags`, so this cannot violate the composite PK.
        await tx.insert(postHashtags).values({ postId: created.id, hashtagId });
        // Recomputed, not incremented - a retried request must not count one
        // edge twice. Same rule as every other counter in this file.
        await tx
          .update(hashtags)
          .set({
            postCount: sql<number>`(select count(*)::int from ${postHashtags} ph where ph.hashtag_id = ${hashtags.id})`,
          })
          .where(eq(hashtags.id, hashtagId));
      }
    });
  } catch (error) {
    if (error instanceof PostValidationError) {
      return { message: error.message };
    }
    console.error("create post failed", error);
    return { message: "Could not publish. Please try again." };
  }

  // The feed is keyset-paginated, so a new post always belongs at the top of
  // page one. Revalidating the path drops the cached first page, which is where
  // the new post would otherwise be missing from. The author's profile is
  // revalidated too, since the Posts tab and counts change.
  //
  // Residual gap, documented not fixed: the parent detail page (for a reply)
  // and /bookmarks are not revalidated here - a post appears on too many URLs
  // to enumerate. JS clients settle via `router.refresh()`; a no-JS client
  // viewing the parent thread sees the reply after its next navigation.
  revalidatePath("/");
  revalidatePath(`/${session.user.username}`);

  return { ok: true };
}

/**
 * Deletes a post owned by the caller, with its edges.
 *
 * Owner-only: the delete's `where` includes the author id, so the affected-row
 * count is the authorization check - zero rows means "not yours or not there",
 * and the two are deliberately indistinguishable. Counters touched by the
 * cascade are recomputed in the same transaction, because `ON DELETE CASCADE`
 * removes join rows without adjusting any denormalized count.
 */
export async function deletePostAction(
  rawPostId: unknown,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const viewer = await getCurrentUser();
  if (!viewer) {
    return { ok: false, message: "Sign in to do that." };
  }

  const postId = postIdSchema.safeParse(rawPostId);
  if (!postId.success) {
    return { ok: false, message: "That post no longer exists." };
  }

  try {
    const deleted = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({
          id: posts.id,
          authorId: posts.authorId,
          parentId: posts.parentId,
          quotedPostId: posts.quotedPostId,
        })
        .from(posts)
        .where(eq(posts.id, postId.data))
        .limit(1);
      if (!target || target.authorId !== viewer.id) return false;

      // Capture the tag edges before the delete: the cascade removes them,
      // and after that there is no record of which tags' counters to repair.
      const tagEdges = await tx
        .select({ hashtagId: postHashtags.hashtagId })
        .from(postHashtags)
        .where(eq(postHashtags.postId, postId.data));

      // Notifications pointing at the post cascade with it (`onDelete:
      // cascade`), so there is nothing to clean there. Likes, reposts, and
      // bookmarks cascade too - but the *counters on surviving rows* do not
      // repair themselves, which is what the recomputes below are for.
      await tx.delete(posts).where(eq(posts.id, postId.data));

      await tx
        .update(user)
        .set({
          postCount: sql<number>`(select count(*)::int from ${posts} p where p.author_id = ${user.id})`,
        })
        .where(eq(user.id, viewer.id));

      if (target.parentId !== null) {
        await tx
          .update(posts)
          .set({
            replyCount: sql<number>`(select count(*)::int from ${posts} r where r.parent_id = ${posts.id})`,
          })
          .where(eq(posts.id, target.parentId));
      }

      if (target.quotedPostId !== null) {
        await tx
          .update(posts)
          .set({
            quoteCount: sql<number>`(select count(*)::int from ${posts} q where q.quoted_post_id = ${posts.id})`,
          })
          .where(eq(posts.id, target.quotedPostId));
      }

      // Hashtag edges cascade with the post; the tags' counters need the same
      // treatment. Only tags this post actually used are touched, using the
      // ids captured above.
      for (const edge of tagEdges) {
        await tx
          .update(hashtags)
          .set({
            postCount: sql<number>`(select count(*)::int from ${postHashtags} ph where ph.hashtag_id = ${hashtags.id})`,
          })
          .where(eq(hashtags.id, edge.hashtagId));
      }
      return true;
    });

    if (!deleted) {
      return { ok: false, message: "That post no longer exists." };
    }
  } catch (error) {
    console.error("delete post failed", error);
    return { ok: false, message: "Could not delete that. Please try again." };
  }

  revalidatePath("/");
  revalidatePath(`/${viewer.username}`);
  return { ok: true };
}
