import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Composer } from "@/components/feed/composer";
import { PostCard } from "@/components/post/post-card";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getPostById,
  getReplies,
  type FeedPost,
} from "@/lib/db/queries/feed";

/**
 * A single post with its direct replies.
 *
 * This exists because the feed's action row needs a real destination, and
 * because `createPostAction` already accepts a `parentId` that nothing in the UI
 * could supply. Both of those point here, so the route is deliberately thin: no
 * new query shape, no new card component.
 *
 * Deliberately not implemented, and left to Phase 4: paginating replies,
 * nested threads, and the like/repost/bookmark controls.
 */

/**
 * The id is a `bigserial` rendered into a URL, so it is untrusted text. A regex
 * plus a safe-integer check rejects `abc`, `1e3`, `-1`, `1.5`, and a 20-digit
 * overflow before any query runs, rather than letting them reach Postgres as a
 * `NaN` comparison that silently matches nothing.
 */
function parseId(raw: string): number | null {
  if (!/^[0-9]{1,15}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * `cache` dedupes this between `generateMetadata` and the page body, which both
 * need the post. Without it every detail page request runs the query twice.
 */
const loadPost = cache(
  async (id: number): Promise<FeedPost | null> =>
    getPostById({ id, viewerId: (await getCurrentUser())?.id ?? null }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const postId = parseId(id);
  const post = postId === null ? null : await loadPost(postId);

  if (!post) return { title: "Post" };
  return { title: `${post.author.name} (@${post.author.username})` };
}

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ username: string; id: string }>;
}) {
  const { username, id } = await params;

  const postId = parseId(id);
  if (postId === null) notFound();

  const user = await getCurrentUser();
  const post = await loadPost(postId);
  if (!post) notFound();

  // One canonical URL per post. The id is the real key; the username is only
  // there to make the link readable. A mismatch means the post exists but not
  // under this author, so this is a stale or hand-edited link - a 404 is the
  // honest answer, and it stops the same post being reachable under two paths.
  if (post.author.username !== username.toLowerCase()) notFound();

  const replies = await getReplies({
    parentId: post.id,
    viewerId: user?.id ?? null,
  });

  const newestReplyId = replies.at(-1)?.id ?? post.id;

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Post</h1>
      </header>

      <ul>
        <li>
          <PostCard post={post} signedIn={Boolean(user)} />
        </li>
      </ul>

      {user ? (
        // Same reset trick as the home page: the key moves when a reply lands,
        // so the textarea remounts empty, and stays put when the action
        // rejects so the typed text survives.
        <Composer
          key={newestReplyId}
          user={{
            name: user.name,
            username: user.username,
            image: user.image ?? null,
          }}
          parentId={post.id}
          placeholder={`Reply to @${post.author.username}`}
          submitLabel="Reply"
        />
      ) : (
        <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
          <Link
            href="/sign-in"
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>{" "}
          to reply.
        </p>
      )}

      <h2 className="px-4 py-3 text-sm font-semibold text-muted-foreground">
        {post.replyCount === 0
          ? "Replies"
          : post.replyCount === 1
            ? "1 reply"
            : `${post.replyCount} replies`}
      </h2>

      {replies.length === 0 ? (
        <p className="px-4 pb-8 text-center text-sm text-muted-foreground">
          No replies yet.
        </p>
      ) : (
        <>
          {post.replyCount > replies.length ? (
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              Showing the {replies.length} most recent.
            </p>
          ) : null}
          <ul>
            {replies.map((reply) => (
              <li key={reply.id}>
                <PostCard post={reply} signedIn={Boolean(user)} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
