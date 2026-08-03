/**
 * Presence display helpers (19-presence-avatars-cursors).
 *
 * Separate from the avatar component so it stays importable by
 * `scripts/verify-canvas.ts`, which cannot pull in React or Clerk.
 */

/**
 * The avatar fallback when a participant has no profile photo: the first letter
 * of their first two words, so "Ada Lovelace" reads as "AL".
 *
 * `UserMeta.name` is server-set and already falls back to "Anonymous", but it
 * is still a free-text field — a name that is entirely whitespace or symbols
 * would otherwise render an empty circle, so it degrades to "?" rather than to
 * nothing.
 */
export function getInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "?";
}

/**
 * Collapse a connection list to one entry per person, keeping the most recent
 * connection for each.
 *
 * `useOthers` is connection-scoped: a collaborator with the room open in two
 * tabs is two entries. Cursors want that — each tab has its own pointer — but
 * the avatar stack does not, or one person shows up twice and the "N other
 * people" label counts tabs instead of people.
 *
 * `id` is set by the Liveblocks auth handler from the Clerk user ID, but it is
 * optional on the Liveblocks type, so an ID-less connection falls back to its
 * own connection ID. That keeps them as separate entries rather than collapsing
 * every anonymous connection into one.
 */
export function dedupeByUser<T extends { id?: string; connectionId: number }>(
  participants: readonly T[]
): T[] {
  const byUser = new Map(
    participants.map((participant) => [
      participant.id ?? `connection:${participant.connectionId}`,
      participant,
    ])
  );

  return [...byUser.values()];
}
