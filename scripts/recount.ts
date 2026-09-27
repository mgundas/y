/**
 * Repairs the denormalised counters from the join tables.
 *
 * Counters are updated inside the same transaction as each join-row write, so
 * they should never drift. They can, though: a transaction that inserts a
 * `likes` row and increments `posts.like_count` will still commit both, but a
 * manual `DELETE`, a restored database dump, or a partial failure in some
 * future code path can leave them inconsistent. Run this when counts look wrong.
 *
 *   pnpm db:recount
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

function requireUrl(): string {
  if (!url) {
    throw new Error(
      "DATABASE_URL / DATABASE_URL_DIRECT is not set. Is .env being loaded?",
    );
  }
  return url;
}

async function main(): Promise<void> {
  const client = postgres(requireUrl(), { max: 1, prepare: false });
  const db = drizzle(client);

  console.log("Recounting…");

  const posts = await db.execute(sql`
    UPDATE "posts" p SET
      like_count     = COALESCE((SELECT COUNT(*) FROM "likes"     l WHERE l.post_id = p.id), 0),
      repost_count   = COALESCE((SELECT COUNT(*) FROM "reposts"   r WHERE r.post_id = p.id), 0),
      bookmark_count = COALESCE((SELECT COUNT(*) FROM "bookmarks" b WHERE b.post_id = p.id), 0),
      quote_count    = COALESCE((SELECT COUNT(*) FROM "posts"     q WHERE q.quoted_post_id = p.id), 0),
      reply_count    = COALESCE((SELECT COUNT(*) FROM "posts"     c WHERE c.parent_id = p.id), 0)
    RETURNING p.id
  `);

  const users = await db.execute(sql`
    UPDATE "user" u SET
      follower_count  = COALESCE((SELECT COUNT(*) FROM "follows" f WHERE f.following_id = u.id), 0),
      following_count = COALESCE((SELECT COUNT(*) FROM "follows" f WHERE f.follower_id  = u.id), 0),
      post_count      = COALESCE((SELECT COUNT(*) FROM "posts"  p WHERE p.author_id   = u.id), 0)
    RETURNING u.id
  `);

  const tags = await db.execute(sql`
    UPDATE "hashtags" h SET
      post_count = COALESCE((SELECT COUNT(*) FROM "post_hashtags" ph WHERE ph.hashtag_id = h.id), 0)
    RETURNING h.id
  `);

  console.log(`  ${posts.length} posts recounted`);
  console.log(`  ${users.length} users recounted`);
  console.log(`  ${tags.length} hashtags recounted`);

  await client.end();
}

main().catch((error: unknown) => {
  console.error("\nRecount failed:", error);
  process.exitCode = 1;
});
