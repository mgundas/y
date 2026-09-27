import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Profile tabs.
 *
 * Ordinary links, not client state. The active tab is therefore a real,
 * shareable, back-button-correct URL, and the tab survives a reload exactly the
 * way a route should. Switching tabs drops the cursor, so a reader who pages
 * deep into Posts and then opens Replies starts that list from the top instead
 * of inheriting a cursor that means nothing in the new query.
 */
export function ProfileTabs({
  username,
  active,
  counts,
}: {
  username: string;
  active: ProfileTab;
  /** `null` hides a tab entirely rather than rendering it empty. */
  counts: { posts: number; replies: number; likes: number | null };
}) {
  const tabs: { key: ProfileTab; label: string; count: number | null }[] = [
    { key: "posts", label: "Posts", count: counts.posts },
    { key: "replies", label: "Replies", count: counts.replies },
    { key: "likes", label: "Likes", count: counts.likes },
  ];

  return (
    <div className="flex border-b border-border">
      {tabs.map((tab) => {
        if (tab.count === null) return null;
        const isActive = tab.key === active;

        return (
          <Link
            key={tab.key}
            href={`/${username}?tab=${tab.key}`}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex-1 border-b-2 px-4 py-3 text-center text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/40",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

export type ProfileTab = "posts" | "replies" | "likes";
