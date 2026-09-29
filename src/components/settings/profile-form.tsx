"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/actions/settings";
import type { SettingsFormState } from "@/lib/validation/settings";

const initialState: SettingsFormState = null;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="rounded-full" disabled={pending}>
      {pending ? "Saving…" : "Save"}
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

export interface ProfileFormUser {
  name: string;
  username: string;
  bio: string | null;
  image: string | null;
  bannerUrl: string | null;
}

/**
 * Profile editing. Uncontrolled inputs with `defaultValue`: the values are the
 * server's, and a successful save re-renders the page with new ones, which
 * remounts the form. No client state to drift from the database.
 */
export function ProfileForm({ user }: { user: ProfileFormUser }) {
  const [state, formAction] = useActionState(updateProfileAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state?.ok ? (
        <p
          role="status"
          className="rounded-md border border-emerald-600/50 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-600"
        >
          Profile saved.
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
        <Label htmlFor="settings-name">Name</Label>
        <Input
          id="settings-name"
          name="name"
          autoComplete="name"
          required
          maxLength={50}
          defaultValue={user.name}
          aria-describedby={state?.errors?.name ? "settings-name-error" : undefined}
          aria-invalid={state?.errors?.name ? true : undefined}
        />
        <FieldError id="settings-name-error" errors={state?.errors?.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-username">Username</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            @
          </span>
          <Input
            id="settings-username"
            name="username"
            autoComplete="username"
            required
            maxLength={15}
            pattern="[A-Za-z0-9_]+"
            defaultValue={user.username}
            className="pl-7"
            aria-describedby={
              state?.errors?.username
                ? "settings-username-hint settings-username-error"
                : "settings-username-hint"
            }
            aria-invalid={state?.errors?.username ? true : undefined}
          />
        </div>
        <p id="settings-username-hint" className="text-xs text-muted-foreground">
          3–15 characters. Letters, numbers, and underscores. Changing it moves
          your profile URL.
        </p>
        <FieldError
          id="settings-username-error"
          errors={state?.errors?.username}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-bio">Bio</Label>
        <textarea
          id="settings-bio"
          name="bio"
          rows={3}
          maxLength={160}
          defaultValue={user.bio ?? ""}
          placeholder="A sentence about you."
          aria-describedby={state?.errors?.bio ? "settings-bio-error" : undefined}
          aria-invalid={state?.errors?.bio ? true : undefined}
          className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <FieldError id="settings-bio-error" errors={state?.errors?.bio} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-image">Avatar URL</Label>
        <Input
          id="settings-image"
          name="image"
          type="url"
          autoComplete="url"
          defaultValue={user.image ?? ""}
          placeholder="https://…"
          aria-describedby={state?.errors?.image ? "settings-image-error" : undefined}
          aria-invalid={state?.errors?.image ? true : undefined}
        />
        <FieldError id="settings-image-error" errors={state?.errors?.image} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-banner">Banner URL</Label>
        <Input
          id="settings-banner"
          name="bannerUrl"
          type="url"
          autoComplete="url"
          defaultValue={user.bannerUrl ?? ""}
          placeholder="https://…"
          aria-describedby={
            state?.errors?.bannerUrl ? "settings-banner-error" : undefined
          }
          aria-invalid={state?.errors?.bannerUrl ? true : undefined}
        />
        <FieldError
          id="settings-banner-error"
          errors={state?.errors?.bannerUrl}
        />
      </div>

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
