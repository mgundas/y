import type { Metadata } from "next";
import Link from "next/link";

import { FeedList } from "@/components/feed/feed-list";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getCurrentUser } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import {
  searchPosts,
  searchUsers,
} from "@/lib/db/queries/feed";

export const metadata: Metadata = {
  title: "Search",
  description: "Search posts and people on Y.",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ""}${(parts[1] as string)[0] ?? ""}`.toUpperCase();
}

/**
 * Search, in two halves: people first, then posts.
 *
 * People match by username prefix, then display name; posts match full-text
 * (`websearch_to_tsquery`, so arbitrary input cannot break the query grammar).
 * Only the posts half is paginated - people results are capped at five, which
 * is a complete answer rather than a page of one.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; limit?: string }>;
}) {
  const { q, cursor, limit: rawLimit } = await searchParams;
  const query = q?.trim() ?? "";
  const limit = clampPageSize(rawLimit);

  const user = await getCurrentUser();
  const viewerId = user?.id ?? null;

  const [people, page] = query
    ? await Promise.all([
        searchUsers({ query, limit: 5 }),
        searchPosts({ query, cursor, limit, viewerId }),
      ])
    : [[], null] as const;

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Search</h1>
      </header>

      {!query ? (
        <p className="px-4 py-10 text-sm text-muted-foreground">
          Search users and posts.
        </p>
      ) : (
        <>
          {people.length > 0 ? (
            <section aria-label="People">
              <h2 className="px-4 pt-4 pb-1 text-sm font-semibold text-muted-foreground">
                People
              </h2>
              <ul>
                {people.map((person) => (
                  <li key={person.id} className="border-b border-border">
                    <Link
                      href={`/${person.username}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <Avatar className="size-10 shrink-0">
                        {person.image ? (
                          <AvatarImage src={person.image} alt="" />
                        ) : null}
                        <AvatarFallback>
                          {initials(person.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {person.name}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          @{person.username}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <h2 className="px-4 pt-4 pb-1 text-sm font-semibold text-muted-foreground">
            Posts
          </h2>
          {page ? (
            <FeedList
              page={page}
              limit={limit}
              signedIn={Boolean(user)}
              viewerUsername={user?.username ?? null}
              basePath="/search"
              query={{ q: query }}
              emptyMessage={`No posts matching "${query}".`}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
