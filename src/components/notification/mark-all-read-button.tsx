"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markAllNotificationsReadAction } from "@/lib/actions/notification";

/**
 * The only client component on the notifications page.
 *
 * There is no pending state to fake: the action's `marked` count is the number
 * of rows that were unread, and the server re-renders the list afterwards. The
 * button is left enabled while the request is in flight - marking read twice is
 * a no-op, because the second call's `where read_at is null` matches nothing.
 */
export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (disabled) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (!result.ok) {
            toast.error(result.message);
          }
          router.refresh();
        })
      }
    >
      {pending ? "Marking…" : "Mark all as read"}
    </Button>
  );
}
