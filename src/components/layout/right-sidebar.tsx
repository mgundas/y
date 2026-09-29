import Link from "next/link";
import { Bird, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getTrendingHashtags } from "@/lib/db/queries/feed";
import { formatCount } from "@/lib/text";

/** Search field plus live trending. An async Server Component - no client JS. */
export async function RightSidebar() {
  const trending = await getTrendingHashtags(3);
  return (
    <aside
      aria-label="Search and trends"
      className={cn(
        "sticky top-0 flex h-dvh flex-col gap-4 overflow-y-auto py-4",
        // Hidden on small screens; Phase 8 gives mobile its own treatment.
        "hidden lg:flex",
      )}
    >
      <form action="/search" role="search" className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          name="q"
          placeholder="Search"
          aria-label="Search"
          className="rounded-full bg-muted pl-10"
        />
      </form>

      <section
        aria-labelledby="trending-heading"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <h2 id="trending-heading" className="px-4 py-3 text-lg font-bold">
          Trending now
        </h2>
        {trending.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            Nothing trending yet.
          </p>
        ) : (
          <ul className="pb-2">
            {trending.map((row) => (
              <li key={row.tag}>
                <Link
                  href={`/explore/hashtag/${row.tag}`}
                  className="block px-4 py-2 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <p className="text-sm font-semibold">#{row.tag}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatCount(row.postCount24h)}{" "}
                    {row.postCount24h === 1 ? "post" : "posts"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Plain text, not links: there are no Terms/Privacy pages, and
        link-styled spans that go nowhere are a dead end wearing a costume.
        When those pages exist, these become Links.
      */}
      <p className="flex flex-wrap gap-x-4 gap-y-1 px-4 text-xs text-muted-foreground">
        <span>y © 2026</span>
        <Link href="/explore" className="hover:underline">
          Explore
        </Link>
      </p>
    </aside>
  );
}

export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-full p-3 text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Bird className="size-7" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">y</span>
    </Link>
  );
}
