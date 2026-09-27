import type { Metadata } from "next";

export const metadata: Metadata = { title: "Search" };

/**
 * `searchParams` is a Promise in Next 16 - page props are always awaited.
 * The real full-text query lands in Phase 7.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="text-lg font-bold">Search</h1>
      </header>

      <div className="px-4 py-10">
        {query ? (
          <p className="text-sm">
            Results for <span className="font-medium">{query}</span> land in
            Phase 7.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Search users and posts. Full-text search lands in Phase 7.
          </p>
        )}
      </div>
    </div>
  );
}
