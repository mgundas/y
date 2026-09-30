import type { Metadata } from "next";
import Link from "next/link";
import { Bird } from "lucide-react";

import { Composer } from "@/components/feed/composer";
import { FeedList } from "@/components/feed/feed-list";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import { getFeedPosts } from "@/lib/db/queries/feed";

export const metadata: Metadata = { title: "Home" };

/**
 * `/` is private - the feed requires an account. A signed-out visitor gets a
 * landing page with both doors (sign in and sign up) instead of posts, and
 * instead of a bare redirect that would hide where the account links live.
 *
 * The page reads the session itself rather than trusting `src/proxy.ts`,
 * which only optimistically checks for the cookie's presence. `/` is
 * deliberately *not* in proxy's protected list: protecting it there would
 * bounce signed-out visitors to `/sign-in` before this landing could render.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; limit?: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex min-h-[80dvh] flex-col items-center justify-center gap-6 px-4 py-16 text-center">
        <Link
          href="/"
          aria-label="y home"
          className="flex items-center gap-2 text-3xl font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Bird className="size-9" aria-hidden="true" />
          <span>y</span>
        </Link>
        <div className="flex flex-col gap-2">
          <p className="text-2xl font-bold">See what&apos;s happening.</p>
          <p className="text-sm text-muted-foreground">
            Sign in or create an account to read the feed.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button asChild className="w-full rounded-full">
            <Link href="/sign-up">Create account</Link>
          </Button>
          <Button asChild variant="outline" className="w-full rounded-full">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { cursor, limit: rawLimit } = await searchParams;
  const limit = clampPageSize(rawLimit);

  // Sequential on purpose: the feed query needs the viewer id for its
  // like/repost/bookmark edges, so it genuinely depends on the session.
  // Fetching the feed twice (once anonymous, once as the viewer) to fake
  // parallelism would cost a whole second query to save one session lookup.
  const page = await getFeedPosts({
    cursor,
    limit,
    viewerId: user.id,
  });

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Home</h1>
      </header>

      {/*
        Keyed on the newest post so a successful submission remounts the
        composer and clears the textarea, while a rejected one leaves the text
        intact. Deriving it from the feed means the reset is driven by the
        server, not by a client effect guessing when the action finished.
      */}
      <Composer
        key={page.posts[0]?.id ?? "empty"}
        user={{
          name: user.name,
          username: user.username,
          image: user.image ?? null,
        }}
      />

      <FeedList
        page={page}
        limit={limit}
        signedIn
        viewerUsername={user.username}
        emptyMessage="No posts yet. Write the first one."
      />
    </div>
  );
}
