import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, count, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { blocks, follows, likes, posts, user } from "@/lib/db/schema";

/**
 * Profile reads. Separate from `feed.ts` because these return a `user` row
 * rather than posts, so there is no `selectFeed` shape to share.
 */

export interface Profile {
  id: string;
  username: string;
  name: string;
  image: string | null;
  bannerUrl: string | null;
  bio: string | null;
  createdAt: Date;
  followerCount: number;
  followingCount: number;
  postCount: number;
  /** False for everyone when signed out - the same sentinel trick `selectFeed` uses. */
  followedByViewer: boolean;
  /** True when the viewer is looking at their own profile. */
  isSelf: boolean;
  /**
   * Block state in both directions. Either one hides the profile's posts: the
   * page renders a notice instead of the timeline, and the viewer's feed never
   * contained them in the first place (`excludeBlocked` in `feed.ts`).
   */
  blockedByViewer: boolean;
  blockingViewer: boolean;
}

export async function getProfileByUsername({
  username,
  viewerId = null,
}: {
  username: string;
  viewerId?: string | null;
}): Promise<Profile | null> {
  // `lower()` on both sides so `/AdaLovelace` and `/adalovelace` are the same
  // page. The column is already stored lowercase, but the URL is not, and a
  // 404 on a re-cased link is a bad first impression.
  // Aliased twice because blocks are directional: one join reads "viewer
  // blocked this profile", the other "this profile blocked the viewer".
  const viewerBlock = alias(blocks, "viewer_block");
  const profileBlock = alias(blocks, "profile_block");

  const rows = await db
    .select({
      id: user.id,
      username: user.username,
      name: user.name,
      image: user.image,
      bannerUrl: user.bannerUrl,
      bio: user.bio,
      createdAt: user.createdAt,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      postCount: user.postCount,
      followedByViewer: follows.followerId,
      blockedByViewer: viewerBlock.blockedId,
      blockingViewer: profileBlock.blockerId,
    })
    .from(user)
    .leftJoin(
      follows,
      and(
        eq(follows.followerId, viewerId ?? ""),
        eq(follows.followingId, user.id),
      ),
    )
    .leftJoin(
      viewerBlock,
      and(
        eq(viewerBlock.blockerId, viewerId ?? ""),
        eq(viewerBlock.blockedId, user.id),
      ),
    )
    .leftJoin(
      profileBlock,
      and(
        eq(profileBlock.blockerId, user.id),
        eq(profileBlock.blockedId, viewerId ?? ""),
      ),
    )
    .where(sql`lower(${user.username}) = ${username.toLowerCase()}`)
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    followedByViewer: row.followedByViewer !== null,
    isSelf: viewerId !== null && viewerId === row.id,
    blockedByViewer: row.blockedByViewer !== null,
    blockingViewer: row.blockingViewer !== null,
  };
}

export interface ProfileTabCounts {
  posts: number;
  replies: number;
  /** `null` for anyone but the profile's owner. */
  likes: number | null;
}

/**
 * Tab counts, so the strip cannot disagree with the page under it.
 *
 * Posts and replies come from one grouped query with a `filter` aggregate rather
 * than two counts, and only when the active tab needs them. Likes are counted
 * separately, and only for the owner.
 */
export async function getProfileTabCounts({
  authorId,
  isSelf,
}: {
  authorId: string;
  isSelf: boolean;
}): Promise<ProfileTabCounts> {
  const [row] = await db
    .select({
      posts: sql<number>`count(*) filter (where ${posts.parentId} is null)::int`,
      replies: sql<number>`count(*) filter (where ${posts.parentId} is not null)::int`,
    })
    .from(posts)
    .where(eq(posts.authorId, authorId));

  if (!isSelf) {
    return { posts: row?.posts ?? 0, replies: row?.replies ?? 0, likes: null };
  }

  const [liked] = await db
    .select({ n: count() })
    .from(likes)
    .where(eq(likes.userId, authorId));

  return {
    posts: row?.posts ?? 0,
    replies: row?.replies ?? 0,
    likes: liked?.n ?? 0,
  };
}
