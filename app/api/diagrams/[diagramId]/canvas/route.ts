import { get } from "@vercel/blob";

import {
  parseCanvasSnapshot,
} from "@/lib/canvas-snapshot";
import {
  CanvasSnapshotUploadError,
  saveCanvasSnapshot,
} from "@/lib/canvas-persistence";
import { prisma } from "@/lib/prisma";
import { authorizeDiagram } from "@/lib/diagram-access";
import { jsonError, readJsonBody } from "@/lib/api-requests";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

/**
 * Canvas persistence (21-canvas-autosave). Prisma keeps the pointer, Vercel Blob
 * keeps the JSON — the storage split in `context/architecture-context.md`.
 *
 * Both handlers are `requireOwner: false`: a collaborator edits the canvas, so a
 * collaborator must be able to save it. Owner-only here would mean their work
 * silently stopped persisting.
 */

/**
 * The store this diagram's token belongs to is configured for **private**
 * access, so every call has to say so — `access: "public"` is rejected outright
 * rather than silently downgraded, and a private blob's URL is not fetchable
 * without the token. That is the right shape for canvas data anyway: a diagram
 * is private to its owner and collaborators, and a public blob URL would be an
 * unauthenticated read of the whole diagram by anyone holding the link.
 */
const BLOB_ACCESS = "private" as const;

export async function PUT(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { diagramId } = await params;

  const access = await authorizeDiagram(request, diagramId, { requireOwner: false });

  if (!access.ok) {
    return access.response;
  }

  const snapshot = parseCanvasSnapshot(await readJsonBody(request));

  if (!snapshot) {
    return jsonError("A canvas snapshot is required", 400);
  }

  try {
    const url = await saveCanvasSnapshot(diagramId, snapshot);

    return Response.json({
      canvasJsonPath: url,
      savedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    if (error instanceof CanvasSnapshotUploadError) {
      console.error(`Canvas upload failed for ${diagramId}`, error);
      return jsonError("Could not save the canvas", 502);
    }

    throw error;
  }
}

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { diagramId } = await params;

  const access = await authorizeDiagram(request, diagramId, { requireOwner: false });

  if (!access.ok) {
    return access.response;
  }

  const diagram = await prisma.diagram.findUnique({
    where: { id: diagramId },
    select: { canvasJsonPath: true },
  });

  // Never saved. Not an error — every diagram starts here, and the editor reads
  // this before the first autosave has run.
  if (!diagram?.canvasJsonPath) {
    return Response.json({ canvas: null });
  }

  let stored: unknown;

  try {
    /*
     * `get` rather than a plain `fetch`: a private blob's URL is not readable
     * without the token, which `get` attaches.
     *
     * `useCache: false` reads origin storage instead of the CDN copy. Every
     * save overwrites the same pathname, so a cached copy here is precisely the
     * stale canvas this restore must not hand back.
     */
    const result = await get(diagram.canvasJsonPath, {
      access: BLOB_ACCESS,
      useCache: false,
    });

    // Only conditional requests produce a 304, and this makes none — the check
    // is what proves `stream` is non-null to the type system.
    if (!result || result.statusCode !== 200) {
      throw new Error(`Blob read returned ${result?.statusCode ?? "nothing"}`);
    }

    stored = await new Response(result.stream).json();
  } catch (error: unknown) {
    console.error(`Canvas download failed for ${diagramId}`, error);
    return jsonError("Could not load the canvas", 502);
  }

  const snapshot = parseCanvasSnapshot(stored);

  if (!snapshot) {
    // The pointer resolves but the contents are not a canvas. Answering 200
    // with `null` would look identical to "never saved" and let an autosave
    // quietly overwrite whatever is really there.
    console.error(`Stored canvas for ${diagramId} is not a valid snapshot`);
    return jsonError("The saved canvas could not be read", 422);
  }

  return Response.json({ canvas: snapshot });
}
