import type { Metadata } from "next";
import Link from "next/link";

import { MarkAllReadButton } from "@/components/notification/mark-all-read-button";
import { NotificationRow } from "@/components/notification/notification-row";
import { requireSession } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import {
  getNotifications,
  getUnreadNotificationCount,
} from "@/lib/db/queries/notifications";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

const FILTERS = [
  { value: null, label: "All" },
  { value: "reply", label: "Replies" },
  { value: "mention", label: "Mentions" },
  { value: "like", label: "Likes" },
  { value: "repost", label: "Reposts" },
  { value: "follow", label: "Follows" },
] as const;

/**
 * Protected route. Two independent checks:
 *  - `src/proxy.ts` redirects when the session cookie is absent (optimistic).
 *  - `requireSession()` re-reads the session from the database (authoritative).
 * The second one is the one that matters; a request that skips Proxy is still
 * rejected here.
 *
 * Notifications are private, so there is no signed-out shape. `getNotifications`
 * takes a non-nullable `viewerId` precisely so a signed-out render cannot
 * compile into a query with a sentinel that might match a real row.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; limit?: string; type?: string }>;
}) {
  const { cursor, limit: rawLimit, type: rawType } = await searchParams;
  const limit = clampPageSize(rawLimit);

  const session = await requireSession();
  const viewerId = session.user.id;

  const [page, unread] = await Promise.all([
    // Unknown `?type=` values fall through to unfiltered inside the query,
    // and the strip below highlights nothing - a bad URL shows everything
    // rather than an empty list.
    getNotifications({ viewerId, cursor, limit, type: rawType }),
    getUnreadNotificationCount(viewerId),
  ]);

  const activeType = FILTERS.some((filter) => filter.value === rawType)
    ? rawType
    : null;

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Notifications</h1>
        {/*
          `disabled` is passed in rather than read from a client store, so the
          button is absent from the server HTML when there is nothing unread and
          cannot be shown stale.
        */}
        <MarkAllReadButton disabled={unread === 0} />
      </header>

      <nav
        aria-label="Filter notifications"
        className="flex gap-1 overflow-x-auto border-b border-border px-4 py-2"
      >
        {FILTERS.map((filter) => {
          const active = activeType === filter.value;
          const href =
            filter.value === null
              ? "/notifications"
              : `/notifications?type=${filter.value}`;
          return (
            <Link
              key={filter.label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-sm transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                active
                  ? "bg-foreground font-semibold text-background"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {page.items.length === 0 ? (
        <p className="px-4 py-10 text-sm text-muted-foreground">
          {cursor
            ? "No older notifications."
            : "Nothing yet. Likes, reposts, replies, mentions, and new followers show up here."}
        </p>
      ) : (
        <ul aria-label="Notifications">
          {page.items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {page.nextCursor && (
        <div className="p-4">
          {/*
            A plain link, not a button. Paging is a navigation, and a link is
            shareable and works without JS. `limit` is carried forward
            explicitly - dropping it would silently snap the next page back to
            the default size.
          */}
          <a
            href={`/notifications?cursor=${encodeURIComponent(
              page.nextCursor,
            )}&limit=${limit}${activeType ? `&type=${activeType}` : ""}`}
            className="text-sm text-muted-foreground hover:underline"
          >
            Show more
          </a>
        </div>
      )}
    </div>
  );
}
