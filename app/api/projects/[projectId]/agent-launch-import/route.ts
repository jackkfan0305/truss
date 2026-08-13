import { mutateFlow } from "@liveblocks/react-flow/node";

import {
  handleAgentGraphImportPost,
  type AgentGraphImportDependencies,
} from "@/lib/agent-graph-import-server";
import { AGENT_GRAPH_IMPORT_MAX_DURATION_SECONDS } from "@/lib/agent-graph-import-config";
import { clearAiPresence, setAiPresence } from "@/lib/ai-activity";
import { saveCanvasSnapshot } from "@/lib/canvas-persistence";
import { getLiveblocks } from "@/lib/liveblocks";
import { authorizeProject } from "@/lib/project-access";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

export const maxDuration = AGENT_GRAPH_IMPORT_MAX_DURATION_SECONDS;

const dependencies: AgentGraphImportDependencies = {
  authorizeProject,
  mutateFlow: async (projectId, callback) => {
    await mutateFlow<CanvasNode, CanvasEdge>(
      { client: getLiveblocks(), roomId: projectId },
      callback,
    );
  },
  saveCanvasSnapshot,
  setAiPresence,
  clearAiPresence,
  sleep: (milliseconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
};

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;
  return handleAgentGraphImportPost(request, projectId, dependencies);
}
