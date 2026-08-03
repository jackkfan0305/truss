"use client";

import { useMemo } from "react";
import { useUser } from "@clerk/nextjs";
import { useOthers } from "@liveblocks/react";

/**
 * Every *connection* in the room that is not the current user
 * (19-presence-avatars-cursors).
 *
 * `useOthers` already drops this connection, but not this *user* — a second tab
 * is a second connection, so the same person would appear as their own
 * collaborator. Filtering on the Clerk user ID drops every one of their
 * connections at once.
 *
 * This stays **connection-scoped for everyone else**, because that is what the
 * cursor layer needs: a collaborator with two tabs has two pointers. Consumers
 * that want one entry per person — the avatar stack — run the result through
 * `dedupeByUser` from `lib/presence.ts`.
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
