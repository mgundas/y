import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Composer } from "@/components/feed/composer";
import { PostCard } from "@/components/post/post-card";
import { requireSession } from "@/lib/auth/session";
import { getPostById } from "@/lib/db/queries/feed";

export const metadata: Metadata = { title: "Quote" };

/**
 * Quote composer for one post.
 *
 * Reuses `Composer` with `quotedPostId`: a quote is a new post that references
 * another, so it posts through the same `createPostAction`. Protected - only
 * signed-in users can quote, and the action re-checks anyway.
 */
export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();

  if (!/^[0-9]{1,15}$/.test(id)) notFound();
  const postId = Number(id);
  if (!Number.isSafeInteger(postId) || postId <= 0) notFound();

  const post = await getPostById({ id: postId, viewerId: session.user.id });
  if (!post) notFound();

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Quote</h1>
      </header>

      <Composer
        key={`quote-${post.id}`}
        user={{
          name: session.user.name,
          username: session.user.username,
          image: session.user.image ?? null,
        }}
        quotedPostId={post.id}
        quotingUsername={post.author.username}
        placeholder="Add a comment"
        submitLabel="Quote"
      />

      <ul>
        <li>
          <PostCard post={post} signedIn />
        </li>
      </ul>
    </div>
  );
}
