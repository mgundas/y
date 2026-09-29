import type { Metadata } from "next";
import Link from "next/link";

import { getTrendingHashtags } from "@/lib/db/queries/feed";
import { formatCount } from "@/lib/text";

export const metadata: Metadata = {
  title: "Explore",
  description: "Trending hashtags on Y.",
};

/**
 * Trending hashtags from the last 24 hours, counted from the join rows (not
 * the all-time denormalized counter, which has no time dimension). Each links
 * to its timeline; an empty list means nobody tagged anything today, not that
 * the feature is missing.
 */
/** Public - trending is the same for everyone, so no session is read. */
export default async function ExplorePage() {
  const trending = await getTrendingHashtags(10);

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Explore</h1>
      </header>

      {trending.length === 0 ? (
        <p className="px-4 py-10 text-sm text-muted-foreground">
          Nothing trending in the last 24 hours. Tag a post to start one.
        </p>
      ) : (
        <ul>
          {trending.map((row) => (
            <li key={row.tag} className="border-b border-border">
              <Link
                href={`/explore/hashtag/${row.tag}`}
                className="block px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <p className="font-semibold">#{row.tag}</p>
                <p className="text-sm text-muted-foreground">
                  {formatCount(row.postCount24h)}{" "}
                  {row.postCount24h === 1 ? "post" : "posts"} in the last 24
                  hours
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
