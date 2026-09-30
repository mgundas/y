import "server-only";

import { alias } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { decodeCursor, encodeCursor, type Cursor } from "@/lib/cursor";
import { db } from "@/lib/db";
import {
  blocks,
  bookmarks,
  hashtags,
  likes,
  postHashtags,
  postImages,
  posts,
  reposts,
  user,
} from "@/lib/db/schema";

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

export interface PostImage {
  url: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

export interface FeedPost {
  id: number;
  content: string;
  createdAt: Date;
  parentId: number | null;
  quoted: QuotedPost | null;
  images: PostImage[];
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
 * `(created_at, id) </> (t, i)` as a row-value comparison so Postgres can walk
 * the matching index directly. Spelled out as
 * `created_at < t OR (created_at = t AND id < i)` it is equivalent, but the
 * planner frequently degrades that to a scan.
 *
 * Direction matters: the main feed walks newest-first (`<`), while reply pages
 * walk oldest-first (`>`) so page one is the start of the thread, not the end.
 */
type SortDirection = "desc" | "asc";

function keysetPredicate(cursor: Cursor, direction: SortDirection = "desc"): SQL {
  return direction === "desc"
    ? sql`(${posts.createdAt}, ${posts.id}) < (${cursor.t}, ${cursor.i})`
    : sql`(${posts.createdAt}, ${posts.id}) > (${cursor.t}, ${cursor.i})`;
}

/**
 * Block exclusion for every list query.
 *
 * A viewer never sees posts by someone they blocked, nor by someone who
 * blocked them - in the feed, on profiles, in search, or in bookmarks. Two
 * `NOT EXISTS` halves because the relation is directional and both directions
 * hide. Detail pages (`getPostById`) deliberately skip this: a direct link is
 * not discovery, and inventing a second visibility rule for it would split the
 * semantics.
 */
function excludeBlocked(
  where: SQL | undefined,
  viewerId: string | null,
): SQL | undefined {
  if (!viewerId) return where;
  const hidden = sql`not exists (
    select 1 from ${blocks} b
    where (b.blocker_id = ${viewerId} and b.blocked_id = ${posts.authorId})
       or (b.blocker_id = ${posts.authorId} and b.blocked_id = ${viewerId})
  )`;
  return where ? and(where, hidden) : hidden;
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
  direction: SortDirection = "desc",
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
    .orderBy(
      ...(direction === "desc"
        ? [desc(posts.createdAt), desc(posts.id)]
        : [asc(posts.createdAt), asc(posts.id)]),
    )
    // One extra row is the only "is there a next page?" signal needed, which
    // avoids a second COUNT and the off-by-one when a page comes back exactly
    // full.
    .limit(limit + 1);
}

type PostRow = Awaited<ReturnType<typeof selectFeed>>[number];

function toFeedPost(row: PostRow, hideBookmarkCount: boolean): FeedPost {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    parentId: row.parentId,
    images: [],
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
    // Bookmarks are private. The count is only populated for a signed-in
    // viewer; signed out it is 0 rather than the real number, so the card
    // cannot leak how many people saved a post to a reader with no account.
    bookmarkCount: hideBookmarkCount ? 0 : row.bookmarkCount,
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
  viewerId: string | null,
): Promise<FeedPage> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const hideBookmarkCount = viewerId === null;

  const feedPosts = page.map((row) => toFeedPost(row, hideBookmarkCount));

  // Media read side: one query for the whole page, mapped back by post id.
  // A join would fan out the rows; `selectFeed`'s limit counts posts, not
  // (post, image) pairs, so the images ride along separately.
  if (feedPosts.length > 0) {
    const imageRows = await db
      .select({
        postId: postImages.postId,
        url: postImages.url,
        altText: postImages.altText,
        width: postImages.width,
        height: postImages.height,
      })
      .from(postImages)
      .where(
        inArray(
          postImages.postId,
          feedPosts.map((post) => post.id),
        ),
      )
      .orderBy(asc(postImages.postId), asc(postImages.position));
    const byPost = new Map<number, PostImage[]>();
    for (const image of imageRows) {
      const list = byPost.get(image.postId) ?? [];
      list.push({
        url: image.url,
        altText: image.altText,
        width: image.width,
        height: image.height,
      });
      byPost.set(image.postId, list);
    }
    for (const post of feedPosts) {
      post.images = byPost.get(post.id) ?? [];
    }
  }

