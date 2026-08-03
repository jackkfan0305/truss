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
