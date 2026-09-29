"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { toggleFollowAction } from "@/lib/actions/follow";
import { formatCount } from "@/lib/text";
import { cn } from "@/lib/utils";

/**
 * Follow / Following.
 *
 * Same optimistic contract as the engagement buttons in `post-actions.tsx`: the
 * click paints the new state immediately, the guess is never persisted, and
 * `router.refresh()` settles on the server's numbers. Nothing is disabled while
 * pending, because a follow is a toggle and two clicks should mean "back to
 * where you started".
 */
export function FollowButton({
  username,
  signedIn,
  following: initialFollowing,
  followerCount: initialFollowerCount,
}: {
  username: string;
  signedIn: boolean;
  following: boolean;
  followerCount: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimistic, addOptimistic] = useOptimistic(
    {
      following: initialFollowing,
      followerCount: initialFollowerCount,
    },
    (state: { following: boolean; followerCount: number }) => ({
      following: !state.following,
      followerCount: Math.max(
        0,
        state.followerCount + (state.following ? -1 : 1),
      ),
    }),
  );

  function onClick() {
    // Courtesy, not the guard. `toggleFollowAction` re-reads the session and
    // rejects a signed-out write regardless of what this does.
    if (!signedIn) {
      router.push("/sign-in");
      return;
    }

    startTransition(async () => {
      addOptimistic(undefined);
      const result = await toggleFollowAction(username);
      if (!result.ok) {
        toast.error(result.message);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={optimistic.following}
        className={cn(
          "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          optimistic.following
            ? "border border-border bg-transparent text-foreground hover:bg-accent"
            : "bg-foreground text-background hover:opacity-90",
        )}
      >
        {optimistic.following ? "Following" : "Follow"}
        <span className="sr-only"> {username}</span>
      </button>

      <p className="text-sm text-muted-foreground">
        <span className="text-foreground">{formatCount(optimistic.followerCount)}</span>{" "}
        {optimistic.followerCount === 1 ? "Follower" : "Followers"}
      </p>
    </div>
  );
}
