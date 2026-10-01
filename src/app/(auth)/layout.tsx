import Link from "next/link";
import { redirect } from "next/navigation";
import { Bird } from "lucide-react";

import { getSession } from "@/lib/auth/session";

/**
 * Centred card shell for the signed-out pages. Bounces an already-signed-in
 * user back to the app; `getSession` is the real check, not a cookie peek.
 * (Proxy deliberately does not do this bounce: it cannot tell a live cookie
 * from a stale one, and bouncing on presence alone locks stale-cookie users
 * out of ever signing in again. A stale cookie resolves itself here - the
 * form renders, and signing in overwrites it with a live one.)
 */
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-12">
      <Link
        href="/"
        className="flex items-center gap-2 text-2xl font-bold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <Bird className="size-7" aria-hidden="true" />
        <span>y</span>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
