import { z } from "zod";

/**
 * Keyset pagination cursor.
 *
 * Offset pagination is unstable here: a new post arriving between two page
 * requests shifts every later row, so a client walking pages can see a post
 * twice or skip one. Keyset walks a stable ordering instead, which means the
 * cursor has to encode the sort key, not a row number.
 *
 * The sort key is `(createdAt, id)`. `createdAt` alone is not unique, so `id`
 * is carried alongside it to make the comparison a total order. `id` is a
 * bigserial precisely so that tiebreaker is monotonic and deterministic.
 */
const cursorSchema = z.object({
  /** ISO 8601 instant. */
  t: z.iso.datetime(),
  /** bigserial, parsed as a JS number - safe well past any realistic post id. */
  i: z.number().int().positive(),
});

export type Cursor = z.infer<typeof cursorSchema>;

/**
 * The cursor arrives in a URL, so it is untrusted input like any other. A
 * malformed or hand-edited cursor must degrade to "no cursor" (the first page)
 * rather than throw, otherwise a stale bookmark 500s instead of showing page one.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;
  try {
    // base64url, not base64: "+" and "/" need escaping in a query string.
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = cursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export const DEFAULT_PAGE_SIZE = 20;
/** Upper bound on a client-supplied page size, so `?limit=99999` cannot be. */
export const MAX_PAGE_SIZE = 50;

export function clampPageSize(raw: string | null | undefined): number {
  if (!raw) return DEFAULT_PAGE_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}
