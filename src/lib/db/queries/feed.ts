import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import { decodeCursor, encodeCursor, type Cursor } from "@/lib/cursor";
import { db } from "@/lib/db";
import { bookmarks, likes, posts, reposts, user } from "@/lib/db/schema";

/**
 * Feed reads. Server Components call these directly, so there is no API layer to
 * keep in sync with the UI.
 */

/** The quoted post, when this post is a quote. */
export interface QuotedPost {
  id: number;
  content: string;
  authorUsername: string;
  authorName: string;
}

export interface FeedPost {
  id: number;
  content: string;
  createdAt: Date;
  parentId: number | null;
  quoted: QuotedPost | null;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  quoteCount: number;
  bookmarkCount: number;
  author: {
    username: string;
    name: string;
    image: string | null;
  };
  /** Set when this is a reply, for the "Replying to @x" context line. */
  replyingToUsername: string | null;
  /**
   * Viewer state. Drives the action buttons and their optimistic UI in Phase 4.
   * All three are false when signed out.
   */
  likedByViewer: boolean;
  repostedByViewer: boolean;
  bookmarkedByViewer: boolean;
}

export interface FeedPage {
  posts: FeedPost[];
  /** Null on the last page; otherwise the "Load more" target. */
  nextCursor: string | null;
}

/**
 * Self-joins. The author of the *parent* post and of the *quoted* post are
 * different users, so `user` is aliased rather than joined twice.
 */
const quotedPost = alias(posts, "quoted_post");
const parentPost = alias(posts, "parent_post");
const quotedAuthor = alias(user, "quoted_author");
const parentAuthor = alias(user, "parent_author");

/**
 * `(created_at, id) < (t, i)` as a row-value comparison so Postgres can walk
 * `posts_created_idx` directly. Spelled out as
 * `created_at < t OR (created_at = t AND id < i)` it is equivalent, but the
 * planner frequently degrades that to a scan.
 */
function keysetPredicate(cursor: Cursor): SQL {
  return sql`(${posts.createdAt}, ${posts.id}) < (${cursor.t}, ${cursor.i})`;
}

/**
 * One query shape for both the signed-in and signed-out case.
 *
 * The three viewer edges are joined against a sentinel id instead of being
 * conditionally omitted. `""` is never a real `user.id` (they are cuids), so
 * signed out yields NULL on every edge - which is the correct answer - and the
 * query planner sees a stable plan instead of a different one per login state.
 *
 * Each join is on the `(post_id, user_id)` primary key, so none of them can fan
 * out the row count.
 */
function selectFeed(
  where: SQL | undefined,
  limit: number,
  viewerId: string | null,
) {
  const viewer = viewerId ?? "";

  return db
    .select({
      id: posts.id,
      content: posts.content,
      createdAt: posts.createdAt,
      parentId: posts.parentId,
      likeCount: posts.likeCount,
      repostCount: posts.repostCount,
      replyCount: posts.replyCount,
      quoteCount: posts.quoteCount,
      bookmarkCount: posts.bookmarkCount,

      authorUsername: user.username,
      authorName: user.name,
      authorImage: user.image,

      quotedId: quotedPost.id,
      quotedContent: quotedPost.content,
      quotedAuthorUsername: quotedAuthor.username,
      quotedAuthorName: quotedAuthor.name,

      parentAuthorUsername: parentAuthor.username,

      likedByViewer: likes.userId,
      repostedByViewer: reposts.userId,
      bookmarkedByViewer: bookmarks.userId,
    })
    .from(posts)
    .innerJoin(user, eq(user.id, posts.authorId))
    .leftJoin(quotedPost, eq(quotedPost.id, posts.quotedPostId))
    .leftJoin(quotedAuthor, eq(quotedAuthor.id, quotedPost.authorId))
    .leftJoin(parentPost, eq(parentPost.id, posts.parentId))
    .leftJoin(parentAuthor, eq(parentAuthor.id, parentPost.authorId))
    .leftJoin(
      likes,
      and(eq(likes.postId, posts.id), eq(likes.userId, viewer)),
    )
    .leftJoin(
      reposts,
      and(eq(reposts.postId, posts.id), eq(reposts.userId, viewer)),
    )
    .leftJoin(
      bookmarks,
      and(eq(bookmarks.postId, posts.id), eq(bookmarks.userId, viewer)),
    )
    .where(where)
    .orderBy(desc(posts.createdAt), desc(posts.id))
    // One extra row is the only "is there a next page?" signal needed, which
    // avoids a second COUNT and the off-by-one when a page comes back exactly
    // full.
    .limit(limit + 1);
}

type PostRow = Awaited<ReturnType<typeof selectFeed>>[number];

function toFeedPost(row: PostRow): FeedPost {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    parentId: row.parentId,
    // Every part of the quote has to be present, not just the id. The quoted
    // post's author is guaranteed to exist by `on delete cascade`, but the
    // compiler cannot know that, so the check is total and degrades to "no
    // quote card" rather than rendering an authorless fragment.
    quoted:
      row.quotedId !== null &&
      row.quotedContent !== null &&
      row.quotedAuthorUsername !== null &&
      row.quotedAuthorName !== null
        ? {
            id: row.quotedId,
            content: row.quotedContent,
            authorUsername: row.quotedAuthorUsername,
            authorName: row.quotedAuthorName,
          }
        : null,
    likeCount: row.likeCount,
    repostCount: row.repostCount,
    replyCount: row.replyCount,
    quoteCount: row.quoteCount,
    bookmarkCount: row.bookmarkCount,
    author: {
      username: row.authorUsername,
      name: row.authorName,
      image: row.authorImage,
    },
    replyingToUsername: row.parentAuthorUsername,
    likedByViewer: row.likedByViewer !== null,
    repostedByViewer: row.repostedByViewer !== null,
    bookmarkedByViewer: row.bookmarkedByViewer !== null,
  };
}

