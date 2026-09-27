import Link from "next/link";
import { Bird, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Shell only. The real search field and trending list arrive in Phase 7. */
export function RightSidebar() {
  return (
    <aside
      aria-label="Search and trends"
      className={cn(
        "sticky top-0 flex h-dvh flex-col gap-4 overflow-y-auto py-4",
        // Hidden on small screens; Phase 8 gives mobile its own treatment.
        "hidden lg:flex",
      )}
    >
      <form action="/search" role="search" className="relative">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          name="q"
          placeholder="Search"
          aria-label="Search"
          className="rounded-full bg-muted pl-10"
        />
      </form>

      <section
        aria-labelledby="trending-heading"
        className="overflow-hidden rounded-2xl border border-border bg-card"
      >
        <h2 id="trending-heading" className="px-4 py-3 text-lg font-bold">
          Trending now
        </h2>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </section>

      <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 px-4 text-xs text-muted-foreground">
        <span>Terms</span>
        <span>Privacy</span>
        <span>Accessibility</span>
        <Link href="/explore" className="hover:underline">
          Explore
        </Link>
      </nav>
    </aside>
  );
}

export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-full p-3 text-xl font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Bird className="size-7" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">y</span>
    </Link>
  );
}
