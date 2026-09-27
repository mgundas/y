import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { decodeCursor, encodeCursor, type Cursor } from "@/lib/cursor";
import { db } from "@/lib/db";
import {
  notifications,
  posts,
  user,
  type NotificationType,
} from "@/lib/db/schema";

/**
 * Notification reads and writes.
 *
 * The write helper takes a transaction handle rather than opening its own, so a
 * notification is created in the *same* transaction as the event that caused it.
 * A like that commits while its notification is lost is worse than no
 * notification at all, because the recipient's `reply_count` and their
 * notification list would then disagree with no way to tell which is right.
 */

/** The transaction handle, derived so the driver type is not imported by name. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface NotificationInput {
  userId: string;
  actorId: string;
  type: NotificationType;
  /** Null for follows, which are not attached to a post. */
  postId: number | null;
}

/**
 * Records notifications for one event.
 *
 * Two filters, both of which matter:
 * - Nobody is notified about their own actions. A user liking their own post is
 *   already looking at it.
 * - Duplicates within a batch are dropped. Replying to someone *and* mentioning
 *   them in the same post would otherwise produce two identical rows, and
 *   `notifications` has no unique constraint to catch that.
 */
export async function notify(
  tx: Tx,
  rows: NotificationInput[],
): Promise<void> {
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (row.userId === row.actorId) return false;
    const key = `${row.userId}:${row.type}:${row.postId ?? "-"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) return;
  await tx.insert(notifications).values(unique);
}

const actorUser = alias(user, "actor_user");
const notificationPost = alias(posts, "notification_post");
const notificationPostAuthor = alias(user, "notification_post_author");

export interface NotificationItem {
  id: number;
  type: NotificationType;
  createdAt: Date;
  read: boolean;
  actor: {
    username: string;
    name: string;
    image: string | null;
  };
  /** The post the event happened on, for the preview line. */
  post: {
    id: number;
    content: string;
    authorUsername: string;
  } | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
}

function notificationKeyset(cursor: Cursor): SQL {
  return sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.t}, ${cursor.i})`;
}

/**
 * The viewer's notifications, newest first.
 *
 * `viewerId` is required - notifications are private, so there is no signed-out
 * shape to support. Both joins are on a primary key, so neither can fan out the
 * row count.
 */
export async function getNotifications({
  viewerId,
  cursor: rawCursor,
  limit,
}: {
  viewerId: string;
  cursor?: string | null;
  limit: number;
}): Promise<NotificationPage> {
  const cursor = decodeCursor(rawCursor);

  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      actorUsername: actorUser.username,
      actorName: actorUser.name,
      actorImage: actorUser.image,
      postId: notificationPost.id,
      postContent: notificationPost.content,
      postAuthorUsername: notificationPostAuthor.username,
    })
    .from(notifications)
    .innerJoin(actorUser, eq(actorUser.id, notifications.actorId))
    .leftJoin(notificationPost, eq(notificationPost.id, notifications.postId))
    .leftJoin(
      notificationPostAuthor,
      eq(notificationPostAuthor.id, notificationPost.authorId),
    )
    .where(
      and(
        eq(notifications.userId, viewerId),
        cursor ? notificationKeyset(cursor) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      read: row.readAt !== null,
      actor: {
        username: row.actorUsername,
        name: row.actorName,
        image: row.actorImage,
      },
      post:
        row.postId !== null &&
        row.postContent !== null &&
        row.postAuthorUsername !== null
          ? {
              id: row.postId,
              content: row.postContent,
              authorUsername: row.postAuthorUsername,
            }
          : null,
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ t: last.createdAt.toISOString(), i: last.id })
        : null,
  };
}

/**
 * Unread count for the nav badge.
 *
 * One indexed count off the partial `notifications_unread_idx`, so it stays
 * cheap as the table grows. Returns 0 signed out rather than querying with a
 * sentinel, because there is no "unread" state for a user who does not exist.
 */
export async function getUnreadNotificationCount(
  viewerId: string | null,
): Promise<number> {
  if (!viewerId) return 0;

  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, viewerId), isNull(notifications.readAt)),
    );

  return row?.n ?? 0;
}

/** Marks the viewer's unread notifications as read. */
export async function markAllRead(viewerId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(eq(notifications.userId, viewerId), isNull(notifications.readAt)),
    )
    .returning({ id: notifications.id });

  return rows.length;
}
