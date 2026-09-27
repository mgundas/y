import { z } from "zod";

import { HASHTAG_MAX } from "@/lib/text";

/** 280 characters, matching the composer's counter. */
export const POST_MAX_LENGTH = 280;

/**
 * Trim first, then bound the length. The order is the point: `"   "x 281
 * chars   "` is over the limit with the padding and legal without it, and
 * measuring before trimming would reject posts the user can see fit.
 */
export const postContentSchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(POST_MAX_LENGTH, `Posts are limited to ${POST_MAX_LENGTH} characters.`);

export const hashtagSchema = z
  .string()
  .toLowerCase()
  .min(1)
  .max(HASHTAG_MAX)
  .regex(/^[a-z0-9_]+$/, "Hashtags may only contain letters, numbers, and underscores.");

/**
 * Coerced with `z.coerce.number()` because a form field arrives as a string.
 * Rejects `NaN`, floats, and `0` (there is no post 0) before the query runs.
 * Exported because the engagement actions validate a post id too, and one
 * definition of "a valid post id" is worth more than the duplication.
 */
export const postIdSchema = z.coerce.number().int().positive();

export const createPostSchema = z.object({
  content: postContentSchema,
  parentId: postIdSchema.optional(),
  quotedPostId: postIdSchema.optional(),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;

export type PostFormState = {
  /** Set only on success, so the composer can clear itself unambiguously. */
  ok?: true;
  message?: string;
  errors?: Partial<Record<"content" | "parentId" | "quotedPostId", string[]>>;
} | null;
