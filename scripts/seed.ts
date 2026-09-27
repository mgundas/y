/**
 * Deterministic seed data for local development.
 *
 *   pnpm db:seed            # wipes and reseeds all app data
 *   pnpm db:seed -- --keep  # skips the wipe, inserting alongside existing rows
 *
 * Talks to Postgres directly instead of going through `@/lib/db`, because that
 * module is marked `server-only` and throws outside a Next.js server context.
 * It builds its own short-lived client from the same env contract.
 */
import { hashPassword } from "better-auth/crypto";
import { count, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  account,
  bookmarks,
  follows,
  hashtags,
  likes,
  notifications,
  postHashtags,
  posts,
  reposts,
  session,
  user,
  verification,
  type NotificationType,
} from "../src/lib/db/schema";

const KEEP_EXISTING = process.argv.includes("--keep");

/* -------------------------------------------------------------------------- */
/* config                                                                      */
/* -------------------------------------------------------------------------- */

const USER_COUNT = 20;
const POST_COUNT = 200;
const WINDOW_MS = 72 * 3_600_000;
/** Chance a post replies to an earlier post. */
const REPLY_RATE = 0.45;
/** Chance a post quotes an earlier post. */
const QUOTE_RATE = 0.08;
/** Chance a reply or quote @-mentions someone, which drives mention notifications. */
const MENTION_RATE = 0.3;

/** Every seeded account shares this password so you can log in as anyone. */
const DEMO_PASSWORD = "password123";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

function requireUrl(): string {
  if (!url) {
    throw new Error(
      "DATABASE_URL / DATABASE_URL_DIRECT is not set. Is .env being loaded?",
    );
  }
  return url;
}

/* -------------------------------------------------------------------------- */
/* deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/** Mulberry32: reproducible runs make "the feed looks wrong" reproducible too. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20260927);
const randomInt = (min: number, max: number) =>
  Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* content pools                                                               */
/* -------------------------------------------------------------------------- */

const FIRST_NAMES = [
  "Ada", "Grace", "Alan", "Linus", "Barbara", "Ken", "Margaret", "Dennis",
  "Radia", "Vint", "Katherine", "Tim", "Anita", "Guido", "Bjarne", "James",
  "Anders", "Yukihiro", "Brendan", "Rich",
] as const;

const LAST_NAMES = [
  "Lovelace", "Hopper", "Turing", "Torvalds", "Liskov", "Thompson", "Hamilton",
  "Ritchie", "Perlman", "Cerf", "Johnson", "Berners", "Borg", "Rossum",
  "Stroustrup", "Gosling", "Hejlsberg", "Matsumoto", "Eich", "Hickey",
] as const;

const TOPICS = [
  "postgres", "drizzle", "typescript", "nextjs", "tailwind", "rust", "zig",
  "caching", "indexes", "queryplans", "a11y", "observability", "ratelimiting",
  "keyset", "fulltext", "argon2", "sessions", "streaming", "edgecache",
] as const;

const SUBJECTS = [
  "Spent the morning reading about",
  "Finally understood",
  "Strongly prefer",
  "Took far too long to debug",
  "Rewrote it and it got much better",
  "Would not ship without",
  "Keep coming back to",
  "Just learned that",
  "Cannot overstate how much I recommend",
] as const;

const PREDICATES = [
  "and it is wildly underrated.",
  "It changed how I write queries.",
  "It makes the boring parts disappear.",
  "And honestly it shows.",
  "It is the first thing I check now.",
  "It should be in the defaults.",
  "It beat every alternative I tried.",
  "It was worth the whole migration.",
  "It is the whole trick.",
  "It deserves far more attention.",
] as const;

const REPLY_OPENERS = [
  "Strongly agree, with one caveat:",
  "This matches my experience exactly.",
  "Do you have a link to the write-up?",
  "Counterpoint: the opposite holds at scale.",
  "This is the part everyone skips.",
  "Tried this last month and it held up.",
  "We do the same thing with a twist:",
  "Saving this for the next time I get stuck.",
  "Counterpoint: the ordering matters more than the index.",
  "Agreed, though the migration cost is real.",
] as const;

