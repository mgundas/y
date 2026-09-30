<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project

Y-style app. Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4 + shadcn/ui, Drizzle + Postgres (Neon), Better Auth, Zod 4, pnpm. No `any` types.

## Commands

```bash
pnpm dev            # dev server
pnpm verify         # typecheck -> lint -> build. Run this before reporting done.
pnpm typecheck      # tsc --noEmit
pnpm lint           # bare `eslint`; Next 16 REMOVED `next lint`
pnpm build
pnpm db:generate    # drizzle-kit generate  (after editing schema.ts)
pnpm db:migrate     # drizzle-kit migrate   (uses DATABASE_URL_DIRECT)
pnpm db:seed        # wipes + reseeds; -- --keep to skip the wipe
pnpm db:recount     # repair denormalized counters
pnpm db:studio
```

`pnpm verify` is ordered on purpose: a type error in a RSC can surface as a confusing build error, so fix types before chasing the build.

`pnpm typecheck` also depends on generated Next types, so it only passes on a warm `.next`. After `rm -rf .next`, run `pnpm build` once before `pnpm verify`, or `tsc` reports `Cannot find name 'LayoutProps'`. A stale `.next/dev/types/validator.ts` can also still reference a route you just deleted, which shows up as `Cannot find module '.../route.js'`.

### Tooling rules

- **Every tool call gets an explicit `timeout`.** Never rely on a default. A call with no timeout can hang on a stuck dev server, a held lock, or a prompt, and the session blocks instead of continuing. 120s is a fine floor; `pnpm verify` and `pnpm build` need 600-900s, database scripts 120-300s.
- **Never run a long-lived process in the foreground.** Start the dev server backgrounded with `Start-Process` plus a redirect to a log file; otherwise it occupies the tool slot for the rest of the session. Stop it by PID when finished and delete the log.
- **Poll, don't block.** For a dev server, `Start-Sleep` a fixed few seconds and then make the request, rather than sitting in a loop waiting on the log file.
- **Filter long output.** `pnpm verify` and `curl` against a Next page produce megabytes. Pipe through `Select-String` for the line you care about, and write HTML to a file instead of returning it inline.
- **If a call returns nothing useful, change the approach immediately** rather than re-running the same command with a bigger timeout. Repeating a call that already hung is the exact failure this rule exists to prevent.

## Environment

`.env` is gitignored and must never be committed. `.env.example` is the tracked contract — add new vars to both.

- `DATABASE_URL` — **pooled** Neon endpoint (has `-pooler.` in the host). Used at runtime.
- `DATABASE_URL_DIRECT` — **direct** endpoint, no `-pooler.`. Required by `db:migrate` and `db:seed`, because the pooler is transaction-mode and that breaks DDL and session state. **It is currently a copy of the pooled URL and must be replaced with the real direct connection string.**
- `BETTER_AUTH_SECRET` — regenerating it logs everyone out.

`src/lib/env.ts` validates with Zod and throws at import time, so `next build` fails loudly if `.env` is missing. It is deliberately *not* marked `server-only`; the guard lives on `@/lib/db` and `@/lib/auth/server` instead.

## Database gotchas

- **`prepare: false` in the postgres client is mandatory**, not leftover config. `DATABASE_URL` points at Neon's transaction-mode pooler, which is incompatible with server-side prepared statements. Removing it produces intermittent errors under concurrency.
- **`scripts/*.ts` cannot import `@/lib/db`.** That module is marked `server-only`, which throws outside a Next server context. Scripts build their own short-lived `postgres` client from the same env contract.
- **tsx treats `.ts` as CJS here** (no `"type": "module"` in package.json), so top-level `await` fails. Wrap in an `async main()`.
- `pnpm-workspace.yaml` gates postinstall scripts via `allowBuilds`. `esbuild` must stay enabled or `tsx` breaks; `sharp` is needed for `next/image` in production.
- Local disk uploads (`public/uploads`) do **not** work on serverless hosts. Phase 7 only; move to object storage before deploying.

