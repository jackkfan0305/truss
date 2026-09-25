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
