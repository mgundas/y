"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createPostAction } from "@/lib/actions/post";
import { cn } from "@/lib/utils";
import { POST_MAX_LENGTH, type PostFormState } from "@/lib/validation/post";

const initialState: PostFormState = null;

function PostButton({ label }: { label: string }) {
  // `useFormStatus` reads the enclosing form's pending state, which also covers
  // the no-JS submission React performs on the user's behalf.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="rounded-full">
      {pending ? "Posting…" : label}
    </Button>
  );
}

/**
 * Composer for new posts and for replies. Both post through `createPostAction`;
 * the only difference is the hidden `parentId`. Media is Phase 8.
 *
 * A Server Component cannot read a textarea's value, so the live character
 * count has to live on the client. The 280 limit is enforced in three places on
 * purpose: `maxLength` here for immediate feedback, Zod on the server because
 * the client is not trusted, and the column in the database. Any one of them
 * alone would be bypassable.
 *
 * `useActionState` rather than a direct call, because it is the only one of the
 * two that carries the returned error state through the no-JavaScript form
 * post. With JS off, React runs the action on the server and re-renders with
 * its return value, so validation errors are visible instead of being dropped
 * along with the client state that never ran.
 *
 * Clearing is done by the *parent* remounting this component - see the `key` on
 * `<Composer>` in the home page and on the post detail page. Doing it here with
 * an effect on `state` would mean setState in an effect, which triggers a
 * second render pass and is now a lint error; keying on the newest post id means
 * a successful post (which revalidates and changes the feed) resets the field,
 * while a rejected post (which leaves the feed alone) preserves what was typed.
 */
export function Composer({
  user,
  placeholder = "What's happening?",
  parentId,
  submitLabel = "Post",
}: {
  user: { name: string; username: string; image: string | null };
  placeholder?: string;
  /** Set on a post detail page to make the submission a reply. */
  parentId?: number;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(createPostAction, initialState);
  const [content, setContent] = useState("");

  const remaining = POST_MAX_LENGTH - content.length;
  const contentError = state?.errors?.content?.[0];

  return (
    <form action={formAction} className="flex gap-3 border-b border-border px-4 py-3">
      {/* The reply target travels as a hidden field rather than as a prop the
          action could read, because with JS off the form post is the only thing
          the server receives. */}
      {parentId ? (
        <input type="hidden" name="parentId" value={parentId} />
      ) : null}

      <Avatar className="size-10 shrink-0">
        {user.image ? <AvatarImage src={user.image} alt="" /> : null}
        <AvatarFallback>{user.name.trim().slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <label htmlFor="content" className="sr-only">
          Post text
        </label>
        <textarea
          id="content"
          name="content"
          rows={3}
          required
          value={content}
          onChange={(event) => setContent(event.target.value)}
          maxLength={POST_MAX_LENGTH}
          placeholder={placeholder}
          aria-invalid={contentError ? true : undefined}
          className="w-full resize-none bg-transparent text-lg outline-none placeholder:text-muted-foreground"
        />

        {contentError ? (
          <p role="alert" className="text-sm text-destructive">
            {contentError}
          </p>
        ) : null}

        {state?.message ? (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Mentions and hashtags are linked automatically.
          </p>
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "text-sm tabular-nums",
                remaining <= 20 ? "text-amber-500" : "text-muted-foreground",
              )}
            >
              {remaining}
            </span>
            <PostButton label={submitLabel} />
          </div>
        </div>
      </div>
    </form>
  );
}