const QUOTE_COMMENTS = [
  "Worth reading twice.",
  "This is the correct take.",
  "Saving this one.",
  "Disagree, but respectfully.",
  "Everyone should read this.",
  "Underrated observation.",
] as const;

/* -------------------------------------------------------------------------- */
/* parsing - must stay in sync with src/lib/utils/parse-content.ts            */
/* -------------------------------------------------------------------------- */

const HASHTAG_PATTERN = /#([\p{L}\p{N}_]{1,50})/gu;
const MENTION_PATTERN = /@([a-z0-9_]{3,15})/gu;

function extractHashtags(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(HASHTAG_PATTERN)) {
    const tag = match[1]?.toLowerCase();
    if (tag) found.add(tag);
  }
  return [...found];
}

function extractMentions(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(MENTION_PATTERN)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function truncate(content: string, max = 280): string {
  return content.length <= max ? content : `${content.slice(0, max - 1)}…`;
}

/* -------------------------------------------------------------------------- */
/* seed                                                                        */
/* -------------------------------------------------------------------------- */

interface Draft {
  authorId: string;
  content: string;
  createdAt: Date;
  parentId: number | null;
  quotedPostId: number | null;
}

async function main(): Promise<void> {
  const client = postgres(requireUrl(), { max: 1, prepare: false });
  const db = drizzle(client);

  console.log("Seeding…");

  if (!KEEP_EXISTING) {
    console.log("  wiping existing data…");
    // post_hashtags first: it is the only table with two outgoing FKs.
    await db.delete(notifications);
    await db.delete(postHashtags);
    await db.delete(likes);
    await db.delete(reposts);
    await db.delete(bookmarks);
    await db.delete(follows);
    await db.delete(hashtags);
    await db.delete(posts);
    await db.delete(session);
    await db.delete(verification);
    await db.delete(account);
    await db.delete(user);
  }

  /* --- users + credential accounts ------------------------------------- */

  const now = Date.now();
  const users = Array.from({ length: USER_COUNT }, (_, i) => {
    const first = FIRST_NAMES[i % FIRST_NAMES.length] as string;
    const last = LAST_NAMES[i % LAST_NAMES.length] as string;
    const username = `${first}${last}`.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
    return {
      id: `seed_user_${String(i + 1).padStart(3, "0")}`,
      username,
      name: `${first} ${last}`,
      email: `${username}@example.com`,
      bio: `${pick(SUBJECTS)} ${pick(TOPICS)}. ${pick(PREDICATES)}`.slice(0, 160),
      createdAt: new Date(now - randomInt(30, 400) * 86_400_000),
    };
  });

  const seen = new Set<string>();
  for (const u of users) {
    if (seen.has(u.username)) {
      throw new Error(
        `Generated duplicate username "${u.username}". Widen FIRST_NAMES/LAST_NAMES.`,
      );
    }
    seen.add(u.username);
  }

  await db.insert(user).values(users);
  console.log(`  ${users.length} users`);

  // One hash reused everywhere: Argon2 is intentionally slow, and 20 hashes
  // would add seconds for zero benefit.
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db.insert(account).values(
    users.map((u) => ({
      id: `seed_account_${u.id}`,
      userId: u.id,
      accountId: u.id,
      providerId: "credential",
      password: passwordHash,
    })),
  );
  console.log(`  credential accounts (password: ${DEMO_PASSWORD})`);

  const userIds = users.map((u) => u.id);
  const userById = new Map(users.map((u) => [u.id, u]));

  /* --- posts ------------------------------------------------------------ */

  // Timestamps are strictly increasing so that "sort by created_at" has no
  // ties, which makes the draft<->row mapping below unambiguous.
  //
  // Spacing is quadratic rather than uniform: a flat spread over 72h leaves
  // the most recent 24h almost empty, which makes the Explore page and 24h
  // trending look broken during testing. This curve puts ~60% of posts inside
  // the last day while still filling the whole window.
  const drafts: Draft[] = [];
  let previousMs = now - WINDOW_MS;
  for (let i = 0; i < POST_COUNT; i += 1) {
    const t = (i + 1) / POST_COUNT;
    const computedMs = now - Math.round(WINDOW_MS * (1 - t) ** 2.2);
    // The floor keeps timestamps strictly increasing even where the curve is
    // nearly flat.
    const createdAtMs = Math.min(
      Math.max(computedMs, previousMs + 60_000),
      now - 60_000,
    );
    previousMs = createdAtMs;

    const parts = [`${pick(SUBJECTS)} ${pick(TOPICS)} ${pick(PREDICATES)}`];

    const tagCount = randomInt(0, 2);
    if (tagCount > 0) {
      const tags = new Set<string>();
      while (tags.size < tagCount) tags.add(pick(TOPICS));
      parts.push([...tags].map((t2) => `#${t2}`).join(" "));
    }

    drafts.push({
      authorId: pick(userIds),
      content: truncate(parts.join(" ")),
      createdAt: new Date(createdAtMs),
      parentId: null,
      quotedPostId: null,
    });
  }

  const inserted = await db
    .insert(posts)
    .values(
      drafts.map((d) => ({
        authorId: d.authorId,
        content: d.content,
        createdAt: d.createdAt,
        updatedAt: d.createdAt,
      })),
    )
    .returning({ id: posts.id, createdAt: posts.createdAt });

  // `inserted` is not ordered by the standard, but createdAt has no ties, so
  // sorting by it reproduces `drafts` exactly.
  const ordered = [...inserted].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  if (ordered.length !== POST_COUNT) {
    throw new Error(`Expected ${POST_COUNT} posts, got ${ordered.length}.`);
  }
  console.log(`  ${ordered.length} posts`);

  /* --- replies and quotes ------------------------------------------------ */

  // Links and rewritten text are collected first, then applied in one pass,
  // so a reply can never point at a post that does not exist yet.
  const updates: { id: number; parentId?: number; quotedPostId?: number; content?: string }[] = [];

  ordered.forEach((row, i) => {
    const draft = drafts[i];
    if (!draft) return;

    const update: (typeof updates)[number] = { id: row.id };

    if (i > 0 && random() < REPLY_RATE) {
      const parent = ordered[randomInt(0, i - 1)];
      if (parent && parent.id !== row.id) {
        update.parentId = parent.id;
        // Rewrite the body so replies do not read as duplicated root posts.
        const mention =
          random() < MENTION_RATE ? `@${pick(users).username} ` : "";
        const opener = pick(REPLY_OPENERS);
        draft.content = truncate(`${mention}${opener} ${draft.content}`);
        update.content = draft.content;
      }
    }

    if (i > 0 && random() < QUOTE_RATE) {
      const quoted = ordered[randomInt(0, i - 1)];
      if (quoted && quoted.id !== row.id) {
        update.quotedPostId = quoted.id;
        if (update.content === undefined) {
          draft.content = truncate(`${pick(QUOTE_COMMENTS)} ${draft.content}`);
          update.content = draft.content;
        }
      }
    }

    if (update.parentId !== undefined || update.quotedPostId !== undefined) {
      draft.parentId = update.parentId ?? null;
      draft.quotedPostId = update.quotedPostId ?? null;
      updates.push(update);
    }
  });

  for (const update of updates) {
    await db
      .update(posts)
      .set({
        ...(update.parentId !== undefined ? { parentId: update.parentId } : {}),
        ...(update.quotedPostId !== undefined
          ? { quotedPostId: update.quotedPostId }
          : {}),
        ...(update.content !== undefined ? { content: update.content } : {}),
      })
      .where(sql`${posts.id} = ${update.id}`);
  }

  const replyCount = updates.filter((u) => u.parentId !== undefined).length;
  const quoteCount = updates.filter((u) => u.quotedPostId !== undefined).length;
  console.log(`  ${replyCount} replies, ${quoteCount} quotes`);

  /* --- hashtags ---------------------------------------------------------- */

  const tagCounts = new Map<string, number>();
  for (const draft of drafts) {
    for (const tag of extractHashtags(draft.content)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  if (tagCounts.size > 0) {
    await db.insert(hashtags).values(
      [...tagCounts].map(([tag, postCount]) => ({ tag, postCount })),
    );
  }

  const tagIdByName = new Map(
    (await db.select({ id: hashtags.id, tag: hashtags.tag }).from(hashtags)).map(
      (r) => [r.tag, r.id] as const,
    ),
  );

  const links: { postId: number; hashtagId: number }[] = [];
  ordered.forEach((row, i) => {
    const draft = drafts[i];
    if (!draft) return;
    for (const tag of extractHashtags(draft.content)) {
      const hashtagId = tagIdByName.get(tag);
      if (hashtagId !== undefined) links.push({ postId: row.id, hashtagId });
    }
  });
  if (links.length > 0) await db.insert(postHashtags).values(links);
  console.log(`  ${tagCounts.size} hashtags, ${links.length} links`);

  /* --- follow graph ------------------------------------------------------ */

  const followRows: { followerId: string; followingId: string }[] = [];
  for (const followerId of userIds) {
    const candidates = shuffled(userIds.filter((id) => id !== followerId));
    // 3%..60% of everyone else, so every "Following" feed has content but
    // nobody follows the whole platform.
    const take = Math.max(
      1,
      Math.round(candidates.length * (0.03 + random() * 0.57)),
    );
    for (const followingId of candidates.slice(0, take)) {
      followRows.push({ followerId, followingId });
    }
  }
  await db.insert(follows).values(followRows);
  console.log(`  ${followRows.length} follows`);

  /* --- likes / reposts / bookmarks --------------------------------------- */

  const likeRows: { userId: string; postId: number }[] = [];
  const repostRows: { userId: string; postId: number }[] = [];
  const bookmarkRows: { userId: string; postId: number }[] = [];

  for (const row of ordered) {
    for (const userId of shuffled(userIds).slice(0, randomInt(0, 12))) {
      likeRows.push({ userId, postId: row.id });
    }
    for (const userId of shuffled(userIds).slice(0, randomInt(0, 3))) {
      repostRows.push({ userId, postId: row.id });
    }
    for (const userId of shuffled(userIds).slice(0, randomInt(0, 4))) {
      bookmarkRows.push({ userId, postId: row.id });
    }
  }

  await db.insert(likes).values(likeRows);
  await db.insert(reposts).values(repostRows);
  await db.insert(bookmarks).values(bookmarkRows);
  console.log(
    `  ${likeRows.length} likes, ${repostRows.length} reposts, ${bookmarkRows.length} bookmarks`,
  );

  /* --- notifications ------------------------------------------------------ */

  // Post author per id, resolved once instead of scanning `ordered` per row.
  const authorByPostId = new Map<number, string>();
  ordered.forEach((row, i) => {
    const draft = drafts[i];
    if (draft) authorByPostId.set(row.id, draft.authorId);
  });

  const notificationRows: {
    userId: string;
    actorId: string;
    type: NotificationType;
    postId: number | null;
    readAt: Date | null;
  }[] = [];

  // Likes: at most 3 per post, and never a self-notification.
  const likesByPost = new Map<number, string[]>();
  for (const like of likeRows) {
    const list = likesByPost.get(like.postId);
    if (list) list.push(like.userId);
    else likesByPost.set(like.postId, [like.userId]);
  }
  for (const row of ordered) {
    const recipientId = authorByPostId.get(row.id);
    if (!recipientId) continue;
    for (const actorId of (likesByPost.get(row.id) ?? []).slice(0, 3)) {
      if (actorId === recipientId) continue;
      notificationRows.push({
        userId: recipientId,
        actorId,
        type: "like",
        postId: row.id,
        readAt: random() < 0.5 ? new Date() : null,
      });
    }
  }

  // Replies.
  ordered.forEach((row, i) => {
    const draft = drafts[i];
    if (!draft?.parentId) return;
    const recipientId = authorByPostId.get(draft.parentId);
    if (!recipientId || recipientId === draft.authorId) return;
    notificationRows.push({
      userId: recipientId,
      actorId: draft.authorId,
      type: "reply",
      postId: row.id,
      readAt: random() < 0.5 ? new Date() : null,
    });
  });

  // Mentions, resolved from the final content so rewritten replies count.
  const userByUsername = new Map(users.map((u) => [u.username, u] as const));
  ordered.forEach((row, i) => {
    const draft = drafts[i];
    if (!draft) return;
    for (const username of extractMentions(draft.content)) {
      const mentioned = userByUsername.get(username);
      if (!mentioned || mentioned.id === draft.authorId) continue;
      notificationRows.push({
        userId: mentioned.id,
        actorId: draft.authorId,
        type: "mention",
        postId: row.id,
        readAt: random() < 0.5 ? new Date() : null,
      });
    }
  });

  // Follows: a sample, not all of them, to keep the notifications tab readable.
  for (const follow of shuffled(followRows).slice(0, 40)) {
    notificationRows.push({
      userId: follow.followingId,
      actorId: follow.followerId,
      type: "follow",
      postId: null,
      readAt: random() < 0.5 ? new Date() : null,
    });
  }

  if (notificationRows.length > 0) await db.insert(notifications).values(notificationRows);
  console.log(`  ${notificationRows.length} notifications`);

  /* --- recompute every denormalised counter ------------------------------- */

  console.log("  recomputing counters…");
  await db.execute(sql`
    UPDATE "posts" p SET
      like_count     = COALESCE((SELECT COUNT(*) FROM "likes"     l WHERE l.post_id = p.id), 0),
      repost_count   = COALESCE((SELECT COUNT(*) FROM "reposts"   r WHERE r.post_id = p.id), 0),
      bookmark_count = COALESCE((SELECT COUNT(*) FROM "bookmarks" b WHERE b.post_id = p.id), 0),
      quote_count    = COALESCE((SELECT COUNT(*) FROM "posts"     q WHERE q.quoted_post_id = p.id), 0),
      reply_count    = COALESCE((SELECT COUNT(*) FROM "posts"     c WHERE c.parent_id = p.id), 0)
  `);
  await db.execute(sql`
    UPDATE "user" u SET
      follower_count  = COALESCE((SELECT COUNT(*) FROM "follows" f WHERE f.following_id = u.id), 0),
      following_count = COALESCE((SELECT COUNT(*) FROM "follows" f WHERE f.follower_id  = u.id), 0),
      post_count      = COALESCE((SELECT COUNT(*) FROM "posts"  p WHERE p.author_id   = u.id), 0)
  `);

  /* --- summary ------------------------------------------------------------ */

  const [userTotal, postTotal, likeTotal] = await Promise.all([
    db.select({ n: count() }).from(user),
    db.select({ n: count() }).from(posts),
    db.select({ n: count() }).from(likes),
  ]);

  console.log("\nDone.");
  console.log(`  users: ${userTotal[0]?.n ?? 0}`);
  console.log(`  posts: ${postTotal[0]?.n ?? 0}`);
  console.log(`  likes: ${likeTotal[0]?.n ?? 0}`);
  console.log(`\n${userById.size} accounts, all with password "${DEMO_PASSWORD}":`);
  for (const u of users.slice(0, 3)) {
    console.log(`  ${u.email}  (@${u.username})`);
  }

  await client.end();
}

main().catch((error: unknown) => {
  console.error("\nSeed failed:", error);
  process.exitCode = 1;
});