  return {
    posts: feedPosts,
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
    excludeBlocked(
      cursor ? keysetPredicate(cursor) : undefined,
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
}

/**
 * Posts tab on a profile: top-level posts by the author *plus* their reposts.
 *
 * Reposts previously surfaced nowhere on profiles - reposting felt like
 * shouting into the void, which is the bug being fixed. Ordered by post
 * recency, not repost time, so the keyset cursor stays `(posts.created_at,
 * posts.id)`: same tradeoff as `/bookmarks`, and reusing `selectFeed` is what
 * keeps the card identical. A repost of one's own post matches both halves
 * but is still one row, so it cannot duplicate.
 */
export async function getPostsByAuthor({
  authorUsername,
  authorId,
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  authorUsername: string;
  /** The profile owner's id. Reposts are keyed off it, not the username. */
  authorId: string;
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    excludeBlocked(
      and(
        or(
          and(
            // Case-insensitive like the profile lookup itself: `/AdaLovelace`
            // resolves, so its tabs must too instead of 404ing on a re-cased URL.
            sql`lower(${user.username}) = ${authorUsername.toLowerCase()}`,
            isNull(posts.parentId),
          ),
          sql`exists (select 1 from ${reposts} r where r.post_id = ${posts.id} and r.user_id = ${authorId})`,
        ),
        cursor ? keysetPredicate(cursor) : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
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
    excludeBlocked(
      and(
        sql`lower(${user.username}) = ${authorUsername.toLowerCase()}`,
        isNotNull(posts.parentId),
        cursor ? keysetPredicate(cursor) : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
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
    excludeBlocked(
      and(
        sql`exists (select 1 from ${likes} l where l.post_id = ${posts.id} and l.user_id = ${viewerId})`,
        cursor ? keysetPredicate(cursor) : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
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
    excludeBlocked(
      and(
        sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${query})`,
        cursor ? keysetPredicate(cursor) : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
}

/** Posts carrying one hashtag, newest first. Powers `/explore/hashtag/[tag]`. */
export async function getPostsByHashtag({
  tag,
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  tag: string;
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    excludeBlocked(
      and(
        sql`exists (
          select 1 from ${postHashtags} ph
          join ${hashtags} h on h.id = ph.hashtag_id
          where ph.post_id = ${posts.id} and h.tag = ${tag.toLowerCase()}
        )`,
        cursor ? keysetPredicate(cursor) : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
}

export interface TrendingTag {
  tag: string;
  postCount24h: number;
}

/**
 * Hashtags with the most posts in the last 24 hours.
 *
 * Counted from the join rows rather than `hashtags.post_count`, which is an
 * all-time denormalized counter with no time dimension. Twenty-four hours is
 * the window because trending means "right now", not "ever".
 */
export async function getTrendingHashtags(limit: number): Promise<TrendingTag[]> {
  // `db.execute` returns a Result proxy, not an Array - spread it first.
  const rows = [
    ...(await db.execute<{ tag: string; n: number }>(sql`
      select h.tag as tag, count(*)::int as n
      from ${postHashtags} ph
      join ${hashtags} h on h.id = ph.hashtag_id
      join ${posts} p on p.id = ph.post_id
      where p.created_at > now() - interval '24 hours'
      group by h.tag
      order by n desc, h.tag asc
      limit ${limit}
    `)),
  ];
  return rows.map((row) => ({ tag: row.tag, postCount24h: row.n }));
}

export interface UserResult {
  id: string;
  username: string;
  name: string;
  image: string | null;
  bio: string | null;
}

/**
 * People matching a search string, by username prefix first, then name.
 *
 * Bounded and ordered deterministically. This is the "users" half of search;
 * posts are `searchPosts` above.
 */
export async function searchUsers({
  query,
  limit,
}: {
  query: string;
  limit: number;
}): Promise<UserResult[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await db
    .select({
      id: user.id,
      username: user.username,
      name: user.name,
      image: user.image,
      bio: user.bio,
    })
    .from(user)
    .where(
      sql`lower(${user.username}) like ${`${q}%`} or lower(${user.name}) like ${`%${q}%`}`,
    )
    .orderBy(asc(user.username))
    .limit(limit);
  return [...rows];
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
    excludeBlocked(
      and(
        sql`exists (select 1 from ${bookmarks} b where b.post_id = ${posts.id} and b.user_id = ${viewerId})`,
        cursor ? keysetPredicate(cursor) : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
  );
  return toPage(rows, limit, viewerId);
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
  return rows[0] ? toFeedPost(rows[0], viewerId === null) : null;
}

/** How many replies a detail page shows per chunk. */
export const REPLY_LIMIT = 20;

/**
 * Direct replies to one post, oldest first, keyset-paginated.
 *
 * Ascending rather than descending: page one is the *start* of the thread, and
 * "Show more replies" walks forward toward the newest. The cursor travels as
 * `?repliesCursor=`, which cannot collide with anything because the detail
 * page itself is addressed by id, not by cursor.
 */
export async function getReplies({
  parentId,
  cursor: rawCursor,
  limit,
  viewerId = null,
}: {
  parentId: number;
  cursor?: string | null;
  limit: number;
  viewerId?: string | null;
}): Promise<FeedPage> {
  const cursor = decodeCursor(rawCursor);
  const rows = await selectFeed(
    excludeBlocked(
      and(
        eq(posts.parentId, parentId),
        cursor ? keysetPredicate(cursor, "asc") : undefined,
      ),
      viewerId,
    ),
    limit,
    viewerId,
    "asc",
  );
  return toPage(rows, limit, viewerId);
}