async function toPage(
  rows: PostRow[],
  limit: number,
): Promise<FeedPage> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    posts: page.map(toFeedPost),
    nextCursor:
      hasMore && last
        ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id })
        : null,
  };
}

/**
 * "For you": every post by everyone, newest first. Replies are included - the
 * card renders the parent context - so the timeline is not full of orphaned
 * replies with no visible thread.
 */
export async function getFeedPosts({
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    cursor ? keysetPredicate(cursor) : undefined,
    limit,
    viewerId,
  );
  return toPage(rows, limit);
}

/** Top-level posts by one author. The Posts tab on a profile (Phase 5). */
export async function getPostsByAuthor({
  authorUsername,
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  authorUsername: string;
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    and(
      eq(user.username, authorUsername),
      isNull(posts.parentId),
      cursor ? keysetPredicate(cursor) : undefined,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit);
}

/** Replies by one author, for the Replies tab. */
export async function getRepliesByAuthor({
  authorUsername,
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  authorUsername: string;
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    and(
      eq(user.username, authorUsername),
      isNotNull(posts.parentId),
      cursor ? keysetPredicate(cursor) : undefined,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit);
}

/**
 * Posts the viewer has liked.
 *
 * `viewerId` is required and is always the profile's own owner: a Likes tab is
 * only ever rendered on your own profile. Liking is not private in the schema,
 * but exposing one account's likes through another's profile would be a privacy
 * bug that is much cheaper to never build than to remove later.
 */
export async function getLikedPosts({
  viewerId,
  cursor: rawCursor,
  limit,
}: {
  viewerId: string;
  cursor?: string | null;
  limit: number;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    and(
      sql`exists (select 1 from ${likes} l where l.post_id = ${posts.id} and l.user_id = ${viewerId})`,
      cursor ? keysetPredicate(cursor) : undefined,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit);
}

/**
 * Full-text search over post content, newest first (Phase 7). `websearch_to_tsquery`
 * accepts arbitrary input safely, unlike `to_tsquery`, which would break on a
 * stray quote or colon and surface a Postgres syntax error to the user.
 */
export async function searchPosts({
  query,
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  query: string;
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    and(
      sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${query})`,
      cursor ? keysetPredicate(cursor) : undefined,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit);
}

/** Exists check for the action's quotedPostId validation. */
export async function postExists(id: number): Promise<boolean> {
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  return rows.length > 0;
}

/**
 * The viewer's own bookmarks.
 *
 * `viewerId` is required, not defaulted: bookmarks are private, so there is no
 * sensible signed-out result and no reason to shape this query like the public
 * ones.
 *
 * Ordered by when the post was written, not by when it was bookmarked, so the
 * keyset cursor stays `(posts.created_at, posts.id)`. A bookmark-time cursor
 * would mean a second cursor shape, and reusing `selectFeed` is what keeps the
 * card identical to the one in the feed.
 */
export async function getBookmarkedPosts({
  viewerId,
  cursor: rawCursor,
  limit,
}: {
  viewerId: string;
  cursor?: string | null;
  limit: number;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    and(
      sql`exists (select 1 from ${bookmarks} b where b.post_id = ${posts.id} and b.user_id = ${viewerId})`,
      cursor ? keysetPredicate(cursor) : undefined,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit);
}

/**
 * One post, for the detail page. Null when the id does not exist.
 *
 * `selectFeed` is reused rather than hand-rolled so the detail page renders
 * through exactly the same expression as the feed - the same viewer edges, the
 * same quote and reply-context joins, the same `toFeedPost` mapping. A second
 * query shape here would be a second place for the two to drift apart.
 */
export async function getPostById({
  id,
  viewerId = null,
}: {
  id: number;
  viewerId?: string | null;
}): Promise<FeedPost | null> {
  const rows = await selectFeed(eq(posts.id, id), 1, viewerId);
  return rows[0] ? toFeedPost(rows[0]) : null;
}

/** How many replies a detail page shows before it stops. */
export const REPLY_LIMIT = 20;

/**
 * Direct replies to one post, oldest first.
 *
 * `selectFeed` always orders newest-first, so this reverses after the fact
 * rather than parameterising the direction. A thread reads bottom-to-top, and
 * reversing in memory keeps the keyset cursor in `toPage()` pointing one way for
 * every caller - a second ordering would mean a cursor that is only valid for
 * one of the two orders.
 *
 * Truncated to `REPLY_LIMIT` rather than paginated. A "Load more replies" link
 * needs a second cursor on a page that is itself the result of a cursor, which
 * is Phase 4 work along with the rest of the thread UI.
 */
export async function getReplies({
  parentId,
  viewerId = null,
}: {
  parentId: number;
  viewerId?: string | null;
}): Promise<FeedPost[]> {
  const rows = await selectFeed(eq(posts.parentId, parentId), REPLY_LIMIT, viewerId);
  return rows.slice(0, REPLY_LIMIT).reverse().map(toFeedPost);
}
