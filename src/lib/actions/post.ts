"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { hashtags, postHashtags, posts, user } from "@/lib/db/schema";
import { postExists } from "@/lib/db/queries/feed";
import { notify } from "@/lib/db/queries/notifications";
import { extractHashtags, extractMentions } from "@/lib/text";
import {
  createPostSchema,
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

  if (parentId !== undefined && !(await postExists(parentId))) {
    return { message: "The post you tried to reply to no longer exists." };
  }

  if (quotedPostId !== undefined && !(await postExists(quotedPostId))) {
    return { message: "The post you tried to quote no longer exists." };
  }

  const tags = extractHashtags(content);
  const mentions = extractMentions(content);

  try {
    // One transaction: the post, its hashtag edges, the hashtag counters, and
    // every denormalized count either all land or none do. A post whose
    // `like_count`/`post_count` disagreed with its join rows would be drift that
    // only `pnpm db:recount` could detect, so it must not be reachable.
    await db.transaction(async (tx) => {
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

      // `user.post_count` counts every post by the author, replies included -
      // this is exactly what `db:recount` recomputes, so the two must agree.
      await tx
        .update(user)
        .set({ postCount: sql`${user.postCount} + 1` })
        .where(eq(user.id, session.user.id));

      if (parentId !== undefined) {
        await tx
          .update(posts)
          .set({ replyCount: sql`${posts.replyCount} + 1` })
          .where(eq(posts.id, parentId));
      }

      if (quotedPostId !== undefined) {
        await tx
          .update(posts)
          .set({ quoteCount: sql`${posts.quoteCount} + 1` })
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
        await tx
          .update(hashtags)
          .set({ postCount: sql`${hashtags.postCount} + 1` })
          .where(eq(hashtags.id, hashtagId));
      }
    });
  } catch (error) {
    console.error("create post failed", error);
    return { message: "Could not publish. Please try again." };
  }

  // The feed is keyset-paginated, so a new post always belongs at the top of
  // page one. Revalidating the path drops the cached first page, which is where
  // the new post would otherwise be missing from.
  revalidatePath("/");

  return { ok: true };
}
