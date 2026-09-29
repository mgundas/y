"use client";

/**
 * Route-level failure boundary for `(main)`.
 *
 * A thrown query or action error lands here instead of the framework's default
 * crash page. `reset()` retries the render - transient database blips recover
 * without losing the URL the reader was on.
 */
export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-lg font-bold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {process.env.NODE_ENV === "development" && error.message
          ? error.message
          : "Please try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Try again
      </button>
    </div>
  );
}