## Schema invariants

Everything lives in one file, `src/lib/db/schema.ts`, because the tables are densely cross-referenced. Changing it means running `pnpm db:generate`.

- **Better Auth field names are load-bearing.** Its Drizzle adapter looks columns up by *TypeScript key* (camelCase), so the DB column is whatever we name it. Verified against `better-auth@1.7.6` `dist/db/schema/{user,session,account,verification}.mjs` — re-check that source before renaming anything.
- **`username` is not a Better Auth core field.** It is a column on `user` registered through `user.additionalFields` in Phase 2. Stored lowercase, so the unique index is case-insensitive.
- **`posts` self-references need `((): AnyPgColumn => posts.id)`** in both `parentId` and `quotedPostId`. A bare `() => posts.id` is a circular type and fails with TS7022/TS7024.
- **`tsvector` is a local `customType`** because drizzle-orm 0.45.3 ships no built-in one. The column is `GENERATED ALWAYS AS to_tsvector('english', content) STORED` with a GIN index. Search it with `websearch_to_tsquery` so arbitrary input cannot break the query grammar. Never read the value into app code; it is only ever consumed inside SQL.
- **Composite PKs on `likes` / `reposts` / `bookmarks` / `follows` make every toggle idempotent.** A duplicate insert raises a unique violation instead of double-counting, which is what lets optimistic UI safely fire twice.
- **Counters are denormalized** (`like_count`, `reply_count`, `follower_count`, …). They must be updated inside the *same transaction* as the join-row write. If a count ever looks wrong, `pnpm db:recount` recomputes everything from the join tables — that is the intended repair path, so prefer it over hand-patching rows.
- `follows` has `CHECK (follower_id <> following_id)`; `post_images.position` has `CHECK (between 0 and 3)`. The 4-image cap itself is enforced in Zod, not the DB.

## Conventions

- Server Components for reads, Server Actions for mutations, Zod on the server for every input. Never trust the client.
- Post text is plain text. Render `@mention` / `#hashtag` / URLs by parsing into React segments — no `dangerouslySetInnerHTML`.
- Every mutation re-checks authorization server-side; the UI hiding a button is not a guard.
- Pagination is keyset, never offset. Order is `created_at DESC, id DESC` and the cursor is a base64url `{t, i}` pair fed into a row-value comparison `(created_at, id) < (t, i)`. `id` is a `bigserial` precisely so it is a deterministic tiebreaker.
- `pnpm db:seed` is deterministic (mulberry32, fixed seed). A feed that looks broken reproduces, so re-run and compare instead of guessing.

## Build status

Phase 1 complete: project setup, Tailwind v4 + shadcn, Drizzle config, full schema, first migration applied to Neon, seed + recount scripts.

Phase 2 complete: Better Auth (email/password, DB-backed rate limiting), session DAL, auth Server Actions, `(auth)` and `(main)` route groups, three-column shell. `pnpm verify` clean and the sign-up → sign-in → sign-out round trip verified against Neon.

Phase 3 complete: keyset-paginated feed, post composer, hashtags, a post detail page with replies, plain-text segment rendering. `pnpm verify` clean; the full 200-post pagination walk verified with zero duplicates and strict ordering, and posts created through the action (root, reply, quote) left zero counter drift.

Phase 4 complete: likes, reposts, bookmarks, and a real `/bookmarks` page. `pnpm verify` clean; toggles verified for correctness, double-fire idempotence, signed-out rejection, and unknown-`kind` rejection, and every engagement counter is recomputed rather than incremented, so drift is not reachable.

Phase 5 complete: profiles - banner, identity, bio, join date, follower/following counts, and Posts / Replies / Likes tabs, plus follow/unfollow. `pnpm verify` clean; follow verified for self-follow, signed-out, unknown-user, and toggle correctness with both counters recomputed.

Phase 6 complete: notifications - reply/mention/like/repost/follow creation wired into the existing actions, a keyset-paginated `/notifications` page, mark-all-read, and an unread badge in the nav. `pnpm verify` clean. Two real bugs found and fixed on the way, both in AGENTS.md below: an early `return` that silently skipped notifications, and a keyset cursor that lost sub-millisecond precision.

