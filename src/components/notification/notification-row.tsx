import Link from "next/link";
import {
  AtSign,
  Heart,
  MessageCircle,
  Repeat2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { NotificationItem } from "@/lib/db/queries/notifications";
import { formatRelativeTime } from "@/lib/text";

/**
 * One notification row: who did what, and the post it happened on.
 *
 * Rendered on the server. The only interactive part of this page is the
 * "Mark all as read" button, so nothing here needs to be a client component.
 */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ""}${(parts[1] as string)[0] ?? ""}`.toUpperCase();
}

/**
 * The sentence and the icon for each type.
 *
 * Typed off the schema enum rather than written out as string literals, so
 * adding a value to `notification_type` is a compile error here instead of a
 * row that renders "something happened".
 */
const COPY: Record<
  NotificationItem["type"],
  { verb: string; Icon: LucideIcon; className: string }
> = {
  like: { verb: "liked your post", Icon: Heart, className: "text-rose-500" },
  repost: {
    verb: "reposted your post",
    Icon: Repeat2,
    className: "text-emerald-600",
  },
  reply: {
    verb: "replied to your post",
    Icon: MessageCircle,
    className: "text-sky-500",
  },
  mention: {
    verb: "mentioned you",
    Icon: AtSign,
    className: "text-violet-500",
  },
  follow: {
    verb: "followed you",
    Icon: UserPlus,
    className: "text-amber-500",
  },
};

export function NotificationRow({ item }: { item: NotificationItem }) {
  const { verb, Icon, className: iconClass } = COPY[item.type];
  const iso = item.createdAt.toISOString();

  return (
    <li
      // Unread rows are tinted rather than badged, so the list stays readable
      // and the nav badge remains the only place a number is shown.
      className={item.read
        ? "border-b border-border"
        : "border-b border-border bg-primary/5"}
    >
      <div className="flex gap-3 px-4 py-4">
        <div className="w-8 shrink-0 pt-1">
          <Icon className={`size-5 ${iconClass}`} aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1 text-sm">
            <Avatar size="sm">
              <AvatarImage src={item.actor.image ?? undefined} alt="" />
              <AvatarFallback>{initials(item.actor.name)}</AvatarFallback>
            </Avatar>
            <span className="sr-only">Notification from </span>
            <span className="font-semibold hover:underline">
              {item.actor.name}
            </span>
            <span className="text-muted-foreground">@{item.actor.username}</span>
            <span className="text-muted-foreground">{verb}</span>
            {/* Server-rendered, so this is relative to render time and ages
                from there. Fine for a list nobody watches for a week. */}
            <time
              dateTime={iso}
              className="text-muted-foreground"
              title={new Date(iso).toLocaleString()}
            >
              {formatRelativeTime(iso)}
            </time>
            {!item.read && <span className="sr-only">(unread)</span>}
          </p>

          {item.post && (
            // `Link`, not `<a>`: a full reload on every notification tap would
            // throw away the client router state for no reason. The accessible
            // name is the full post text, since the truncated preview is what
            // sighted users see but not what is announced.
            <Link
              href={`/${item.post.authorUsername}/status/${item.post.id}`}
              aria-label={item.post.content}
              className="mt-1 block truncate text-sm text-muted-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {item.post.content}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
