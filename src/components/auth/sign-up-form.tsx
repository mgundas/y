"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "@/lib/actions/auth";
import type { AuthFormState } from "@/lib/validation/auth";

const initialState: AuthFormState = null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating account…" : "Create account"}
    </Button>
  );
}

function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {errors[0]}
    </p>
  );
}

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.message ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          maxLength={50}
          aria-describedby={state?.errors?.name ? "name-error" : undefined}
          aria-invalid={state?.errors?.name ? true : undefined}
        />
        <FieldError id="name-error" errors={state?.errors?.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            @
          </span>
          <Input
            id="username"
            name="username"
            autoComplete="username"
            required
            maxLength={15}
            pattern="[A-Za-z0-9_]+"
            className="pl-7"
            placeholder="adalovelace"
            aria-describedby={
              state?.errors?.username
                ? "username-hint username-error"
                : "username-hint"
            }
            aria-invalid={state?.errors?.username ? true : undefined}
          />
        </div>
        <p id="username-hint" className="text-xs text-muted-foreground">
          3–15 characters. Letters, numbers, and underscores.
        </p>
        <FieldError id="username-error" errors={state?.errors?.username} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state?.errors?.email ? true : undefined}
        />
        <FieldError id="email-error" errors={state?.errors?.email} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-describedby="password-hint"
          aria-invalid={state?.errors?.password ? true : undefined}
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          At least 8 characters.
        </p>
        <FieldError id="password-error" errors={state?.errors?.password} />
      </div>

      <SubmitButton />

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