Phase 7 complete (review batch): a full codebase review produced ~30 findings and all were implemented. Search (`?q=` over posts + people), explore with 24h trending and `/explore/hashtag/[tag]` timelines, quote creation UI (`/quote/[id]`), owner-only post deletion with in-transaction counter repair, `/settings/profile` (name/username/bio/avatar/banner + password change), blocks (toggle, follow removal, feed/profile exclusion), per-user mutation rate limits, `?type=` notification filter, route states (`loading`/`error`/`not-found`), per-post OG metadata, media read side (`post_images` rendered), mobile bottom nav, and a sweep of correctness fixes below. `pnpm verify` clean; every flow re-verified against Neon with zero counter drift.

Not yet built: dark-mode toggle, uploads (media is read-side only; `public/uploads` does not work on serverless hosts), DMs, email verification / password reset via email. Do not assume any feature exists because its table does.

### Engagement notes

- **Counters are recomputed, not incremented.** Each toggle ends with `update posts set like_count = (select count(*) from likes where ...) returning like_count`. Incrementing is the usual approach and it is the only way this schema drifts - every crash, retry, or lost update between the two statements leaves the counter permanently wrong, fixable only by `db:recount`. One statement cannot disagree with the rows it counts, and the `returning` clause is both the write and the authoritative read-back the action returns to the client.
- **Toggle order is delete-then-insert.** The delete's `returning` is what says "was active". If it removed nothing, the insert runs with `on conflict do nothing`, so a double-fire is a no-op rather than a double count. The action is therefore safe to call optimistically and repeatedly.
- **`kind` is validated with `z.enum`, and that is load-bearing.** The per-kind `switch` in `toggleEngagementAction` has no `default` branch, so an unrecognised value falls through it and the action 500s on `result.active`. A client-sent value reaching an unvalidated `switch` on a server action is a 500, not a rejection. Phase 6 replaced that `switch` with a nested ternary over the same validated `kind`, so the `z.enum` now protects the query *and* the notification `type` column rather than just the `switch`.
- **The optimistic value is never persisted.** `useOptimistic` guesses so the button reacts in the same frame as the click; when the transition ends React drops it and falls back to props, which `router.refresh()` re-fetches. The server is the only thing that decides the final state, and a raced or failed toggle visibly reverts instead of lying. Nothing is `disabled` while pending - idempotence plus recomputation means two clicks correctly mean "back to where you started".
- **Signed-out is a redirect on the client and a rejection on the server.** The three buttons still render signed out and `router.push("/sign-in")` on click, because hiding them only moves the affordance elsewhere. `getCurrentUser()` returning null is the real guard; the client check is a courtesy.
- **`signedIn` is threaded down, not inferred.** A signed-out viewer and a signed-in viewer who has liked nothing both produce three `false` viewer flags, so the flags cannot answer the question. It is passed page -> `FeedList` -> `PostCard` -> `PostActions`.
- **`/bookmarks` is ordered by post recency, not bookmark time.** That keeps the keyset cursor on `(posts.created_at, posts.id)` and lets the page reuse `selectFeed`. The tradeoff is real: bookmarking an old post does not float it to the top of your own bookmarks. Reversing it means a second cursor shape and a query that is not `selectFeed`, which is a deliberate Phase 5+ decision, not an oversight.

### Profile notes

