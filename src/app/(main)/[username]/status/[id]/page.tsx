import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Composer } from "@/components/feed/composer";
import { PostCard } from "@/components/post/post-card";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getPostById,
  getReplies,
  REPLY_LIMIT,
} from "@/lib/db/queries/feed";

/**
 * A single post with its direct replies.
 *
 * Replies are keyset-paginated oldest-first under `?repliesCursor=`: page one
 * is the start of the thread, and "Show more replies" walks forward. The
 * cursor cannot collide with anything because the page itself is addressed by
 * id, not by cursor.
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const postId = parseId(id);
  // Signed out on purpose: metadata must never depend on who is asking, or
  // the cache key splits per user and link unfurls vary.
  const post = postId === null ? null : await getPostById({ id: postId });

  if (!post) return { title: "Post" };
  const description =
    post.content.length > 160
      ? `${post.content.slice(0, 157)}…`
      : post.content;
  return {
    title: `${post.author.name} (@${post.author.username})`,
    description,
    openGraph: { title: `${post.author.name} (@${post.author.username})`, description },
  };
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string; id: string }>;
  searchParams: Promise<{ repliesCursor?: string }>;
}) {
  const { username, id } = await params;
  const { repliesCursor } = await searchParams;

  const postId = parseId(id);
  if (postId === null) notFound();

  // Session and post in parallel - they do not depend on each other. The old
  // `cache()` loader read the session internally *and* the page read it again;
  // hoisting the one read here and passing `viewerId` down removes the double
  // lookup without needing the cache at all.
  const [user, post] = await Promise.all([
    getCurrentUser(),
    getPostById({ id: postId }),
  ]);
  if (!post) notFound();

  // One canonical URL per post. The id is the real key; the username is only
  // there to make the link readable. A mismatch means the post exists but not
  // under this author, so this is a stale or hand-edited link - a 404 is the
  // honest answer, and it stops the same post being reachable under two paths.
  if (post.author.username !== username.toLowerCase()) notFound();

  const viewerId = user?.id ?? null;
  const repliesPage = await getReplies({
    parentId: post.id,
    cursor: repliesCursor,
    limit: REPLY_LIMIT,
    viewerId,
  });

  const newestReplyId = repliesPage.posts.at(-1)?.id ?? post.id;

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Post</h1>
      </header>

      <ul>
        <li>
          <PostCard
            post={post}
            signedIn={Boolean(user)}
            canDelete={user?.username === post.author.username}
          />
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

      {repliesPage.posts.length === 0 ? (
        <p className="px-4 pb-8 text-center text-sm text-muted-foreground">
          No replies yet.
        </p>
      ) : (
        <>
          <ul>
            {repliesPage.posts.map((reply) => (
              <li key={reply.id}>
                <PostCard
                  post={reply}
                  signedIn={Boolean(user)}
                  canDelete={user?.username === reply.author.username}
                />
              </li>
            ))}
          </ul>
          {repliesPage.nextCursor ? (
            <div className="p-4">
              <Link
                href={`/${post.author.username}/status/${post.id}?repliesCursor=${encodeURIComponent(repliesPage.nextCursor)}`}
                scroll={false}
                className="inline-flex w-full items-center justify-center rounded-full border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Show more replies
              </Link>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
