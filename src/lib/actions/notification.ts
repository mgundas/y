"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/session";
import { markAllRead } from "@/lib/db/queries/notifications";

/**
 * Marks every unread notification as read.
 *
 * Rejected rather than redirected when signed out, because the only caller is
 * the button on `/notifications`, which `requireSession()` already gates. The
 * check is repeated anyway - a hidden button is not a guard.
 */
export async function markAllNotificationsReadAction(): Promise<
  { ok: true; marked: number } | { ok: false; message: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, message: "Sign in to see your notifications." };
  }

  const marked = await markAllRead(user.id);

  // The badge in the nav is rendered by the layout, so the layout's route has to
  // be re-rendered too, not just the notifications page.
  revalidatePath("/notifications");
  revalidatePath("/");

  return { ok: true, marked };
}
