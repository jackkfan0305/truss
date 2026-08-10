/**
 * Where a generated spec lives (28-spec-persistence-download).
 *
 * The same storage split as the canvas: Prisma keeps the pointer, Vercel Blob
 * keeps the document. Shared by the `generate-spec` task, which writes one, and
 * the download route, which reads it back — so the pathname and the content type
 * have one definition rather than one per side.
 *
 * Free of Prisma and Blob imports on purpose, so `scripts/verify-spec-api.ts`
 * can exercise it without a database or a store token.
 */

/**
 * The store this project's token belongs to is configured for **private**
 * access, so every call has to say so — `"public"` is rejected outright rather
 * than silently downgraded, and a private blob's URL is not fetchable without
 * the token. That is the right shape for a spec: it describes a project that is
 * private to its owner and collaborators, so the authenticated download route
 * must be the only way to read one.
 */
export const SPEC_BLOB_ACCESS = "private" as const;

/** Markdown, both into the store and back out to the browser. */
export const SPEC_CONTENT_TYPE = "text/markdown; charset=utf-8";

/**
 * One document per spec, namespaced by project. Nothing overwrites anything
 * here: each spec has its own ID, so history accumulates instead of the canvas's
 * single latest-snapshot pathname.
 */
export function specBlobPath(projectId: string, specId: string): string {
  return `specs/${projectId}/${specId}.md`;
}

/**
 * The name the browser saves a download under.
 *
 * Derived from the timestamp rather than from the spec ID or the project name: a
 * run ID means nothing in a Downloads folder, and a project name is
 * user-controlled text that would need escaping before it went anywhere near a
 * `Content-Disposition` header. Minute precision, so two specs from the same
 * project on the same day do not collide.
 */
export function specFileName(createdAt: Date): string {
  const stamp = createdAt.toISOString().slice(0, 16).replace(/[:T]/g, "-");

  return `spec-${stamp}.md`;
}
