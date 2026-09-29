import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FeedList } from "@/components/feed/feed-list";
import { getCurrentUser } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import { getPostsByHashtag } from "@/lib/db/queries/feed";
import { hashtagSchema } from "@/lib/validation/post";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tag: string }>;
}): Promise<Metadata> {
  const { tag } = await params;
  return {
    title: `#${tag}`,
    description: `Posts tagged #${tag} on Y.`,
  };
}

/**
 * One hashtag's timeline, newest first.
 *
 * The tag is validated, not trusted: the schema lowercases and restricts the
 * alphabet, so `/explore/hashtag/../..` and mixed-case variants degrade to the
 * canonical lookup or a 404 instead of reaching Postgres raw.
 */
export default async function HashtagPage({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ cursor?: string; limit?: string }>;
}) {
  const { tag: rawTag } = await params;
  const { cursor, limit: rawLimit } = await searchParams;

  const parsed = hashtagSchema.safeParse(decodeURIComponent(rawTag));
  if (!parsed.success) notFound();
  const tag = parsed.data;

  const limit = clampPageSize(rawLimit);
  const user = await getCurrentUser();

  const page = await getPostsByHashtag({
    tag,
    cursor,
    limit,
    viewerId: user?.id ?? null,
  });

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">#{tag}</h1>
      </header>

      <FeedList
        page={page}
        limit={limit}
        signedIn={Boolean(user)}
        viewerUsername={user?.username ?? null}
        basePath={`/explore/hashtag/${tag}`}
        emptyMessage={`No posts tagged #${tag} yet.`}
      />
    </div>
  );
}
