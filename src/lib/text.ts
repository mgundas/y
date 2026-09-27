/**
 * Post text is stored and rendered as plain text. There is no HTML path
 * anywhere in this app, so nothing here produces markup - callers turn these
 * segments into React nodes and let React escape the text ones.
 *
 * The tokenizer is the single source of truth for what a hashtag or a mention
 * is: the renderer and the indexing side effects both read from it, so they
 * cannot drift into disagreeing about which `#foo` counts.
 */

/** Must stay in sync with `postContentSchema`'s max, and with the composer. */
export const USERNAME_MAX = 15;
export const HASHTAG_MAX = 50;

export type Segment =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; username: string }
  | { kind: "hashtag"; value: string; tag: string }
  | { kind: "url"; value: string; href: string };

/**
 * One pass, left to right, so overlapping matches cannot be produced. Order
 * matters: a URL is matched before a mention or hashtag, because `https://x.com/#a`
 * must not be split apart.
 */
const TOKEN =
  /https?:\/\/[^\s]+|@([A-Za-z0-9_]{1,15})|#([A-Za-z0-9_]{1,50})/g;

/** Trailing punctuation on a URL is almost always prose, not part of the link. */
function trimUrlPunctuation(url: string): { url: string; trailing: string } {
  const match = /[.,!?;:)\]}'"]+$/.exec(url);
  if (!match) return { url, trailing: "" };

  const trailing = match[0];
  const body = url.slice(0, match.index);

  // A trailing ")" belongs to the link when the body opened a paren it never
  // closed - the common case being a Wikipedia article title like Foo_(bar).
  // Only parens need this; the rest are always prose.
  if (trailing.includes(")")) {
    const opens = (body.match(/\(/g) ?? []).length;
    const closes = (body.match(/\)/g) ?? []).length;
    if (opens > closes) return { url, trailing: "" };
  }

  return { url: body, trailing };
}

export function tokenizePost(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(TOKEN)) {
    const index = match.index;
    const raw = match[0];

    if (index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, index) });
    }

    if (raw.startsWith("http")) {
      const { url, trailing } = trimUrlPunctuation(raw);
      if (url.length > "https://".length) {
        segments.push({ kind: "url", value: url, href: url });
      } else {
        segments.push({ kind: "text", value: url });
      }
      if (trailing) segments.push({ kind: "text", value: trailing });
    } else if (match[1] !== undefined) {
      segments.push({
        kind: "mention",
        value: raw,
        // Links are case-insensitive because usernames are stored lowercase.
        username: match[1].toLowerCase(),
      });
    } else if (match[2] !== undefined) {
      const tag = match[2].toLowerCase();
      // A tag of only underscores is not a real hashtag; keep it as text.
      if (/^[0-9_]*$/.test(tag) && !/[a-z0-9]/.test(tag)) {
        segments.push({ kind: "text", value: raw });
      } else {
        segments.push({ kind: "hashtag", value: raw, tag });
      }
    }

    lastIndex = index + raw.length;
  }

  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) });
  }

  return segments;
}

/** Lowercased, de-duplicated, order-preserving. Stored without the leading `#`. */
export function extractHashtags(content: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const segment of tokenizePost(content)) {
    if (segment.kind !== "hashtag") continue;
    if (seen.has(segment.tag)) continue;
    seen.add(segment.tag);
    tags.push(segment.tag);
  }
  return tags;
}

/** Lowercased, de-duplicated. Mention notifications are Phase 6. */
export function extractMentions(content: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const segment of tokenizePost(content)) {
    if (segment.kind !== "mention") continue;
    if (seen.has(segment.username)) continue;
    seen.add(segment.username);
    names.push(segment.username);
  }
  return names;
}

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const ABSOLUTE = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
];

/**
 * Rendered in a Server Component, so this never re-runs on the client and
 * cannot cause a hydration mismatch. `now` is injectable so the value is
 * testable rather than depending on when the module happened to be evaluated.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const delta = then - now.getTime();
  const magnitude = Math.abs(delta);
  for (const [unit, ms] of UNITS) {
    if (magnitude >= ms) {
      return RELATIVE.format(Math.round(delta / ms), unit);
    }
  }
  return "just now";
}

/** Stable across server and client, unlike the relative form. */
export function formatAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${ABSOLUTE.format(date)} UTC`;
}

/** 1234 -> "1.2K". Counts are display-only, so rounding is fine. */
export function formatCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}K`;
  }
  const millions = value / 1_000_000;
  return `${millions < 10 ? millions.toFixed(1).replace(/\.0$/, "") : Math.round(millions)}M`;
}

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * "Joined March 2024" for the profile header.
 *
 * `en-US` and `UTC` are pinned rather than inherited. The locale default varies
 * by host, which would make the same account render a different join month
 * depending on where it was rendered from.
 */
export function formatJoinMonth(date: Date): string {
  return MONTH_YEAR.format(date);
}
