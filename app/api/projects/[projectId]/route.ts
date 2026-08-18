import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { getLiveblocks } from "@/lib/liveblocks";
import { deleteProjectResources } from "@/lib/project-lifecycle";
import {
  jsonError,
  parseProjectName,
  readJsonBody,
} from "@/lib/project-requests";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

// Both handlers here are owner-only. The gate moved to lib/project-access.ts in
// 09-share-dialog once the collaborator routes needed it too.

export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;
  const access = await authorizeProject(request, projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  return project
    ? Response.json({ project })
    : jsonError("Project not found", 404);
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;

  const access = await authorizeProject(request, projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const name = parseProjectName(await readJsonBody(request), null);

  if (!name) {
    return jsonError("A project name is required", 400);
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: { name },
  });

  return Response.json({ project });
}

export async function DELETE(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;

  const access = await authorizeProject(request, projectId, {
    requireOwner: true,
    allowDeletionStates: true,
  });

  if (!access.ok) {
    return access.response;
  }

  try {
    await deleteProjectResources(
      projectId,
      access.ownerId,
      {
        deleteRoom: async (roomId) => {
          await getLiveblocks().deleteRoom(roomId);
        },
      },
    );
  } catch (error: unknown) {
    console.error(`Project deletion failed for ${projectId}`, error);
    return jsonError("Could not delete project", 500);
  }

  return new Response(null, { status: 204 });
}
