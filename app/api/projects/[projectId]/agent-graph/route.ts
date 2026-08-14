import { handleAgentGraphGet } from "@/lib/agent-graph-read-server";
import { readCanvas } from "@/lib/canvas-read";
import { authorizeProject } from "@/lib/project-access";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/** Owner-only, matching the apply route: a read a collaborator could take but
 * not act on is only an information leak. */
export async function GET(
  _request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;

  return handleAgentGraphGet(projectId, { authorizeProject, readCanvas });
}
