import { canvasFingerprint, canvasToAgentGraph } from "@/lib/agent-graph";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { Authorization } from "@/lib/access";
import { jsonError } from "@/lib/api-requests";
import type { DesignContext } from "@/types/canvas";
import { buildDiagramSpatialContext } from "@/lib/diagram-spatial-context";
import {
  isSupportedGraphVersion,
  NESTED_V1_DETAIL,
  unsupportedGraphVersionResponse,
} from "@/lib/agent-graph-version";

export interface AgentGraphReadDependencies {
  authorizeDiagram: (diagramId: string) => Promise<Authorization>;
  readCanvas: (roomId: string) => Promise<DesignContext>;
}

/**
 * Injectable owner-only live-room read, matching `handleAgentGraphImportPost`.
 *
 * It lives in `lib/` rather than beside the route for the same reason that one does:
 * `Authorization` arrives as a *type-only* import, which is erased at compile
 * time, so this module never pulls in `lib/diagram-access.ts` →
 * `lib/prisma.ts`, whose client is constructed at module load and throws
 * without `DATABASE_URL`. That keeps the handler importable by a unit
 * verification script with no database, while the route binds the real
 * `authorizeDiagram` statically.
 *
 * The compact view comes from the stored snapshot, the same one `agent-graph-edit`
 * diffs and writes against, so the fingerprint it returns is the one an edit is
 * checked against.
 */
export async function handleAgentGraphGet(
  diagramId: string,
  dependencies: AgentGraphReadDependencies,
  version: number = 1,
): Promise<Response> {
  const access = await dependencies.authorizeDiagram(diagramId);

  if (!access.ok) {
    return access.response;
  }

  if (!isSupportedGraphVersion(version)) {
    return unsupportedGraphVersionResponse(400, "Unsupported graph version.");
  }

  let context: DesignContext;

  try {
    context = await dependencies.readCanvas(diagramId);
  } catch (error: unknown) {
    console.error(`Live canvas read failed for ${diagramId}`, error);
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

  // Check if diagram has AWS/nested content and v1 access is attempted
  const hasAwsOrNested = snapshot.nodes.some(
    (node) => node.data?.kind || node.data?.catalogId || node.parentId,
  );

  if (version === 1 && hasAwsOrNested) {
    return unsupportedGraphVersionResponse(409, NESTED_V1_DETAIL);
  }

  const view = canvasToAgentGraph(snapshot, version === 2 ? 2 : 1);
  const spatial = buildDiagramSpatialContext(
    snapshot,
    new Set(view.opaqueNodeIds),
    new Set(view.opaqueEdgeIds),
  );

  return Response.json({
    ...view,
    spatial,
    fingerprint: canvasFingerprint(snapshot),
  });
}
