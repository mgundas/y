import type { Metadata } from "next";

import { PasswordForm } from "@/components/settings/password-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Settings",
  description: "Edit your Y profile and password.",
};

/**
 * Protected (`proxy.ts` lists `/settings`, and `requireSession()` is the real
 * gate). One page, two forms: profile fields and password change are separate
 * actions with separate states, so a password error never wipes the bio draft.
 */
export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Settings</h1>
      </header>

      <div className="flex flex-col gap-10 px-4 py-6">
        <section aria-labelledby="settings-profile-heading">
          <h2
            id="settings-profile-heading"
            className="mb-4 text-base font-semibold"
          >
            Profile
          </h2>
          <ProfileForm
            user={{
              name: session.user.name,
              username: session.user.username,
              bio: session.user.bio ?? null,
              image: session.user.image ?? null,
              bannerUrl: session.user.bannerUrl ?? null,
            }}
          />
        </section>

        <section aria-labelledby="settings-password-heading">
          <h2
            id="settings-password-heading"
            className="mb-4 text-base font-semibold"
          >
            Password
          </h2>
          <PasswordForm />
        </section>
      </div>
    </div>
  );
}
