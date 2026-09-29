import Link from "next/link";

import { cn } from "@/lib/utils";
import { tokenizePost } from "@/lib/text";

/**
 * Renders post text.
 *
 * Content is plain text from the database and there is no HTML path in this
 * app, so every string here is passed to React as a child. React escapes it.
 * The reason this file exists rather than a `dangerouslySetInnerHTML` call is
 * that the segments are React *elements*, so the link targets and labels are
 * fixed by code and never by the poster.
 *
 * The keys are index-based because `tokenizePost` returns a fresh array on
 * every call and the positions are stable within a render.
 */
export function PostContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const segments = tokenizePost(content);

  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {segments.map((segment, index) => {
        const key = `${segment.kind}-${index}`;

        switch (segment.kind) {
          case "mention":
            return (
              <Link
                key={key}
                href={`/${segment.username}`}
                className="text-primary hover:underline"
              >
                {segment.value}
              </Link>
            );
          case "hashtag":
            return (
              <Link
                key={key}
                href={`/explore/hashtag/${segment.tag}`}
                title={`Posts tagged #${segment.tag}`}
                className="font-medium text-primary hover:underline"
              >
                {segment.value}
              </Link>
            );
          case "url":
            return (
              <a
                key={key}
                href={segment.href}
                target="_blank"
                // noopener/noreferrer: the opened page must not get a handle on
                // this window via window.opener.
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                {segment.value}
              </a>
            );
          case "text":
            return <span key={key}>{segment.value}</span>;
        }
      })}
    </p>
  );
}
