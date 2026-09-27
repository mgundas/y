# y

A Y-style social app. Next.js 16 (App Router), React 19, TypeScript strict,
Tailwind v4 + shadcn/ui, Drizzle ORM + Neon Postgres, Better Auth, Zod, pnpm.

> Full setup and deployment docs land in Phase 8. This is the working quickstart.

## Setup

```bash
pnpm install
cp .env.example .env      # then fill it in — see below
pnpm db:migrate           # apply migrations
pnpm db:seed              # 20 users, 200 posts, follows/likes/replies
pnpm dev
```

`.env` is gitignored. Never commit it.

### Environment variables

| Variable | Required by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | dev, build, runtime | Neon **pooled** endpoint (`-pooler.` in the host) |
| `DATABASE_URL_DIRECT` | `db:migrate`, `db:seed` | Neon **direct** endpoint, no `-pooler.` |
| `BETTER_AUTH_SECRET` | dev, build | 32+ chars. Rotating it logs everyone out |
| `BETTER_AUTH_URL` | dev, build | e.g. `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | optional | Client-safe origin |
| `UPLOADS_DIR` | optional | Defaults to `./public/uploads` |

> **Known gap:** `DATABASE_URL_DIRECT` in the local `.env` is currently a copy of
> the pooled URL. Replace it with the real direct connection string from the Neon
> dashboard before relying on it for migrations. It has not been exercised
> against a non-pooled endpoint yet.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Verifying

```bash
pnpm verify   # typecheck -> lint -> build
```

`pnpm lint` is a bare `eslint` call; Next 16 removed `next lint`.

## Seeded accounts

`pnpm db:seed` creates 20 users. Every one has the password `password123`:

| Email | Handle |
| --- | --- |
| `adalovelace@example.com` | `@adalovelace` |
| `gracehopper@example.com` | `@gracehopper` |
| `alanturing@example.com` | `@alanturing` |

The seed is deterministic (fixed PRNG seed), so re-running it reproduces the same
dataset. `pnpm db:seed -- --keep` inserts without wiping.

## Status

Phase 1 of 8. The database schema, migrations, and seed data exist; the auth
config and all routes are not built yet. See `AGENTS.md` for architecture notes
and gotchas.

## Deploying

Not yet supported. Two known blockers: local disk uploads under `public/uploads`
do not work on serverless hosts, and the Neon credential currently in `.env`
should be rotated because it was shared over chat.
