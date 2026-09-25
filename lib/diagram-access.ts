import type { Authorization, Identity } from "@/lib/access";
import { resolveIdentitySource } from "@/lib/agent-identity";
import { isTombstoned, NOT_TOMBSTONED } from "@/lib/diagram-lifecycle";
import { jsonError } from "@/lib/api-requests";
import { prisma } from "@/lib/prisma";
import type { DiagramSummary } from "@/types/diagram";

/**
 * The diagram behind `/editor/[roomId]`, or `null` when this identity does not
 * own it.
 *
 * "Does not exist" and "not yours" collapse into the same `null` on purpose:
 * both render `AccessDenied`, so an outsider cannot probe which IDs are real.
 */
export async function getAccessibleDiagram(
  diagramId: string,
  identity: Identity,
): Promise<DiagramSummary | null> {
  return prisma.diagram.findFirst({
    where: { id: diagramId, ownerId: identity.userId, ...NOT_TOMBSTONED },
    select: { id: true, name: true },
  });
}

/**
 * The single authorization gate for every diagram route handler:
 * 401 unauthenticated, then 404 unknown diagram, then 403 not the owner.
 *
 * Checked before any body is parsed, so a caller without access cannot probe
 * validation behaviour. 404-before-403 leaks whether an ID exists to a
 * signed-in user, which is accepted because diagram IDs are also the public
 * `/editor/[roomId]` segment.
 *
 * Tombstones answer 404 for every caller. The DELETE handler alone opts into
 * them so the owner can retry a deletion.
 */
export async function authorizeDiagram(
  request: Request,
  diagramId: string,
  { allowDeletionStates = false }: { allowDeletionStates?: boolean } = {},
): Promise<Authorization> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { userId } = identitySource;
  const diagram = await prisma.diagram.findUnique({
    where: { id: diagramId },
    select: { ownerId: true, deletingAt: true, deletedAt: true },
  });

  if (!diagram) {
    return { ok: false, response: jsonError("Diagram not found", 404) };
  }

  if (isTombstoned(diagram) && (!allowDeletionStates || diagram.ownerId !== userId)) {
    return { ok: false, response: jsonError("Diagram not found", 404) };
  }

  if (diagram.ownerId !== userId) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return { ok: true, userId };
}
