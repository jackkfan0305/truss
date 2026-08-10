/**
 * Request parsing and error responses shared by the project route handlers.
 * Keeps the handlers thin, per context/code-standards.md.
 */

import { isProjectId } from "@/lib/project-id";

export const DEFAULT_PROJECT_NAME = "Untitled Project";

const MAX_NAME_LENGTH = 120;

/**
 * A project ID doubles as the /editor/[roomId] segment and the Liveblocks room
 * ID, so it is a slug the client generates from the project name plus a short
 * suffix. Lowercase alphanumeric groups joined by single hyphens — never
 * leading, trailing or doubled.
 */
/**
 * Deliberately loose: one `@`, no whitespace, a dot in the domain. Full RFC 5322
 * validation rejects addresses that really do deliver, and Clerk is the actual
 * authority on whether an address exists. This only has to keep obvious junk out
 * of the collaborator table.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254;

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Reads the request body as JSON. An absent or blank body resolves to `{}` so
 * callers can default missing fields, while malformed JSON resolves to `null`
 * so it is rejected rather than silently treated as empty.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = (await request.text()).trim();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Validates the `name` field of a parsed body. Returns the trimmed name, or
 * `null` when the body is unusable and the caller should answer 400.
 *
 * `fallback` covers a name that is absent or blank: create defaults it to
 * DEFAULT_PROJECT_NAME, rename passes `null` because a name is required there.
 */
export function parseProjectName(
  body: unknown,
  fallback: string | null,
): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const raw = (body as { name?: unknown }).name;

  if (raw === undefined || raw === null) {
    return fallback;
  }

  if (typeof raw !== "string") {
    return null;
  }

  const name = raw.trim();

  if (!name) {
    return fallback;
  }

  return name.length > MAX_NAME_LENGTH ? null : name;
}

export type ProjectIdResult =
  | { ok: true; id: string | undefined }
  | { ok: false };

/**
 * Validates the optional `id` field. Client-supplied because the ID is also the
 * room ID the create dialog previews, so it is checked here rather than trusted:
 * an unchecked value would land in a URL path and a Liveblocks room name.
 *
 * `{ ok: true, id: undefined }` means the caller should fall back to the
 * schema's `cuid()` default.
 */
export function parseProjectId(body: unknown): ProjectIdResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false };
  }

  const raw = (body as { id?: unknown }).id;

  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, id: undefined };
  }

  if (typeof raw !== "string") {
    return { ok: false };
  }

  return isProjectId(raw) ? { ok: true, id: raw } : { ok: false };
}

/**
 * Validates the `email` field of an invite body. Returns the address lowercased,
 * or `null` when the caller should answer 400.
 *
 * Lowercasing is not cosmetic: `@@unique([projectId, email])` is case-sensitive,
 * so storing mixed case would let the same person be invited twice, while every
 * read matches case-insensitively.
 */
export function parseCollaboratorEmail(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const raw = (body as { email?: unknown }).email;

  if (typeof raw !== "string") {
    return null;
  }

  const email = raw.trim().toLowerCase();

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return email;
}
