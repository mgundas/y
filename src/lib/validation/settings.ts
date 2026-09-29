import { z } from "zod";

import {
  nameSchema,
  usernameSchema,
} from "@/lib/validation/auth";

/** Bio: 160 chars, nullable so clearing it is representable. */
export const bioSchema = z
  .string()
  .trim()
  .max(160, "Bio must be 160 characters or fewer.")
  .nullish();

/**
 * Avatar/banner URLs. Optional HTTP(S) URLs only - uploads arrive in a later
 * phase, so today this is "paste a link". Empty string normalises to null
 * (cleared) rather than failing the URL check on a field the user emptied.
 */
const optionalImageUrl = z
  .string()
  .trim()
  .max(2048, "URL is too long.")
  .refine(
    (value) => value === "" || /^https?:\/\/\S+$/.test(value),
    "Must be an http(s) URL.",
  )
  .transform((value) => (value === "" ? null : value))
  .nullish();

export const updateProfileSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  bio: bioSchema,
  image: optionalImageUrl,
  bannerUrl: optionalImageUrl,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export type SettingsFormState = {
  ok?: true;
  message?: string;
  errors?: Partial<
    Record<"name" | "username" | "bio" | "image" | "bannerUrl", string[]>
  >;
} | null;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be 128 characters or fewer."),
});

export type PasswordFormState = {
  ok?: true;
  message?: string;
  errors?: Partial<Record<"currentPassword" | "newPassword", string[]>>;
} | null;
