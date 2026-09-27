"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Bookmark,
  Compass,
  Home,
  User as UserIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
] as const;

function isActive(pathname: string, href: string) {
  // "/" must match exactly or it would light up on every route.
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * `unreadCount` is passed down from the layout, which is a server component and
 * already reading the session. Fetching it here instead would mean a second
 * session read inside a `"use client"` module, and the badge would be a second
 * source of truth for the same number.
 *
 * The count is `0` signed out - the query short-circuits rather than looking for
 * a user who does not exist.
 */
export function NavLinks({ unreadCount = 0 }: { unreadCount?: number }) {
  const pathname = usePathname();
  const badge = unreadCount > 99 ? "99+" : unreadCount;

  return (
    <nav aria-label="Primary">
      <ul className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const showBadge = href === "/notifications" && unreadCount > 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-4 rounded-full px-4 py-3 text-lg transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "font-bold"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <span className="relative shrink-0">
                  <Icon className="size-6" aria-hidden="true" />
                  {showBadge && (
                    <span
                      // Numeric content in a badge needs a label, otherwise it
                      // is announced as a bare number with no context.
                      aria-label={`${unreadCount} unread ${
                        unreadCount === 1 ? "notification" : "notifications"
                      }`}
                      className="absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground"
                    >
                      {badge}
                    </span>
                  )}
                </span>
                <span className="hidden xl:inline">{label}</span>
                <span className="sr-only xl:hidden">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ProfileLink({ username }: { username: string | null }) {
  const pathname = usePathname();
  const href = username ? `/${username}` : "/sign-up";
  const active = username !== null && pathname === href;

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-4 rounded-full px-4 py-3 text-lg transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "font-bold"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <UserIcon className="size-6 shrink-0" aria-hidden="true" />
      <span className="hidden xl:inline">Profile</span>
      <span className="sr-only xl:hidden">Profile</span>
    </Link>
  );
}