- **A Likes tab is only rendered on your own profile**, and `?tab=likes` on anyone else's silently falls back to Posts instead of 404ing. Liking is not private in the schema, but surfacing one account's likes through another's profile is a privacy bug that is much cheaper to never build than to remove later.
- **The tab is a URL, not client state.** `?tab=replies` makes a tab shareable and back-button-correct, and it is why `FeedList` grew a `query` prop: without carrying `tab` across a page change, paging deep into Replies and clicking "Load more" would silently land on Posts, because the cursor and the tab are independent.
- **Tab counts come from one grouped query**, not a COUNT per tab, so the strip cannot disagree with the page under it. `user.postCount` is deliberately *not* used for the Posts count - it counts replies too.
- **Self-follow is rejected in the action, not just by the CHECK.** `follows` has `CHECK (follower_id <> following_id)` so the database would refuse it anyway, but rejecting it in Zod means the user gets a sentence instead of a generic failure. The follow button is hidden on your own profile for the same reason, and the hidden button is the readable version, not the guard.
- **Both follow counters are recomputed, not adjusted.** `follower_count` is derived from `follows.following_id = user.id` and `following_count` from `follows.follower_id = user.id`, in the same transaction as the join-row write, via two `update ... returning` statements. The `returning` clause is the authoritative read-back.
- **Profile lookups are case-insensitive** (`lower(username) = lower($1)`), because usernames are stored lowercase but URLs are not, and a 404 on a re-cased link is a bad first impression.

### Notification notes

- **The `if (tags.length === 0) return;` early return in `createPostAction` silently skipped notifications.** It was a Phase 3 optimisation for the hashtag block, and the notification code was appended *after* it. So a hashtag-less reply or mention - the common case - produced no notification, while a hashtagged one worked. A 200-post feed walk never caught it because the feed does not notify. The rule: inside a transaction callback, an early `return` is only safe if nothing after it is required work. Notification creation now sits *above* the hashtag early return, and the comment there says so.
- **`created_at` is `timestamp(3)`, and that precision is load-bearing.** `posts.created_at` and `notifications.created_at` are half of a `(created_at, id)` keyset sort key, and the cursor round-trips through a JS `Date` - millisecond resolution. Postgres `timestamptz` defaults to *micro*seconds, so `defaultNow()` values carried sub-millisecond digits that `toISOString()` truncated. The decoded cursor was then earlier than the row it came from, and a sibling row sharing that millisecond failed `(created_at, id) < (t, i)` on the time component alone, so **paging silently skipped rows**. It surfaced on `/notifications` because one transaction writing a `reply` and a `mention` for the same post stamps both with an identical `now()`; the feed has the identical latent bug, and its 200-post walk missed it only because seeded timestamps are spread out. Fixed by `drizzle/0002_quiet_red_skull.sql`. Do not "restore the default precision" - it looks like a cleanup and reintroduces a silent data-loss bug.
- **`notify()` takes the transaction handle, it does not open its own.** A like that commits while its notification is lost is worse than no notification, because `reply_count` and the recipient's list then disagree with no way to tell which is right.
- **Only the activating half of a toggle notifies.** Notifying on both halves would make a single like/unlike pair produce two rows. Self-actions are filtered inside `notify` (`userId === actorId`) rather than at each call site, so the rule holds even for a call path that forgets to check.
- **A reply *and* a mention of the same person are two notifications, not one.** `notify` de-duplicates on `(userId, type, postId, actorId)`, so the different `type` survives. Since Phase 7 the in-memory filter is backed by `notifications_dedup_unique` with `NULLS NOT DISTINCT` (drizzle-kit has no spelling for it - the migration is hand-edited, do not "simplify" it back to plain UNIQUE or follow races reopen) plus `onConflictDoNothing`, so a double-clicked toggle cannot twin rows. Deliberate tradeoff: re-engaging after undoing finds the first row still present and does not create a second one.
- **`getNotifications` takes a non-nullable `viewerId`.** Notifications are private, so there is no signed-out shape; the signature makes a signed-out render impossible rather than falling back to a sentinel that might match a real row.
- **Unread is `read_at is null`, with a partial index on it.** The nav badge is one indexed `count(*)`, not a page of rows, and it is passed down from the `(main)` layout rather than re-fetched inside the `"use client"` nav - otherwise the badge becomes a second source of truth for the same number.
- **Quotes create no notification.** The enum has no `quote` value and the quoted author sees it in `quote_count`; adding one is a schema change, not an action change.
- **`db.select` returns a Result proxy, not an Array.** `.find`/`.filter`/`.map` throw or misbehave on it - spread it first. This cost two probe iterations.

