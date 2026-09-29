import Link from "next/link";

/**
 * Unknown routes, unknown users, and mismatched post URLs all land here via
 * `notFound()`. One sentence and a way home - a 404 is not content.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-bold">Not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        That page does not exist, or what was here is gone.
      </p>
      <Link
        href="/"
        className="rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Back home
      </Link>
    </div>
  );
}
