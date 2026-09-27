import type { Metadata } from "next";

import { FeedList } from "@/components/feed/feed-list";
import { requireSession } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import { getBookmarkedPosts } from "@/lib/db/queries/feed";

export const metadata: Metadata = { title: "Bookmarks" };

/**
 * Protected. See the note in `notifications/page.tsx` about the two checks.
 *
 * `requireSession` returns the session, so the page uses its `id` directly as the
 * viewer rather than paying for a second `getCurrentUser()` call.
 */
export default async function BookmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; limit?: string }>;
}) {
  const { cursor, limit: rawLimit } = await searchParams;
  const limit = clampPageSize(rawLimit);

  const session = await requireSession();

  const page = await getBookmarkedPosts({
    viewerId: session.user.id,
    cursor,
    limit,
  });

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Bookmarks</h1>
      </header>

      <FeedList
        page={page}
        limit={limit}
        signedIn
        basePath="/bookmarks"
        emptyMessage="Bookmark a post and it will show up here."
      />
    </div>
  );
}
