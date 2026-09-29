"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/lib/actions/settings";
import type { PasswordFormState } from "@/lib/validation/settings";

const initialState: PasswordFormState = null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="rounded-full" disabled={pending}>
      {pending ? "Changing…" : "Change password"}
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

/** Password change. Nothing is prefilled, ever - not even the current one. */
export function PasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.ok ? (
        <p
          role="status"
          className="rounded-md border border-emerald-600/50 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-600"
        >
          Password changed.
        </p>
      ) : null}
      {state?.message ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-current">Current password</Label>
        <Input
          id="settings-current"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={
            state?.errors?.currentPassword ? "settings-current-error" : undefined
          }
          aria-invalid={state?.errors?.currentPassword ? true : undefined}
        />
        <FieldError
          id="settings-current-error"
          errors={state?.errors?.currentPassword}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-new">New password</Label>
        <Input
          id="settings-new"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          aria-describedby={
            state?.errors?.newPassword ? "settings-new-error" : undefined
          }
          aria-invalid={state?.errors?.newPassword ? true : undefined}
        />
        <FieldError id="settings-new-error" errors={state?.errors?.newPassword} />
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
