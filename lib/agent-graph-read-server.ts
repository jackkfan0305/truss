import { canvasFingerprint, projectCanvasToAgentGraph } from "@/lib/agent-graph";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { DesignContext } from "@/lib/design-plan";
import type { Authorization } from "@/lib/project-access";
import { jsonError } from "@/lib/project-requests";

export interface AgentGraphReadDependencies {
  authorizeProject: (
    projectId: string,
    options: { requireOwner: true },
  ) => Promise<Authorization>;
  readCanvas: (roomId: string) => Promise<DesignContext>;
}

/**
 * Injectable owner-only live-room read, matching `handleAgentGraphImportPost`
 * and `handleOrchestratePost`.
 *
 * It lives in `lib/` rather than beside the route for the same reason those do:
 * `Authorization` arrives as a *type-only* import, which is erased at compile
 * time, so this module never pulls in `lib/project-access.ts` → `lib/prisma.ts`,
 * whose client is constructed at module load and throws without `DATABASE_URL`.
 * That keeps the handler importable by a unit verification script with no
 * database, while the route binds the real `authorizeProject` statically.
 *
 * The compact view an agent edits against comes from the live Liveblocks room,
 * never `GET /api/projects/:id/canvas`. That route serves the autosaved Vercel
 * Blob snapshot, which lags the room — an edit diffed against it would compute
 * its delta from a canvas that no longer exists.
 */
export async function handleAgentGraphGet(
  projectId: string,
  dependencies: AgentGraphReadDependencies,
): Promise<Response> {
  const access = await dependencies.authorizeProject(projectId, {
    requireOwner: true,
  });

  if (!access.ok) {
    return access.response;
  }

  let context: DesignContext;

  try {
    context = await dependencies.readCanvas(projectId);
  } catch (error: unknown) {
    console.error(`Live canvas read failed for ${projectId}`, error);
    return jsonError("Could not read the canvas", 502);
  }

  // `DesignContext`'s arrays are `readonly`, so they are not assignable to
  // `CanvasSnapshot`'s. Copied here rather than widening `readCanvas`, which the
  // AI tasks depend on unchanged. Shallow is enough: both readers below only
  // read node and edge fields, and the fingerprint sorts its own copy.
  const snapshot: CanvasSnapshot = {
    nodes: [...context.nodes],
    edges: [...context.edges],
  };
  const view = projectCanvasToAgentGraph(snapshot);

  return Response.json({ ...view, fingerprint: canvasFingerprint(snapshot) });
}
