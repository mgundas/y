"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Bookmark, Compass, Home } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Bottom navigation for small screens.
 *
 * The left rail collapses to icons below `sm`, and the right sidebar is hidden
 * below `lg`, so a phone otherwise has no labelled navigation at all. Four
 * destinations, icon-only with screen-reader labels - the same items as the
 * rail, minus Profile, which lives behind the avatar menu.
 */
const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
] as const;

export function MobileNav({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();
  const badge = unreadCount > 99 ? "99+" : unreadCount;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 backdrop-blur sm:hidden"
    >
      <ul className="flex items-stretch justify-around">
        {items.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          const showBadge = href === "/notifications" && unreadCount > 0;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-col items-center gap-1 py-2.5 text-[11px]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active ? "font-semibold" : "text-muted-foreground",
                )}
              >
                <Icon className="size-6" aria-hidden="true" />
                <span>{label}</span>
                <span className="sr-only">
                  {showBadge
                    ? `, ${unreadCount} unread ${unreadCount === 1 ? "notification" : "notifications"}`
                    : ""}
                </span>
                {showBadge && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-[calc(50%-1.25rem)] flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground"
                  >
                    {badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
