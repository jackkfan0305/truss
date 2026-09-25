import {
  CanvasSnapshotInvalidError,
  CanvasSnapshotUploadError,
  readStoredCanvasSince,
  writeStoredCanvas,
} from "@/lib/canvas-persistence";
import {
  CanvasVersionConflictError,
  parseCanvasVersion,
  parseCanvasWrite,
} from "@/lib/canvas-snapshot";
import { authorizeDiagram } from "@/lib/diagram-access";
import { jsonError, readJsonBody } from "@/lib/api-requests";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

/**
 * The canvas as one versioned snapshot (ADR 0005). `PUT` is a compare-and-swap
 * on the version the client last read; `GET ?since=N` is the idle editor's
 * cheap poll and answers `{ changed: false }` without touching Blob.
 */
export async function PUT(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;
  const access = await authorizeDiagram(request, diagramId);

  if (!access.ok) {
    return access.response;
  }

  const write = parseCanvasWrite(await readJsonBody(request));

  if (!write) {
    return jsonError("A canvas snapshot and version are required", 400);
  }

  try {
    const version = await writeStoredCanvas(diagramId, write.snapshot, {
      expectedVersion: write.version,
      isAgentWrite: false,
    });

    return Response.json({ version, savedAt: new Date().toISOString() });
  } catch (error: unknown) {
    if (error instanceof CanvasVersionConflictError) {
      return jsonError("The diagram changed elsewhere", 409);
    }

    if (error instanceof CanvasSnapshotUploadError) {
      console.error(`Canvas upload failed for ${diagramId}`, error);
      return jsonError("Could not save the canvas", 502);
    }

    throw error;
  }
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;
  const access = await authorizeDiagram(request, diagramId);

  if (!access.ok) {
    return access.response;
  }

  const since = parseCanvasVersion(new URL(request.url).searchParams.get("since"));

  try {
    const stored = await readStoredCanvasSince(diagramId, since);

    if (stored === "unchanged") {
      return Response.json({ changed: false, version: since });
    }

    return Response.json({
      changed: true,
      canvas: stored.snapshot,
      version: stored.version,
      isAgentWrite: stored.isAgentWrite,
    });
  } catch (error: unknown) {
    if (error instanceof CanvasSnapshotInvalidError) {
      // Answering `canvas: null` would look like "never saved" and let an
      // autosave quietly overwrite whatever is really there.
      console.error(error.message);
      return jsonError("The saved canvas could not be read", 422);
    }

    console.error(`Canvas download failed for ${diagramId}`, error);
    return jsonError("Could not load the canvas", 502);
  }
}
