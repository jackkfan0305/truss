import { handleAgentGraphGet } from "@/lib/agent-graph-read-server";
import { readCanvas } from "@/lib/canvas-read";
import { authorizeDiagram } from "@/lib/diagram-access";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

/** Owner-only, matching the apply route: a read a collaborator could take but
 * not act on is only an information leak. */
export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { diagramId } = await params;

  return handleAgentGraphGet(diagramId, {
    // Closes over `request` so a `trs_agent_...` bearer token resolves the
    // same as the browser session did, without changing
    // AgentGraphReadDependencies' own signature or its verifier.
    authorizeDiagram: (id, options) => authorizeDiagram(request, id, options),
    readCanvas,
  });
}
