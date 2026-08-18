import { mutateFlow } from "@liveblocks/react-flow/node";

import {
  handleAgentGraphEditPost,
  type AgentGraphEditDependencies,
} from "@/lib/agent-graph-edit-server";
import { clearAiPresence, setAiPresence } from "@/lib/ai-activity";
import { saveCanvasSnapshot } from "@/lib/canvas-persistence";
import { getLiveblocks } from "@/lib/liveblocks";
import { authorizeProject } from "@/lib/project-access";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

// Next.js statically analyzes route segment configs at build time; keep this
// literal here while the shared constant remains available to the verifier.
export const maxDuration = 120;

// Everything but `authorizeProject` is request-independent, so it is built
// once at module scope as before. `authorizeProject` closes over the request
// per call below — it cannot be part of this shared object since it needs a
// different `request` on every invocation.
const sharedDependencies: Omit<AgentGraphEditDependencies, "authorizeProject"> = {
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
  const dependencies: AgentGraphEditDependencies = {
    ...sharedDependencies,
    authorizeProject: (id, options) => authorizeProject(request, id, options),
  };

  return handleAgentGraphEditPost(request, projectId, dependencies);
}
