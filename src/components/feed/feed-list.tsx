import Link from "next/link";

import { PostCard } from "@/components/post/post-card";
import type { FeedPage } from "@/lib/db/queries/feed";

/**
 * A page of posts plus a "Load more" link.
 *
 * The cursor is carried in the query string rather than in component state, so
 * a page is a real URL: bookmarkable, shareable, and back-button-correct. It
 * replaces the whole list on navigation instead of appending, which is why each
 * page is independently renderable.
 */
export function FeedList({
  page,
  emptyMessage,
  limit,
  signedIn = false,
  viewerUsername = null,
  basePath = "/",
  query = {},
}: {
  page: FeedPage;
  emptyMessage: string;
  limit: number;
  signedIn?: boolean;
  /**
   * Decides per-card delete affordance (`canDelete`), computed here - in the
   * server render - rather than in the client, so the button's presence never
   * depends on client state. The action re-checks authorship regardless.
   */
  viewerUsername?: string | null;
  /** The route this list lives on, so "Load more" stays on it. */
  basePath?: string;
  /**
   * Extra query values to carry across a page change - a profile's `tab`, for
   * instance. Without this, paging off a Replies tab would land on Posts,
   * because the tab is only in the URL the reader arrived on.
   */
  query?: Record<string, string>;
}) {
  if (page.posts.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  // One timestamp for the whole page. Computing it per card would make two posts
  // created seconds apart straddle a "1m"/"2m" boundary within a single render.
  const now = new Date();

  // `limit` is carried forward explicitly. Dropping it would silently snap the
  // next page back to the default size, so a reader who started at ?limit=50
  // would get 20 with no visible cause. `cursor` and `limit` are written last so
  // they always win over anything in `query`.
  const nextParams = new URLSearchParams(query);
  nextParams.set("cursor", page.nextCursor ?? "");
  nextParams.set("limit", String(limit));

  return (
    <div>
      <ul>
        {page.posts.map((post) => (
          <li key={post.id}>
            <PostCard
              post={post}
              now={now}
              signedIn={signedIn}
              canDelete={
                viewerUsername !== null &&
                viewerUsername === post.author.username
              }
            />
          </li>
        ))}
      </ul>

      {page.nextCursor ? (
        <div className="p-4">
          <Link
            href={`${basePath}?${nextParams}`}
            scroll={false}
            className="inline-flex w-full items-center justify-center rounded-full border border-border px-4 py-3 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Load more
          </Link>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          You&apos;re all caught up.
        </p>
      )}
    </div>
  );
}
