"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { Bookmark, Heart, MessageCircle, Repeat2 } from "lucide-react";

import {
  toggleEngagementAction,
  type EngagementKind,
} from "@/lib/actions/engagement";
import { formatCount } from "@/lib/text";
import { cn } from "@/lib/utils";

/**
 * The action row: replies, reposts, likes, bookmarks.
 *
 * A Client Component, unlike the rest of the card, because these are the only
 * controls that mutate without a navigation. Everything above it stays a Server
 * Component - see the note in `post-card.tsx`.
 *
 * Optimism, and what it is *not* doing here: `useOptimistic` guesses the
 * result so the button reacts in the same frame as the click. The guess is
 * deliberately never persisted - once the transition ends, React drops the
 * optimistic value and falls back to the props, which are re-fetched by
 * `router.refresh()`. So the server is the only thing that decides the final
 * state, and a failed or raced toggle visibly reverts instead of lying.
 *
 * No `disabled` while pending. A toggle is idempotent (composite primary key
 * plus an `on conflict do nothing` insert), and the counter is recomputed from
 * the join table rather than incremented, so a double-fire cannot drift it.
 * Locking the button would only stop a user from expressing "no, actually" -
 * two clicks should mean back to where they started, and they do.
 */
export function PostActions({
  postId,
  replyHref,
  replyCount,
  signedIn,
  liked,
  likeCount,
  reposted,
  repostCount,
  bookmarked,
  bookmarkCount,
}: {
  postId: number;
  replyHref: string;
  replyCount: number;
  signedIn: boolean;
  liked: boolean;
  likeCount: number;
  reposted: boolean;
  repostCount: number;
  bookmarked: boolean;
  bookmarkCount: number;
}) {
  return (
    <div className="mt-2 flex max-w-md items-center justify-between text-muted-foreground">
      <ActionLink
        href={replyHref}
        icon={MessageCircle}
        count={replyCount}
        label="replies"
        highlight={false}
      />
      <ToggleButton
        kind="repost"
        postId={postId}
        signedIn={signedIn}
        active={reposted}
        count={repostCount}
        icon={Repeat2}
        label="reposts"
        activeClass="text-emerald-600"
      />
      <ToggleButton
        kind="like"
        postId={postId}
        signedIn={signedIn}
        active={liked}
        count={likeCount}
        icon={Heart}
        label="likes"
        activeClass="text-rose-500"
      />
      <ToggleButton
        kind="bookmark"
        postId={postId}
        signedIn={signedIn}
        active={bookmarked}
        count={bookmarkCount}
        icon={Bookmark}
        label="bookmarks"
        activeClass="text-sky-600"
      />
    </div>
  );
}

type ToggleState = { active: boolean; count: number };

function ToggleButton({
  kind,
  postId,
  signedIn,
  active,
  count,
  icon: Icon,
  label,
  activeClass,
}: {
  kind: EngagementKind;
  postId: number;
  signedIn: boolean;
  active: boolean;
  count: number;
  icon: typeof Heart;
  label: string;
  activeClass: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimistic, addOptimistic] = useOptimistic(
    { active, count } satisfies ToggleState,
    (state: ToggleState): ToggleState => ({
      active: !state.active,
      // `max(0, ...)` guards the *guess* only. The authoritative count comes
      // from the database, but a count rendered as -1 while a request is in
      // flight would be a visible bug even if it were momentary.
      count: Math.max(0, state.count + (state.active ? -1 : 1)),
    }),
  );

  function onClick() {
    // The client check is a courtesy, not the guard. Signed out, the same button
    // is still rendered and the action still rejects the write server-side.
    if (!signedIn) {
      router.push("/sign-in");
      return;
    }

    startTransition(async () => {
      // The reducer takes no meaningful argument, so `undefined` is passed
      // explicitly; React's `useOptimistic` types require one.
      addOptimistic(undefined);
      await toggleEngagementAction(kind, postId);
      // The action revalidates "/", which does not cover a post shown on
      // `/{username}/status/{id}` or on /bookmarks. Refreshing explicitly is
      // what makes every page settle on the server's numbers.
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={optimistic.active}
      aria-label={`${formatCount(optimistic.count)} ${label}`}
      className={cn(
        "flex items-center gap-1 text-sm transition-colors hover:text-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        optimistic.active && activeClass,
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {optimistic.count > 0 ? (
        <span>{formatCount(optimistic.count)}</span>
      ) : null}
    </button>
  );
}

function ActionLink({
  href,
  icon: Icon,
  count,
  label,
  highlight,
}: {
  href: string;
  icon: typeof Heart;
  count: number;
  label: string;
  highlight: boolean;
}) {
  return (
    <Link
      href={href}
      aria-label={`${formatCount(count)} ${label}`}
      className={cn(
        "flex items-center gap-1 text-sm transition-colors hover:text-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        highlight && "text-primary",
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {count > 0 ? <span>{formatCount(count)}</span> : null}
    </Link>
  );
}
