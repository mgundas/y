import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Profile } from "@/lib/db/queries/profile";
import { formatCount, formatJoinMonth } from "@/lib/text";

import { BlockButton } from "./block-button";
import { FollowButton } from "./follow-button";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0] as string).slice(0, 2).toUpperCase();
  return `${(parts[0] as string)[0] ?? ""}${(parts[1] as string)[0] ?? ""}`.toUpperCase();
}

/**
 * The profile header: banner, avatar, identity, and follow state.
 *
 * A Server Component. The one interactive control, the follow button, is a
 * Client Component; everything here is static markup derived from the profile
 * row, so there is nothing to hydrate.
 *
 * The banner falls back to a neutral surface rather than a decorative image. A
 * seeded database has no banner URLs, and a grey box is honest about that in a
 * way a stock photo is not.
 */
export function ProfileHeader({
  profile,
  signedIn,
}: {
  profile: Profile;
  signedIn: boolean;
}) {
  return (
    <div>
      <div
        aria-hidden="true"
        className="h-48 w-full bg-gradient-to-br from-muted to-muted-foreground/30"
        style={
          profile.bannerUrl
            ? {
                backgroundImage: `url(${CSS.escape(profile.bannerUrl)})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      />

      <div className="px-4 pb-3">
        <div className="flex items-end justify-between gap-4">
          <div className="-mt-12">
            <Avatar className="size-28 border-4 border-background">
              {profile.image ? (
                <AvatarImage src={profile.image} alt="" />
              ) : null}
              <AvatarFallback className="text-3xl">
                {initials(profile.name)}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* A profile cannot follow itself, and `follows` has a CHECK that says
              so. Hiding the control is the readable version of that constraint.
              A blocked profile shows Unblock instead of Follow: the follow
              action would reject anyway, and offering it would be a dead end. */}
          {profile.isSelf ? null : (
            <div className="flex gap-2 pt-3">
              {profile.blockedByViewer ? (
                <BlockButton
                  username={profile.username}
                  signedIn={signedIn}
                  blocking
                />
              ) : profile.blockingViewer ? null : (
                <>
                  <FollowButton
                    username={profile.username}
                    signedIn={signedIn}
                    following={profile.followedByViewer}
                    followerCount={profile.followerCount}
                  />
                  <BlockButton
                    username={profile.username}
                    signedIn={signedIn}
                    blocking={false}
                  />
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h1 className="text-xl font-bold">{profile.name}</h1>
            <span className="text-sm text-muted-foreground">
              @{profile.username}
            </span>
          </div>

          {profile.bio ? (
            <p className="max-w-prose whitespace-pre-wrap text-sm">{profile.bio}</p>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Joined {formatJoinMonth(profile.createdAt)}
          </p>

          <p className="text-sm text-muted-foreground">
            <span className="text-foreground">
              {formatCount(profile.followingCount)}
            </span>{" "}
            Following
            <span className="px-2" aria-hidden="true">
              &middot;
            </span>
            <span className="text-foreground">
              {formatCount(profile.followerCount)}
            </span>{" "}
            Followers
          </p>
        </div>
      </div>
    </div>
  );
}