### Feed and composer notes

- **The action's `prevState` parameter is load-bearing.** `createPostAction(_prevState, formData)` must be called through `useActionState`, because that is what lets React bind the state for a no-JavaScript form post and re-render the returned errors. Driving it from `useTransition` instead shifts `FormData` into `prevState` and throws `Cannot read properties of undefined (reading 'get')`.
- **The composer is keyed on the newest post id, not reset in an effect.** The home page renders `<Composer key={page.posts[0]?.id}>`; the detail page keys on the newest reply id. A successful post revalidates and changes that id, so the component remounts empty; a rejected one leaves the feed alone and the typed text survives. Clearing via `useEffect` on the action state is now a lint error (`set-state-in-effect`).
- **One query shape for signed in and signed out.** `selectFeed` in `src/lib/db/queries/feed.ts` joins the three viewer edges against `viewerId ?? ""`. `""` is never a real `user.id`, so signed out yields NULL on every edge and the planner sees one plan instead of two. Each edge join is on the `(post_id, user_id)` primary key, so none can fan out the row count.
- **The detail page reuses `selectFeed`, it does not get its own query.** `getPostById` and `getReplies` both call it and both map through the same `toFeedPost`, so the card cannot render differently depending on which page it is on. Since Phase 7 `selectFeed` takes a direction: replies walk oldest-first (`>` with `ASC`) under `?repliesCursor=`, because page one of a thread is its start. The cursor cannot collide with anything since the detail page is addressed by id.
- **Fetch `limit + 1` rows**; the extra row is the only "is there a next page?" signal. Avoids a second COUNT and the off-by-one when a page comes back exactly full. The "Load more" link carries `limit` forward explicitly - dropping it would silently snap the next page back to the default size.
- **`tokenizePost` in `src/lib/text.ts` is the single source of truth** for what a hashtag or mention is - the renderer and the indexing side effects both read from it, so they cannot disagree about which `#foo` counts. Trailing punctuation is stripped from URLs, except a closing paren the URL itself opened (Wikipedia-style titles).
- **Hashtags link to `/explore/hashtag/[tag]`.** The tag in the URL is validated with `hashtagSchema` (lowercase, restricted alphabet), so a hand-edited tag 404s instead of reaching Postgres raw. The composer copy ("linked automatically") is true again because of this.
- **The detail URL is `/{username}/status/{id}` and the id is the real key.** The username is there to make the link readable, so a username that disagrees with the post's author is a 404 rather than a second canonical path. `id` is parsed with a regex plus `Number.isSafeInteger` before it reaches Postgres.
- **A cursor is untrusted input.** `decodeCursor` returns `null` for anything malformed so a stale bookmark shows page one instead of a 500; `clampPageSize` caps `?limit=` so it cannot be used to ask for the whole table.
- **Server action ids are content hashes.** They change whenever the action file or anything it imports is edited, so a hand-built `$ACTION_ID_` payload 500s with "Failed to find Server Action" afterwards. Read `.next/dev/server/app/<route>/server-reference-manifest.json` if you need the current one; note that `__`-prefixed route folders are private in App Router and are silently not routed. Testing an action end-to-end is easier with a temporary `POST` route that imports and calls it - just do not name that folder with a leading underscore.

### Auth notes

