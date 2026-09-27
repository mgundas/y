import { z } from "zod";

/**
 * Shared between client forms and server actions so the rules can never drift.
 * The server copy is the one that counts; the client copy is only for
 * immediate feedback.
 */

/** Display name. */
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(50, "Name must be 50 characters or fewer.");

/**
 * Usernames are stored lowercase so the unique index is case-insensitive.
 * The transform is what makes `@AdaLovelace` and `@adalovelace` the same
 * account, so it must run on the server too - not just in the form.
 */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Username must be at least 3 characters.")
  .max(15, "Username must be 15 characters or fewer.")
  .regex(
    /^[a-z0-9_]+$/,
    "Username can only contain letters, numbers, and underscores.",
  );

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .pipe(z.email("Enter a valid email address."));

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const signUpSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpValues = z.output<typeof signUpSchema>;
export type SignInInput = z.input<typeof signInSchema>;
export type SignInValues = z.output<typeof signInSchema>;

/** Shape returned by the auth server actions to `useActionState`. */
export type AuthFormState = {
  errors?: Partial<Record<"name" | "username" | "email" | "password", string[]>>;
  message?: string;
  /** Field-level success, e.g. "Check your inbox." */
  success?: string;
} | null;
