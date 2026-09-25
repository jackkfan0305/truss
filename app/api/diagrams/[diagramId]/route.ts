import { prisma } from "@/lib/prisma";
import { authorizeDiagram } from "@/lib/diagram-access";
import { getLiveblocks } from "@/lib/liveblocks";
import { deleteDiagramResources } from "@/lib/diagram-lifecycle";
import {
  jsonError,
  parseDiagramName,
  readJsonBody,
} from "@/lib/api-requests";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

// Both handlers here are owner-only. The gate moved to lib/diagram-access.ts in
// 09-share-dialog once the collaborator routes needed it too.

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { diagramId } = await params;
  const access = await authorizeDiagram(request, diagramId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const diagram = await prisma.diagram.findUnique({
    where: { id: diagramId },
    select: { id: true, name: true },
  });

  return diagram
    ? Response.json({ diagram })
    : jsonError("Diagram not found", 404);
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { diagramId } = await params;

  const access = await authorizeDiagram(request, diagramId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const name = parseDiagramName(await readJsonBody(request), null);

  if (!name) {
    return jsonError("A diagram name is required", 400);
  }

  const diagram = await prisma.diagram.update({
    where: { id: diagramId },
    data: { name },
  });

  return Response.json({ diagram });
}

export async function DELETE(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { diagramId } = await params;

  const access = await authorizeDiagram(request, diagramId, {
    requireOwner: true,
    allowDeletionStates: true,
  });

  if (!access.ok) {
    return access.response;
  }

  try {
    await deleteDiagramResources(
      diagramId,
      access.ownerId,
      {
        deleteRoom: async (roomId) => {
          await getLiveblocks().deleteRoom(roomId);
        },
      },
    );
  } catch (error: unknown) {
    console.error(`Diagram deletion failed for ${diagramId}`, error);
    return jsonError("Could not delete diagram", 500);
  }

  return new Response(null, { status: 204 });
}
