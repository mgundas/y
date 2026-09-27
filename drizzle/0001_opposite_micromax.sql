-- Realign `rate_limit` with what @better-auth/core expects.
--
-- drizzle-kit's generated version was wrong twice over: it tried to add a
-- second primary key to a table that already had one, and it added `id` as
-- NOT NULL with no default, which fails on any table that already has rows.
--
-- `id` is absent from better-auth's table spec, but `diffSchema` in
-- dist/db/schema-diff.mjs checks `table.idColumn ?? "id"` and the adapter
-- writes a generated id on create, so the column must exist.
-- `key` stays the thing the rate limiter upserts on and must be UNIQUE; that
-- uniqueness is how two concurrent first requests are reconciled.
ALTER TABLE "rate_limit" DROP CONSTRAINT IF EXISTS "rate_limit_pkey";--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN IF NOT EXISTS "id" text;--> statement-breakpoint
-- Defensive backfill so this migration is safe on a non-empty table.
UPDATE "rate_limit" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "rate_limit" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "rate_limit" DROP CONSTRAINT IF EXISTS "rate_limit_key_unique";--> statement-breakpoint
ALTER TABLE "rate_limit" ADD CONSTRAINT "rate_limit_key_unique" UNIQUE ("key");
