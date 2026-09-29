"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/lib/auth/server";
import { requireSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { user as userTable } from "@/lib/db/schema";
import {
  changePasswordSchema,
  updateProfileSchema,
  type PasswordFormState,
  type SettingsFormState,
} from "@/lib/validation/settings";

/**
 * Profile editing: name, username, bio, avatar and banner URLs.
 *
 * The row is updated directly rather than through Better Auth's `updateUser`,
 * because `username`, `bio`, and `bannerUrl` are additional fields with their
 * own constraints (case-insensitive uniqueness on username), and the
 * pre-check-then-write with a friendly message is clearer here than mapping
 * adapter errors. The session is re-read from the database on every request
 * (`getSession`), so the new values take effect immediately - no session
 * rewrite needed.
 *
 * Username changes are safe: every URL embeds the username but every join uses
 * `user.id`, so renaming is one column update, not a cascade.
 */
export async function updateProfileAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const session = await requireSession();

  const parsed = updateProfileSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    bio: formData.get("bio") || undefined,
    image: formData.get("image") || undefined,
    bannerUrl: formData.get("bannerUrl") || undefined,
  });

  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors };
  }

  const { name, username, bio, image, bannerUrl } = parsed.data;

  // Friendly pre-check; the unique index is the real guarantee. Excludes the
  // caller's own row so saving without changing the username always passes.
  if (username !== session.user.username) {
    const clash = await db
      .select({ id: userTable.id })
      .from(userTable)
      .where(sql`lower(${userTable.username}) = ${username}`)
      .limit(1);
    if (clash[0]) {
      return { errors: { username: ["That username is taken."] } };
    }
  }

  try {
    await db
      .update(userTable)
      .set({
        name,
        username,
        bio: bio ?? null,
        image: image ?? null,
        bannerUrl: bannerUrl ?? null,
      })
      .where(eq(userTable.id, session.user.id));
  } catch (error) {
    console.error("update profile failed", error);
    return { message: "Could not save that. Please try again." };
  }

  revalidatePath(`/${session.user.username}`);
  revalidatePath(`/${username}`);
  revalidatePath("/");

  return { ok: true };
}

/**
 * Password change. Verifies the current password server-side through Better
 * Auth - the action never sees a hash, only the two plaintext fields, and the
 * failure message is deliberately vague so it cannot be used to probe whether
 * an account's password was recently changed.
 */
export async function changePasswordAction(
  _prevState: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  await requireSession();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });

  if (!parsed.success) {
    return { errors: z.flattenError(parsed.error).fieldErrors };
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
      },
      headers: await headers(),
    });
  } catch {
    return { message: "Could not change the password. Check the current one." };
  }

  return { ok: true };
}
