"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deletePostAction } from "@/lib/actions/post";

/**
 * Owner-only post deletion.
 *
 * Rendered only when the viewer owns the post (the server decides that via
 * `canDelete`, not this component), and confirmed before firing - deletion
 * cascades to replies' parent links, likes, and notifications, so it is not a
 * click to take lightly. Failures toast; success settles via refresh, and on
 * a detail page the refreshed render 404s because the post is gone.
 */
export function DeletePostButton({ postId }: { postId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deletePostAction(postId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="Delete post"
      className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </button>
  );
}
