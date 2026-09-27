import type { Metadata } from "next";

export const metadata: Metadata = { title: "Explore" };

/** Public. Trending hashtags land in Phase 7. */
export default function ExplorePage() {
  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Explore</h1>
      </header>

      <div className="px-4 py-10">
        <p className="text-sm text-muted-foreground">
          Trending hashtags from the last 24 hours land in Phase 7.
        </p>
      </div>
    </div>
  );
}
