import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * drizzle-orm 0.45.x has no built-in `tsvector` column, so declare one.
 * The driver hands back Postgres' text rendering of the vector, which is fine:
 * the value is only ever consumed by `@@ websearch_to_tsquery(...)` in SQL,
 * never read into application code.
 */
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/* -------------------------------------------------------------------------- */
/* Better Auth core tables                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Field names here MUST match what better-auth looks up, because its Drizzle
 * adapter resolves columns by TypeScript key (camelCase) while the DSN column
 * is whatever we name it (snake_case).
 * Verified against better-auth@1.7.6 dist/db/schema/{user,session,account,verification}.mjs
 *
 * `username` is NOT a Better Auth core field. It is registered in Phase 2 via
 * `user.additionalFields`, and lives here so a unique index still enforces
 * uniqueness even if a write bypasses the auth layer.
 */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    /** Always stored lowercase, which makes the unique index case-insensitive. */
    username: text("username").notNull().unique(),
    /** Display name; keeps the casing the user typed. */
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    /** Email verification is out of scope, so rows land here as false. */
    emailVerified: boolean("email_verified").default(false).notNull(),
    /** Avatar URL. Reuses Better Auth's built-in field. */
    image: text("image"),
    bannerUrl: text("banner_url"),
    bio: text("bio"),

    // Denormalised counters, updated in the same transaction as the join-row
    // write. scripts/recount.ts repairs drift.
    followerCount: integer("follower_count").default(0).notNull(),
    followingCount: integer("following_count").default(0).notNull(),
    postCount: integer("post_count").default(0).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Prefix search for the "find people" box.
    index("user_username_lower_idx").on(sql`lower(${t.username})`),
    index("user_name_lower_idx").on(sql`lower(${t.name})`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Better Auth sets this to the user's own id for provider "credential". */
    accountId: text("account_id").notNull(),
    /** "credential" for email + password. */
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    /** Argon2id hash from better-auth's `hashPassword`. */
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/**
 * Backs Better Auth's endpoint rate limiting when
 * `rateLimit: { storage: "database" }` is configured. In-memory storage is
 * wiped on every cold start, which is useless on serverless.
 *
 * Shape is dictated by `@better-auth/core` `get-tables.mjs`, not by taste:
 *  - `id` is not in the table spec, but `diffSchema` checks
 *    `table.idColumn ?? "id"` and the adapter writes a generated id, so the
 *    column has to exist. Verified in `dist/db/schema-diff.mjs`.
 *  - `key` must be UNIQUE, not the primary key. `dist/api/rate-limiter/index.mjs`
 *    relies on a unique violation to resolve two concurrent first requests;
 *    that path needs a separate PK to collide against.
 *  - `lastRequest` is epoch milliseconds as a number. The rate limiter
 *    normalises `bigint` on read, so either mode works; `number` is chosen
 *    because `Date.now()` exceeds nothing in JS's safe-integer range.
 */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* posts                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * bigserial rather than uuid: it is monotonic and cheap, which matters for the
 * keyset pagination cursor where `id` is the deterministic tiebreaker for
 * identical `created_at` values.
 */
export const posts = pgTable(
  "posts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Plain text, max 280 chars. Never rendered as HTML. */
    content: text("content").notNull(),
    /** Non-null when this post is a reply. */
    parentId: bigint("parent_id", { mode: "number" }).references(
      (): AnyPgColumn => posts.id,
      { onDelete: "cascade" },
    ),
    /** Non-null when this post quotes another. */
    quotedPostId: bigint("quoted_post_id", { mode: "number" }).references(
      (): AnyPgColumn => posts.id,
      { onDelete: "set null" },
    ),
    /**
     * Postgres full-text vector, maintained by the database. Referenced
     * unqualified so it resolves to this table's own `content` column.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', content)`,
    ),

    likeCount: integer("like_count").default(0).notNull(),
    repostCount: integer("repost_count").default(0).notNull(),
    replyCount: integer("reply_count").default(0).notNull(),
    bookmarkCount: integer("bookmark_count").default(0).notNull(),
    quoteCount: integer("quote_count").default(0).notNull(),

    /**
     * `precision: 3` is load-bearing, not cosmetic.
     *
     * This column is half of the keyset sort key `(created_at, id)`, and the
     * cursor round-trips it through a JS `Date`, which has millisecond
     * resolution. Postgres `timestamptz` defaults to microseconds, so a
     * `defaultNow()` value carries sub-millisecond digits that
     * `toISOString()` silently truncates. The decoded cursor is then *earlier*
     * than the row it came from, and any sibling row sharing that millisecond
     * fails `(created_at, id) < (t, i)` on the time component alone - so
     * paging silently skips rows. Two rows written in one transaction are the
     * reliable way to hit it, because `now()` is identical for every row in a
     * transaction.
     *
     * Millisecond precision makes the stored value and the encoded value the
     * same number, which is what makes the row-value comparison exact.
     */
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    // Author timeline (Posts tab on a profile).
    index("posts_author_created_idx").on(
      t.authorId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // "For you" feed.
    index("posts_created_idx").on(t.createdAt.desc(), t.id.desc()),
    // Reply thread listing. Matches `getReplies`' `ORDER BY created_at DESC,
    // id DESC` exactly so Postgres walks the index instead of sorting; the
    // old `(parent_id, created_at ASC)` shape could not serve that order.
    index("posts_parent_created_idx").on(
      t.parentId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index("posts_quoted_post_id_idx").on(t.quotedPostId),
    index("posts_search_vector_idx").using("gin", t.searchVector),
  ],
);

/** Up to 4 images per post, ordered by `position`. The cap is enforced in Zod. */
export const postImages = pgTable(
  "post_images",
  {
    id: serial("id").primaryKey(),
    postId: bigint("post_id", { mode: "number" })
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    altText: text("alt_text"),
    width: integer("width"),
    height: integer("height"),
    position: smallint("position").default(0).notNull(),
  },
  (t) => [
    index("post_images_post_id_idx").on(t.postId),
    // One image per slot: a duplicate position would render two images in the
    // same place, so the uniqueness is structural, not cosmetic.
    unique("post_images_post_position_unique").on(t.postId, t.position),
    check("post_images_position_range", sql`${t.position} between 0 and 3`),
  ],
);

/* -------------------------------------------------------------------------- */
/* social edges                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Composite primary keys make every "toggle" idempotent: a duplicate insert
 * raises a unique violation instead of silently double-counting, so optimistic
 * UI that fires twice cannot inflate a counter.
 */
export const likes = pgTable(
  "likes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: bigint("post_id", { mode: "number" })
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    // Counter rollups and "who liked this" both filter by post.
    index("likes_post_id_idx").on(t.postId),
    index("likes_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const reposts = pgTable(
  "reposts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: bigint("post_id", { mode: "number" })
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index("reposts_post_id_idx").on(t.postId),
    index("reposts_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postId: bigint("post_id", { mode: "number" })
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index("bookmarks_post_id_idx").on(t.postId),
    index("bookmarks_user_created_idx").on(t.userId, t.createdAt.desc()),
  ],
);

export const follows = pgTable(
  "follows",
  {
    followerId: text("follower_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    followingId: text("following_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followingId] }),
    // The PK already covers lookups by follower. This covers "who follows X"
    // and the follower counter.
    index("follows_following_id_idx").on(t.followingId),
    index("follows_following_created_idx").on(t.followingId, t.createdAt.desc()),
    check("follows_no_self_follow", sql`${t.followerId} <> ${t.followingId}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* blocks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One-way blocks. The composite PK makes block/unblock an idempotent toggle,
 * exactly like the engagement edges.
 *
 * Semantics, kept deliberately narrow:
 * - Blocking removes follows in both directions (same transaction).
 * - Blocked content is excluded from feeds, search, timelines, and profiles.
 * - A blocked user cannot follow the blocker back; the follow action rejects.
 * What it is NOT: likes and replies on already-visible posts are not
 * retroactively policed. Enforcement covers discovery and follows, which is
 * where harassment scales; per-row policing of old content is out of scope.
 */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    // "Who blocked X" lookups and the exclusion joins filter by blocked user.
    index("blocks_blocked_id_idx").on(t.blockedId),
    check("blocks_no_self_block", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/* -------------------------------------------------------------------------- */
/* hashtags                                                                    */
/* -------------------------------------------------------------------------- */

export const hashtags = pgTable(
  "hashtags",
  {
    id: serial("id").primaryKey(),
    /** Lowercased, no leading "#". Max 50 chars, enforced in Zod. */
    tag: text("tag").notNull().unique(),
    postCount: integer("post_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("hashtags_post_count_idx").on(t.postCount.desc())],
);

export const postHashtags = pgTable(
  "post_hashtags",
  {
    postId: bigint("post_id", { mode: "number" })
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    hashtagId: integer("hashtag_id")
      .notNull()
      .references(() => hashtags.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.hashtagId] }),
    // Hashtag pages and the 24h trending query both filter by hashtag.
    index("post_hashtags_hashtag_id_idx").on(t.hashtagId),
  ],
);

/* -------------------------------------------------------------------------- */
/* notifications                                                               */
/* -------------------------------------------------------------------------- */

export const notificationType = pgEnum("notification_type", [
  "like",
  "repost",
  "reply",
  "follow",
  "mention",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Who receives it. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Who caused it. Never equals `userId` - self-actions are skipped. */
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    /** Null for follows, which are not attached to a post. */
    postId: bigint("post_id", { mode: "number" }).references(() => posts.id, {
      onDelete: "cascade",
    }),
    /** NULL means unread. */
    readAt: timestamp("read_at", { withTimezone: true }),
    /**
     * `precision: 3` for the same reason as `posts.createdAt` - this is the
     * other half of a `(created_at, id)` keyset cursor, and one transaction
     * writing a `reply` and a `mention` for the same post stamps both with an
     * identical `now()`. Without millisecond precision, paging that list skips
     * one of them.
     */
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Notification list, newest first, keyset paginated.
    index("notifications_user_created_idx").on(
      t.userId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // Unread badge count. Partial, so it stays small as the table grows.
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
    /**
     * Cross-request duplicate guard. `notify()` dedupes within one batch, but
     * two requests racing (a double-clicked like is two transactions) would
     * each pass the in-memory filter and insert the same row. The insert uses
     * `onConflictDoNothing`, so the loser is dropped instead.
     *
     * `NULLS NOT DISTINCT` is applied in the migration by hand (drizzle-kit
     * has no spelling for it): follow notifications carry a NULL `post_id`,
     * and without it two NULLs never conflict, so the constraint would only
     * protect post-attached types. Do not "simplify" the migration back to a
     * plain UNIQUE - it silently re-opens the follow race.
     *
     * Deliberate tradeoff: re-engaging after undoing (like, unlike, like)
     * finds the first row still present and does not create a second one.
     * Collapsing repeat engagements into one notification is the product
     * behavior being chosen here, not an oversight.
     */
    unique("notifications_dedup_unique").on(
      t.userId,
      t.type,
      t.postId,
      t.actorId,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* relations                                                                   */
/* -------------------------------------------------------------------------- */

export const userRelations = relations(user, ({ many }) => ({
  posts: many(posts),
  sessions: many(session),
  accounts: many(account),
  // Paired with the relationName on follows.follower / follows.following.
  followers: many(follows, { relationName: "followsFollowing" }),
  following: many(follows, { relationName: "followsFollower" }),
  likes: many(likes),
  reposts: many(reposts),
  bookmarks: many(bookmarks),
  notifications: many(notifications, { relationName: "notificationsRecipient" }),
  actedNotifications: many(notifications, { relationName: "notificationsActor" }),
  blockedUsers: many(blocks, { relationName: "blocksBlocker" }),
  blockedBy: many(blocks, { relationName: "blocksBlocked" }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const postRelations = relations(posts, ({ one, many }) => ({
  author: one(user, { fields: [posts.authorId], references: [user.id] }),
  parent: one(posts, {
    fields: [posts.parentId],
    references: [posts.id],
    relationName: "postReplies",
  }),
  replies: many(posts, { relationName: "postReplies" }),
  quotedPost: one(posts, {
    fields: [posts.quotedPostId],
    references: [posts.id],
    relationName: "postQuotes",
  }),
  quotes: many(posts, { relationName: "postQuotes" }),
  images: many(postImages),
  likes: many(likes),
  reposts: many(reposts),
  bookmarks: many(bookmarks),
  hashtags: many(postHashtags),
  notifications: many(notifications),
}));

export const postImagesRelations = relations(postImages, ({ one }) => ({
  post: one(posts, { fields: [postImages.postId], references: [posts.id] }),
}));

export const likesRelations = relations(likes, ({ one }) => ({
  user: one(user, { fields: [likes.userId], references: [user.id] }),
  post: one(posts, { fields: [likes.postId], references: [posts.id] }),
}));

export const repostsRelations = relations(reposts, ({ one }) => ({
  user: one(user, { fields: [reposts.userId], references: [user.id] }),
  post: one(posts, { fields: [reposts.postId], references: [posts.id] }),
}));

export const bookmarksRelations = relations(bookmarks, ({ one }) => ({
  user: one(user, { fields: [bookmarks.userId], references: [user.id] }),
  post: one(posts, { fields: [bookmarks.postId], references: [posts.id] }),
}));

export const blocksRelations = relations(blocks, ({ one }) => ({
  blocker: one(user, {
    fields: [blocks.blockerId],
    references: [user.id],
    relationName: "blocksBlocker",
  }),
  blocked: one(user, {
    fields: [blocks.blockedId],
    references: [user.id],
    relationName: "blocksBlocked",
  }),
}));

export const followsRelations = relations(follows, ({ one }) => ({
  follower: one(user, {
    fields: [follows.followerId],
    references: [user.id],
    relationName: "followsFollower",
  }),
  following: one(user, {
    fields: [follows.followingId],
    references: [user.id],
    relationName: "followsFollowing",
  }),
}));

export const hashtagsRelations = relations(hashtags, ({ many }) => ({
  posts: many(postHashtags),
}));

export const postHashtagsRelations = relations(postHashtags, ({ one }) => ({
  post: one(posts, { fields: [postHashtags.postId], references: [posts.id] }),
  hashtag: one(hashtags, {
    fields: [postHashtags.hashtagId],
    references: [hashtags.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(user, {
    fields: [notifications.userId],
    references: [user.id],
    relationName: "notificationsRecipient",
  }),
  actor: one(user, {
    fields: [notifications.actorId],
    references: [user.id],
    relationName: "notificationsActor",
  }),
  post: one(posts, { fields: [notifications.postId], references: [posts.id] }),
}));

/* -------------------------------------------------------------------------- */
/* inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type PostImage = typeof postImages.$inferSelect;
export type NewPostImage = typeof postImages.$inferInsert;
export type Like = typeof likes.$inferSelect;
export type Repost = typeof reposts.$inferSelect;
export type Bookmark = typeof bookmarks.$inferSelect;
export type Follow = typeof follows.$inferSelect;
export type Hashtag = typeof hashtags.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationType = (typeof notificationType.enumValues)[number];
