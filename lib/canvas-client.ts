import {
  parseCanvasSnapshot,
  parseCanvasVersion,
  type CanvasSnapshot,
} from "@/lib/canvas-snapshot";

/** A stored canvas as the browser receives it. */
export interface RemoteCanvas {
  snapshot: CanvasSnapshot;
  version: number;
  isAgentWrite: boolean;
}

const EMPTY_CANVAS: CanvasSnapshot = { nodes: [], edges: [] };

/**
 * Reads a `GET /api/diagrams/:id/canvas` body. `"unchanged"` answers a
 * `?since=` poll whose version still matches; `null` is a body this build
 * cannot read, which callers treat as a failed request.
 */
export function parseCanvasReadResponse(body: unknown): RemoteCanvas | "unchanged" | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const { changed, canvas, version, isAgentWrite } = body as Record<string, unknown>;

  if (changed === false) {
    return "unchanged";
  }

  const parsedVersion = parseCanvasVersion(version);
  const snapshot = canvas === null ? EMPTY_CANVAS : parseCanvasSnapshot(canvas);

  if (changed !== true || parsedVersion === null || !snapshot) {
    return null;
  }

  return { snapshot, version: parsedVersion, isAgentWrite: isAgentWrite === true };
}

/**
 * Loads the stored canvas. With `since`, answers `null` when the version still
 * matches, which is the idle editor's poll.
 */
export async function fetchCanvas(
  diagramId: string,
  since?: number,
  signal?: AbortSignal,
): Promise<RemoteCanvas | null> {
  const query = since === undefined ? "" : `?since=${since}`;
  const response = await fetch(`/api/diagrams/${diagramId}/canvas${query}`, { signal });

  if (!response.ok) {
    throw new Error(`Canvas load responded ${response.status}`);
  }

  const parsed = parseCanvasReadResponse(await response.json());

  if (parsed === null) {
    throw new Error("Canvas load returned an unreadable body");
  }

  return parsed === "unchanged" ? null : parsed;
}

/** One compare-and-swap save. `payload` is already the canonical snapshot JSON. */
export async function putCanvas(
  diagramId: string,
  payload: string,
  version: number,
): Promise<{ status: "saved"; version: number } | { status: "conflict" }> {
  const response = await fetch(`/api/diagrams/${diagramId}/canvas`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // Spliced rather than re-stringified: `payload` is valid JSON already.
    body: `{"version":${version},"canvas":${payload}}`,
  });

  if (response.status === 409) {
    return { status: "conflict" };
  }

  if (!response.ok) {
    throw new Error(`Canvas save responded ${response.status}`);
  }

  const next = parseCanvasVersion(((await response.json()) as { version?: unknown }).version);

  if (next === null) {
    throw new Error("Canvas save response carried no version");
  }

  return { status: "saved", version: next };
}
