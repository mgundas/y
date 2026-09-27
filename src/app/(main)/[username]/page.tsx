import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FeedList } from "@/components/feed/feed-list";
import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileTabs, type ProfileTab } from "@/components/profile/profile-tabs";
import { getCurrentUser } from "@/lib/auth/session";
import { clampPageSize } from "@/lib/cursor";
import {
  getLikedPosts,
  getPostsByAuthor,
  getRepliesByAuthor,
} from "@/lib/db/queries/feed";
import {
  getProfileByUsername,
  getProfileTabCounts,
} from "@/lib/db/queries/profile";

/** Untrusted query input, so the accepted set is explicit rather than a cast. */
const TABS = ["posts", "replies", "likes"] as const;

function parseTab(raw: string | undefined): ProfileTab {
  return TABS.find((tab) => tab === raw) ?? "posts";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const profile = await getProfileByUsername({ username });

  if (!profile) return { title: "Profile" };
  return {
    title: `${profile.name} (@${profile.username})`,
    description: profile.bio ?? undefined,
  };
}

/**
 * A public profile.
 *
 * `?tab=` selects Posts, Replies, or Likes. The tab lives in the URL rather than
 * in client state, so a profile tab is shareable and back-button-correct. The
 * page reads the session itself rather than trusting `src/proxy.ts`, which only
 * optimistically checks for the cookie's presence.
 */
export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ tab?: string; cursor?: string; limit?: string }>;
}) {
  const { username } = await params;
  const { tab: rawTab, cursor, limit: rawLimit } = await searchParams;

  const viewer = await getCurrentUser();
  const viewerId = viewer?.id ?? null;
  const limit = clampPageSize(rawLimit);
  const tab = parseTab(rawTab);

  const profile = await getProfileByUsername({ username, viewerId });
  if (!profile) notFound();

  // A Likes tab is only ever rendered on your own profile, so asking for it on
  // someone else's is a bad URL rather than a missing permission: it falls back
  // to Posts instead of 404ing.
  const effectiveTab: ProfileTab =
    tab === "likes" && !profile.isSelf ? "posts" : tab;

  const counts = await getProfileTabCounts({
    authorId: profile.id,
    isSelf: profile.isSelf,
  });

  const page =
    effectiveTab === "replies"
      ? await getRepliesByAuthor({
          authorUsername: profile.username,
          cursor,
          limit,
          viewerId,
        })
      : effectiveTab === "likes"
        ? // `isSelf` is true here, so `profile.id` is the viewer and this is
          // their own private list.
          await getLikedPosts({ viewerId: profile.id, cursor, limit })
        : await getPostsByAuthor({
            authorUsername: profile.username,
            cursor,
            limit,
            viewerId,
          });

  const emptyMessage =
    effectiveTab === "replies"
      ? "No replies yet."
      : effectiveTab === "likes"
        ? "No liked posts yet."
        : "No posts yet.";

  return (
    <div>
      <header className="sticky top-0 z-10 flex h-14 items-center border-b border-border bg-background/80 px-4 backdrop-blur">
        <h1 className="truncate text-lg font-bold">{profile.name}</h1>
      </header>

      <ProfileHeader profile={profile} signedIn={Boolean(viewer)} />

      <ProfileTabs
        username={profile.username}
        active={effectiveTab}
        counts={counts}
      />

      <FeedList
        page={page}
        limit={limit}
        signedIn={Boolean(viewer)}
        basePath={`/${profile.username}`}
        // Posts is the default, so its link stays clean at `/{username}`.
        query={effectiveTab === "posts" ? {} : { tab: effectiveTab }}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
