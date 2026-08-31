import { jsonError } from "@/lib/api-requests";
import { prisma } from "@/lib/prisma";
import { authorizeStoryboard } from "@/lib/storyboard-access";

interface RouteParams {
  params: Promise<{ storyboardId: string; memberId: string }>;
}

/**
 * Removes a collaborator. The owner is a member of the storyboard but has no
 * `StoryboardCollaborator` row, so passing their ID matches nothing and answers
 * 404 — there is no path here that can strip a storyboard of its owner.
 */
export async function DELETE(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { storyboardId, memberId } = await params;

  const access = await authorizeStoryboard(request, storyboardId, {
    requireOwner: true,
  });

  if (!access.ok) {
    return access.response;
  }

  // Scoped by storyboardId as well as id: without it, an owner of any
  // storyboard could delete a collaborator row belonging to someone else's.
  const { count } = await prisma.storyboardCollaborator.deleteMany({
    where: { id: memberId, storyboardId },
  });

  if (count === 0) {
    return jsonError("Member not found", 404);
  }

  return new Response(null, { status: 204 });
}
