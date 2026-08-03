"use client";

import { useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { useOthers } from "@liveblocks/react";

/**
 * Everyone else in the room (19-presence-avatars-cursors).
 *
 * `useOthers` already drops this connection, but not this *user* — a second tab
 * is a second connection, so the same person would appear as their own
 * collaborator. Filtering on the Clerk user ID collapses every one of their
 * connections, which is what both the avatar group and the live cursors want.
 *
 * The non-suspense `useOthers` is deliberate: this runs in the navbar, outside
 * the canvas' suspense boundary, and an empty list while connecting is the
 * correct thing to render.
 */
export function useCollaborators() {
  const others = useOthers();
  const userId = useUser().user?.id;

  return useMemo(
    // While Clerk is still loading there is no ID to compare against, so
    // rendering nothing beats briefly rendering yourself as a collaborator.
    () => (userId ? others.filter((other) => other.id !== userId) : []),
    [others, userId]
  );
}
