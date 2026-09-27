import { handleAgentGraphImportPost } from "@/lib/agent-graph-import-server";
import { mutateStoredCanvas } from "@/lib/canvas-persistence";
import { authorizeDiagram } from "@/lib/diagram-access";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;

  return handleAgentGraphImportPost(request, diagramId, {
    // Closes over `request` so a `trs_agent_...` bearer token resolves the
    // same way a browser session does.
    authorizeDiagram: (id) => authorizeDiagram(request, id),
    mutateCanvas: (id, callback) => mutateStoredCanvas(id, callback),
  });
}