- **`src/proxy.ts` is an optimistic pre-filter, not a guard.** It redirects when the session cookie is absent. Pages that need a user call `requireSession()` from `@/lib/auth/session`, which re-reads the session from the database. A request that skips Proxy is still rejected there, so never treat the redirect as the authorization check.
- **`username` is `required: true` in `additionalFields`.** That is deliberate: it matches the NOT NULL column and keeps `session.user.username` non-nullable in the type. Setting it to `false` compiles but makes every username access nullable.
- **`rate_limit` has an `id` column that better-auth never documents.** Its table spec lists only `key`/`count`/`lastRequest`, but `diffSchema` checks `table.idColumn ?? "id"` and the adapter writes a generated id, so the column must exist or better-auth logs a schema mismatch and throws on validated requests. `key` must additionally be UNIQUE, because `dist/api/rate-limiter/index.mjs` reconciles two concurrent first requests by catching a unique violation - that needs a separate primary key to collide against. `drizzle/0001_opposite_micromax.sql` is hand-written for this reason; drizzle-kit's generated version tried to add a second primary key to a table that already had one.
- **`lastRequest` is epoch milliseconds as a number.** The rate limiter normalises `bigint` on read, so either Drizzle mode works.
- **Unique-violation errors are nested.** Drizzle wraps the postgres.js error in a `DrizzleQueryError` and better-auth may wrap that again, so the `23505` is at the bottom of a `cause` chain. `findUniqueViolation` in `src/lib/actions/auth.ts` walks it; checking `error.code` alone silently misses the racing-duplicate case the unique index exists for.
- **`callbackUrl` is consumed and validated.** `SignInPage` reads `?callbackUrl=` into a hidden field and `safeCallbackUrl` in `actions/auth.ts` allowlists same-origin paths (leading single `/`, no `//`, backslashes, or newlines) before `redirect()`. Anything else falls back to `/`. Validate before redirecting, or it is an open redirect.
- **Sign-up no longer names the taken field.** Pre-check and `23505` backstop both return "An account with those details already exists." Naming username-vs-email lets unauthenticated callers enumerate registrations.
- **`bio` is `input: false`.** The sign-up action only forwards email/password/name/username; bio is edited later via the authenticated settings action. `input: true` would let a direct API call smuggle one past that.

### Block notes

- **Blocks are one-way and narrow.** `toggleBlockAction` removes follows in both directions and recomputes all four counters in the same transaction, creates no notification (telling someone they were blocked is a harassment vector with extra steps), and rejects self-blocks in the action rather than relying on the CHECK. Enforcement covers discovery and follows: `excludeBlocked` in `feed.ts` hides both directions from every list query, the profile page renders a notice instead of tabs, and follow/reply attempts fail with the same sentence as a missing account so neither side's block state leaks. Likes on already-visible posts are deliberately not policed.
- **Blocked-profile sentences differ by direction.** "You blocked @x" (with Unblock in the header) vs "@x has blocked you" (no controls). The header still renders identity; only the timeline hides.

### Mutation notes

- **Every mutation is rate-limited per user** via `checkMutationRateLimit` in `src/lib/ratelimit.ts`, sharing the `rate_limit` table under `mutation:{userId}:{scope}` keys. Races fail open (one extra write, not a hole) - correctness guards never fail open. Budgets are generous (20 posts/10min, 200 engagements/min, 50 follows or blocks/hour); tune by abuse observed, not by guessing.
- **Mentions are capped at 10 per post** (`MENTION_MAX` in `text.ts`, enforced in the action). Without it one post fans out to ~18 notification rows and mention-spam is nearly free.
- **In-transaction existence checks replaced every pre-check.** `postExists()` before the write was a TOCTOU gap (delete between check and insert = FK 500). The lookups now happen inside `db.transaction` and throw `*ValidationError` subclasses that the catch maps to sentences; anything else keeps the generic message. "Already gone" and "broken" must never share an error path.
- **All counters are recomputed, including the ones Phase 3 incremented.** `createPostAction` (`user.post_count`, `reply_count`, `quote_count`, hashtag `post_count`), `deletePostAction` (same set, plus tag repair from edges captured *before* the delete, since the cascade erases them), and block's four follow counters all use subselects in-transaction. `db:recount` verified zero drift across all ten counters after the batch.
- **`markAllRead` is one CTE returning a count**, not `RETURNING id` on an unbounded update. A large inbox would otherwise lock rows and ship every id back just to count them.
- **Deletion is owner-only via the affected-row count.** The delete's `where` includes the author id, so zero rows means "not yours or not there", deliberately indistinguishable. Notifications/likes/reposts/bookmarks cascade; surviving counters are recomputed.
- **Bookmark counts are zeroed signed out.** Liking is not private in the schema but bookmarks are treated as such in product; the card no longer leaks how many people saved a post to readers with no account.
- **The post `switch` is gone from engagement; the reply index now matches the query.** `posts_parent_created_idx` is `(parent_id, created_at DESC, id DESC)` to serve `getReplies`' ordering; `post_images` has `UNIQUE(post_id, position)` instead of a redundant plain index. Migration `drizzle/0003_premium_nomad.sql`.
- **Seed bulk inserts use `onConflictDoNothing`.** Fresh wipes never conflict, so this changes nothing there; it only stops `--keep` reruns from dying on composite PKs and unique tags.

