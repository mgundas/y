"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { toggleBlockAction } from "@/lib/actions/block";
import { cn } from "@/lib/utils";

/**
 * Block / Unblock.
 *
 * Same optimistic contract as the follow button: paint immediately, never
 * persist the guess, settle on the server via `router.refresh()`. Failures
 * surface as a toast rather than silently reverting, because a block the user
 * thinks landed but did not is a safety issue, not a cosmetic one.
 */
export function BlockButton({
  username,
  signedIn,
  blocking: initialBlocking,
}: {
  username: string;
  signedIn: boolean;
  blocking: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [blocking, setBlocking] = useOptimistic(initialBlocking);

  function onClick() {
    if (!signedIn) {
      router.push("/sign-in");
      return;
    }

    startTransition(async () => {
      setBlocking(!blocking);
      const result = await toggleBlockAction(username);
      if (!result.ok) {
        toast.error(result.message);
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={blocking}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        blocking
          ? "border border-border bg-transparent text-foreground hover:bg-accent"
          : "border border-destructive/50 bg-transparent text-destructive hover:bg-destructive/10",
      )}
    >
      {blocking ? "Unblock" : "Block"}
      <span className="sr-only"> {username}</span>
    </button>
  );
}
