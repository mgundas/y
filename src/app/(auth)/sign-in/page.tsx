import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `?callbackUrl=` arrives from `proxy.ts`, which preserves the deep link it
 * bounced. It travels to the action as a hidden field (with JS off, the form
 * post is the only thing the server receives), and the action validates it
 * before redirecting - see `safeCallbackUrl` in `actions/auth.ts`.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Welcome back.</p>
      </header>
      <SignInForm callbackUrl={callbackUrl} />
    </section>
  );
}