### Product notes (Phase 7)

- **Search is two halves.** People (username-prefix, capped at 5, unpaginated - a complete answer) above posts (`searchPosts` + `FeedList` with `query={{q}}` so "Load more" keeps the term). The sidebar form posts to `/search` unchanged.
- **Explore counts from join rows, not `hashtags.post_count`.** The denormalized counter is all-time with no time dimension; the 24h window needs `post_hashtags` joined to `posts.created_at`. Sidebar shows top 3, page shows top 10.
- **Quote creation is a page, not a modal.** `/quote/[id]` reuses `Composer` with `quotedPostId`; the action row gained a Quote link with `quoteCount`. Quotes create no notification (enum unchanged - schema decision, not oversight).
- **Settings owns the `/settings` prefix** that `proxy.ts` has listed since Phase 2 with no page behind it. Profile form (uncontrolled, `defaultValue`, server re-render remounts) and password form (via `auth.api.changePassword`, vague failure message) are separate actions so one's errors never wipe the other's draft. Username renames are one column update - every join uses `user.id`, only URLs embed the name.
- **Route states exist now.** `(main)/loading.tsx` (post-card-shaped skeletons, since navigations are full-page loads), `(main)/error.tsx` (retry via `reset()`), root `not-found.tsx`. Unknown routes and bad ids render the not-found page; note it arrives with status 200 even on untouched routes (framework behavior in this setup, not app logic - do not "fix" it in app code).
- **Layout carries real metadata now** (`metadataBase`, OG site name, twitter card, `themeColor`) and detail pages unfurl with author + 160-char description. Center column is `max-w-2xl`; nav labels break at `sm` (the old `xl` left a wide empty rail on tablets); phones get `MobileNav` (bottom bar, same four destinations minus Profile) with `pb-16` compensation on `main`.
- **The mounted `<Toaster/>` finally has callers.** Toggle, follow, block, delete, and mark-read failures `toast.error()` with the server's sentence instead of silently reverting. A revert the user cannot distinguish from a dead button is a bug report waiting to happen.
- **A11y fixes:** composer countdown speaks via a polite live region only when <= 20 remaining (the ticking number stays `aria-hidden`); sign-in gained the sign-up form's `FieldError` pattern; sign-up's `aria-describedby` appends the error id; notification previews are `next/link` with the full text as the accessible name.
- **Waterfalls were audited, not blindly parallelized.** Profile parallelizes counts + tab content (both need the profile, neither needs the other). Home stays sequential with a comment saying why: the feed query genuinely needs the viewer id for its edges, and fetching twice to fake parallelism costs a whole query to save one session lookup.
- **Stale `.next/dev/types/validator.ts` references deleted routes.** After removing a temporary probe route, `pnpm verify` fails on the ghost reference; `pnpm build` alone also fails its type-check on it. Fix is deleting `.next/dev` only (not all of `.next`, which triggers the `LayoutProps` cold-start issue) and rebuilding.
- **The home feed is private; everything else is public.** Signed-out visitors to `/` get a landing page (sign-in + sign-up doors), not posts and not a bare redirect - `/` stays out of proxy's protected list precisely so the landing can render. Profiles, detail pages, search, and explore remain browsable signed out; gating those is a product decision, not a leftover.
