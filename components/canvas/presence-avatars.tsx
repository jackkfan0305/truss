"use client";

import { useMemo } from "react";

import { useCollaborators } from "@/hooks/use-collaborators";
import { dedupeByUser, getInitials } from "@/lib/presence";

/** Past this, the rest collapse into a `+N` chip rather than eating the navbar. */
const MAX_VISIBLE_AVATARS = 5;

/**
 * The collaborator avatar stack for a canvas room (19-presence-avatars-cursors).
 *
 * Rendered by the editor navbar *only* when a project is open, immediately
 * before the Clerk `UserButton` — so the current user is represented once, by
 * the control that already handles their profile and sign-out, and never a
 * second time from the presence list.
 *
 * The trailing divider lives here rather than in the navbar because it should
 * only exist when there is something to divide: with no collaborators the whole
 * component renders nothing and the navbar is visually unchanged.
 *
 * One avatar per *person*, not per connection — see `dedupeByUser`. The cursor
 * layer deliberately keeps the connection-scoped list.
 */
export function PresenceAvatars() {
  const connections = useCollaborators();
  const collaborators = useMemo(() => dedupeByUser(connections), [connections]);

  if (collaborators.length === 0) {
    return null;
  }

  const visible = collaborators.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = collaborators.length - visible.length;

  return (
    <div className="flex items-center gap-2">
      {/*
        A list, not a row of buttons: these are display-only. The negative
        spacing is what overlaps them; each avatar's page-coloured ring is what
        keeps them legible while overlapping.
      */}
      <ul
        aria-label={`${collaborators.length} other ${
          collaborators.length === 1 ? "person" : "people"
        } in this canvas`}
        className="flex items-center -space-x-2"
      >
        {visible.map((collaborator) => (
          <li key={collaborator.connectionId}>
            <CollaboratorAvatar
              name={collaborator.info.name}
              avatar={collaborator.info.avatar}
              color={collaborator.info.color}
            />
          </li>
        ))}

        {overflow > 0 ? (
          <li>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-subtle text-[10px] font-medium text-copy-secondary ring-2 ring-page">
              +{overflow}
            </span>
          </li>
        ) : null}
      </ul>

      <span aria-hidden className="h-5 w-px bg-surface-border" />
    </div>
  );
}

interface CollaboratorAvatarProps {
  name: string;
  avatar: string;
  color: string;
}

/**
 * Sized to match the Clerk `UserButton` avatar (1.75rem) so the group reads as
 * one row rather than two controls of different weights.
 *
 * Two rings, both drawn inside the element so neither adds layout: the page
 * ring separates overlapping avatars, and the inset outline in the
 * participant's presence colour ties an avatar to its cursor on the canvas.
 */
function CollaboratorAvatar({ name, avatar, color }: CollaboratorAvatarProps) {
  return (
    <span
      title={name}
      className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-elevated text-[10px] font-medium text-copy-primary ring-2 ring-page"
      style={{ outline: `2px solid ${color}`, outlineOffset: "-2px" }}
    >
      {avatar ? (
        /* A 28px avatar from whichever CDN host Clerk hands back — next/image
           would need every one of those domains in `remotePatterns` to gain
           nothing at this size. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt={name}
          width={28}
          height={28}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{getInitials(name)}</span>
      )}
    </span>
  );
}
