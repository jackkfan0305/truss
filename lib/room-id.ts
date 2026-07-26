/**
 * Builds the identifier a project is created with. It is one value doing three
 * jobs: the Prisma `Project.id`, the `/editor/[roomId]` segment, and the
 * Liveblocks room ID (10-liveblocks-setup). Kept free of React and Prisma
 * imports so both the create dialog and the API route can validate against it.
 */

/**
 * Room-ID-safe slug. NFKD splits accented letters into base + combining mark,
 * and the non-alphanumeric collapse below drops the mark, so "Café Service"
 * becomes "cafe-service".
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug budget for a room ID. A project name may be up to 120 characters, which
 * would overrun the 80-character ID limit in lib/project-requests.ts once the
 * suffix is appended — so the slug is truncated rather than rejected.
 */
const MAX_SLUG_LENGTH = 60;

/**
 * `<slug>-<suffix>`, or an empty string when the name has no slugifiable
 * characters (e.g. "!!!") and the caller should block submission.
 */
export function buildRoomId(name: string, suffix: string): string {
  const slug = slugify(name).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");

  return slug && suffix ? `${slug}-${suffix}` : "";
}
