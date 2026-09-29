import { Skeleton } from "@/components/ui/skeleton";

/**
 * List skeleton for every route in `(main)`.
 *
 * Navigations are full-page loads ("Load more" is a link), so without this the
 * screen goes blank between pages. Skeletons shaped like post cards keep the
 * layout from jumping when the real rows land.
 */
export default function MainLoading() {
  return (
    <div aria-label="Loading">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Skeleton className="h-6 w-24" />
      </div>
      <ul>
        {[0, 1, 2, 3, 4].map((index) => (
          <li
            key={index}
            className="flex gap-3 border-b border-border px-4 py-3"
          >
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
