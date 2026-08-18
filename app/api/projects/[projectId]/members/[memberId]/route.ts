import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { jsonError } from "@/lib/project-requests";

interface RouteParams {
  params: Promise<{ projectId: string; memberId: string }>;
}

/**
 * Removes a collaborator. The owner is a member of the project but has no
 * `ProjectCollaborator` row, so passing their ID matches nothing and answers
 * 404 — there is no path here that can strip a project of its owner.
 */
export async function DELETE(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId, memberId } = await params;

  const access = await authorizeProject(request, projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  // Scoped by projectId as well as id: without it, an owner of any project
  // could delete a collaborator row belonging to someone else's project.
  const { count } = await prisma.projectCollaborator.deleteMany({
    where: { id: memberId, projectId },
  });

  if (count === 0) {
    return jsonError("Member not found", 404);
  }

  return new Response(null, { status: 204 });
}
