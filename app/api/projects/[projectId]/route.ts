import { auth } from "@clerk/nextjs/server";

import { prisma } from "@/lib/prisma";
import {
  jsonError,
  parseProjectName,
  readJsonBody,
} from "@/lib/project-requests";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

type OwnerCheck = { ok: true } | { ok: false; response: Response };

/**
 * Every mutation on this route is owner-only, so both handlers run this before
 * touching the record: 401 unauthenticated, 404 unknown project, 403 non-owner.
 */
async function authorizeOwner(projectId: string): Promise<OwnerCheck> {
  const { userId } = await auth();

  if (!userId) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true },
  });

  if (!project) {
    return { ok: false, response: jsonError("Project not found", 404) };
  }

  if (project.ownerId !== userId) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return { ok: true };
}

export async function PATCH(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;

  const owner = await authorizeOwner(projectId);

  if (!owner.ok) {
    return owner.response;
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
  _request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;

  const owner = await authorizeOwner(projectId);

  if (!owner.ok) {
    return owner.response;
  }

  // Collaborators cascade from the schema relation.
  await prisma.project.delete({ where: { id: projectId } });

  return new Response(null, { status: 204 });
}
