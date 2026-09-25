/**
 * Request parsing and error responses shared by the API route handlers.
 * Keeps the handlers thin, per context/code-standards.md.
 */

import { isDiagramId } from "@/lib/diagram-id";

export const DEFAULT_DIAGRAM_NAME = "Untitled Diagram";

export const MAX_DIAGRAM_NAME_LENGTH = 120;

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
 * DEFAULT_DIAGRAM_NAME, rename passes `null` because a name is required there.
 */
export function parseDiagramName(
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

  return name.length > MAX_DIAGRAM_NAME_LENGTH ? null : name;
}

export type DiagramIdResult =
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
export function parseDiagramId(body: unknown): DiagramIdResult {
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

  return isDiagramId(raw) ? { ok: true, id: raw } : { ok: false };
}
