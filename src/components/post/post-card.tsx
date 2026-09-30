import Link from "next/link";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { FeedPost } from "@/lib/db/queries/feed";
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from "@/lib/text";
import { cn } from "@/lib/utils";

import { DeletePostButton } from "./delete-post-button";
import { PostActions } from "./post-actions";
import { PostContent } from "./post-content";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ""}${(parts[1] as string)[0] ?? ""}`.toUpperCase();
}

function initialsFromHandle(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

/**
 * One post in a list.
 *
 * A Server Component on purpose: the relative timestamp is computed here and
 * never re-run on the client, so there is nothing to hydrate and no chance of a
 * "2m" / "3m" mismatch. Only the action row is a Client Component, and it
 * receives primitives rather than the `post` object so the serialized payload
 * crossing the boundary is a handful of numbers and booleans.
 *
 * `signedIn` is threaded down rather than inferred. A signed-out viewer and a
 * signed-in viewer who has not liked anything both produce three `false`
 * viewer flags, so the flags cannot answer the question.
 */
export function PostCard({
  post,
  now = new Date(),
  signedIn = false,
  canDelete = false,
  repostedLabel = null,
}: {
  post: FeedPost;
  now?: Date;
  signedIn?: boolean;
  /**
   * Owner-only deletion. Computed server-side (viewer id vs author id), never
   * in the client - the button's presence is convenience, `deletePostAction`'s
   * author check is the guard.
   */
  canDelete?: boolean;
  /**
   * Context line above the post ("You reposted", "@x reposted"). Set by the
   * list, which knows whose timeline this is; the card only knows the viewer
   * reposted it, not who to name.
   */
  repostedLabel?: string | null;
}) {
  const iso = post.createdAt.toISOString();

  return (
    <article className="flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent/40">
      <Link
        href={`/${post.author.username}`}
        className="shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Avatar className="size-10">
          {post.author.image ? (
            <AvatarImage src={post.author.image} alt="" />
          ) : null}
          <AvatarFallback>
            {initials(post.author.name) || initialsFromHandle(post.author.username)}
          </AvatarFallback>
        </Avatar>
        <span className="sr-only">Posts by {post.author.name}</span>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-1 text-sm">
          <Link
            href={`/${post.author.username}`}
            className="font-semibold hover:underline"
          >
            {post.author.name}
          </Link>
          <span className="text-muted-foreground">@{post.author.username}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            &middot;
          </span>
          <time
            dateTime={iso}
            title={formatAbsoluteTime(iso)}
            className="text-muted-foreground"
          >
            {formatRelativeTime(iso, now)}
          </time>
        </div>

        {repostedLabel ? (
          <p className="text-sm text-muted-foreground">{repostedLabel}</p>
        ) : null}

        {post.replyingToUsername ? (
          <p className="text-sm text-muted-foreground">
            Replying to{" "}
            <Link
              href={`/${post.replyingToUsername}`}
              className="text-primary hover:underline"
            >
              @{post.replyingToUsername}
            </Link>
          </p>
        ) : null}

        <PostContent content={post.content} className="mt-0.5" />

        {post.images.length > 0 ? (
          // Plain <img>, not next/image: media URLs are arbitrary user-supplied
          // hosts, which cannot be allowlisted in `remotePatterns`. An image
          // optimization proxy is later work; unoptimized <img> with lazy
          // loading is the honest interim.
          <div
            className={cn(
              "mt-3 grid gap-2 overflow-hidden rounded-xl border border-border",
              post.images.length > 1 && "grid-cols-2",
            )}
          >
            {post.images.map((image) => (
              // Media URLs are arbitrary user-supplied hosts, unallowlistable
              // in remotePatterns; see the note above.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.url}
                src={image.url}
                alt={image.altText ?? ""}
                loading="lazy"
                className="h-full max-h-96 w-full object-cover"
              />
            ))}
          </div>
        ) : null}

        {post.quoted ? (
          <Link
            // The quoted *post*, not its author. Linking the profile made the
            // reference unreachable - a quote card that cannot reach the quote.
            href={`/${post.quoted.authorUsername}/status/${post.quoted.id}`}
            aria-label={`Quoted post by @${post.quoted.authorUsername}`}
            className={cn(
              "mt-3 block rounded-xl border border-border p-3 transition-colors",
              "hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            )}
          >
            <p className="text-sm font-semibold">
              {post.quoted.authorName}{" "}
              <span className="font-normal text-muted-foreground">
                @{post.quoted.authorUsername}
              </span>
            </p>
            {/* Clamped rather than hidden: the referenced post is context, and
                truncating it with a line clamp keeps the card height stable. */}
            <PostContent
              content={post.quoted.content}
              className="mt-0.5 line-clamp-4 text-sm"
            />
          </Link>
        ) : null}

        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <PostActions
              postId={post.id}
              replyHref={`/${post.author.username}/status/${post.id}`}
              replyCount={post.replyCount}
              quoteHref={`/quote/${post.id}`}
              quoteCount={post.quoteCount}
              signedIn={signedIn}
              liked={post.likedByViewer}
              likeCount={post.likeCount}
              reposted={post.repostedByViewer}
              repostCount={post.repostCount}
              bookmarked={post.bookmarkedByViewer}
              bookmarkCount={post.bookmarkCount}
            />
          </div>
          {canDelete ? (
            <div className="mt-2 shrink-0">
              <DeletePostButton postId={post.id} />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
