import { MobileNav } from "@/components/layout/mobile-nav";
import { NavLinks, ProfileLink } from "@/components/layout/nav-links";
import { Brand, RightSidebar } from "@/components/layout/right-sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { getCurrentUser } from "@/lib/auth/session";
import { getUnreadNotificationCount } from "@/lib/db/queries/notifications";

/**
 * Three-column shell: fixed left nav, fluid centre, sticky right sidebar.
 *
 * `/` is intentionally public so the "For you" feed can be browsed without an
 * account. Sub-routes that need a user call `requireSession()` themselves -
 * `src/proxy.ts` is only an optimistic pre-filter.
 */
export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  // The nav badge. Reuses the session already read above rather than calling
  // `getCurrentUser()` again, and short-circuits to 0 signed out.
  const unreadCount = await getUnreadNotificationCount(user?.id ?? null);

  return (
    <div className="mx-auto flex w-full max-w-7xl justify-center gap-0">
      <div className="sticky top-0 flex h-dvh w-16 shrink-0 flex-col justify-between border-r border-border px-2 py-3 sm:w-72 sm:px-3">
        <div className="flex flex-col gap-2">
          <Brand />
          <NavLinks unreadCount={unreadCount} />
        </div>

        <div className="flex flex-col gap-3">
          <ProfileLink username={user?.username ?? null} />
          <UserMenu
            user={
              user
                ? {
                    name: user.name,
                    username: user.username,
                    image: user.image ?? null,
                  }
                : null
            }
          />
        </div>
      </div>

      {/*
        Constrained reading column: without a max-width the centre stretches
        across ultrawide screens and lines run past any comfortable measure.
      */}
      <main className="min-w-0 max-w-2xl flex-1 border-r border-border pb-16 sm:pb-0">
        {children}
      </main>

      <div className="hidden w-80 shrink-0 pl-6 lg:block">
        <RightSidebar />
      </div>

      {/* Bottom nav for small screens, where the left rail is icons only. */}
      <MobileNav unreadCount={unreadCount} />
    </div>
  );
}
