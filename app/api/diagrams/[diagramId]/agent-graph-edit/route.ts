import { parseRequestedVersion } from "@/lib/agent-graph-version";
import { handleAgentGraphEditPost } from "@/lib/agent-graph-edit-server";
import { mutateStoredCanvas } from "@/lib/canvas-persistence";
import { authorizeDiagram } from "@/lib/diagram-access";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;

  const version = parseRequestedVersion(request.url);

  return handleAgentGraphEditPost(request, diagramId, {
    // Closes over `request` so a `trs_agent_...` bearer token resolves the
    // same way a browser session does.
    authorizeDiagram: (id) => authorizeDiagram(request, id),
    mutateCanvas: (id, callback) => mutateStoredCanvas(id, callback),
  }, version);
}
