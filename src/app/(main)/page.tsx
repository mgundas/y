import type { Metadata } from "next";

import { Composer } from "@/components/feed/composer";
import { FeedList } from "@/components/feed/feed-list";
import { getCurrentUser } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import { getFeedPosts } from "@/lib/db/queries/feed";

export const metadata: Metadata = { title: "Home" };

/**
 * `/` is public - the feed is browsable signed out, and only the composer
 * requires an account. The page reads the session itself rather than trusting
 * `src/proxy.ts`, which only optimistically checks for the cookie's presence.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; limit?: string }>;
}) {
  const { cursor, limit: rawLimit } = await searchParams;
  const limit = clampPageSize(rawLimit);

  // Sequential on purpose: the feed query needs the viewer id for its
  // like/repost/bookmark edges, so it genuinely depends on the session.
  // Fetching the feed twice (once anonymous, once as the viewer) to fake
  // parallelism would cost a whole second query to save one session lookup.
  const user = await getCurrentUser();
  const page = await getFeedPosts({
    cursor,
    limit,
    viewerId: user?.id ?? null,
  });

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Home</h1>
      </header>

      {user ? (
        // Keyed on the newest post so a successful submission remounts the
        // composer and clears the textarea, while a rejected one leaves the text
        // intact. Deriving it from the feed means the reset is driven by the
        // server, not by a client effect guessing when the action finished.
        <Composer
          key={page.posts[0]?.id ?? "empty"}
          user={{
            name: user.name,
            username: user.username,
            image: user.image ?? null,
          }}
        />
      ) : null}

      <FeedList
        page={page}
        limit={limit}
        signedIn={Boolean(user)}
        viewerUsername={user?.username ?? null}
        emptyMessage={
          user
            ? "No posts yet. Write the first one."
            : "No posts yet. Sign up to write the first one."
        }
      />
    </div>
  );
}
