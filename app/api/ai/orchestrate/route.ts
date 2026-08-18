import { tasks } from "@trigger.dev/sdk";

import { consumeAiRequestSlot } from "@/lib/ai-request-rate-limit";
import { startVerifiedAgentRun } from "@/lib/agent-run-server";
import { getLiveblocks } from "@/lib/liveblocks";
import { handleOrchestratePost } from "@/lib/orchestrate-route-handler";
import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import type { orchestrator } from "@/trigger/orchestrator";

/**
 * Starts an orchestrated chat turn (35-orchestrator-backend).
 *
 * The one AI entry point. It replaces `/api/ai/design` and `/api/ai/spec` and
 * keeps their order and rules exactly: the handler does no generation itself —
 * it validates, authorizes, hands the work to Trigger.dev and answers with the
 * run ID. Long-running AI work in a request handler is what
 * `context/architecture-context.md` forbids.
 *
 * `requireOwner: false` for the same reason the canvas routes are: a
 * collaborator edits the canvas, so a collaborator may ask for work on it.
 */
export async function POST(request: Request): Promise<Response> {
  return handleOrchestratePost(request, {
    // Closes over `request` so `OrchestratePostDependencies.authorizeProject`
    // — unaware of bearer tokens — can still reach the real, request-scoped
    // authorization gate without lib/orchestrate-route-handler.ts changing.
    authorizeProject: (projectId, options) =>
      authorizeProject(request, projectId, options),
    startAgentRun: (orchestrateRequest, userId) =>
      startVerifiedAgentRun(orchestrateRequest, userId, {
        readFeedMessages: (params) => getLiveblocks().getFeedMessages(params),
        consumeRequestSlot: consumeAiRequestSlot,
        // Type-only task import keeps the worker bundle out of Next. The global
        // key is built only after the prompt is verified and quota is available.
        trigger: (payload, options) =>
          tasks.trigger<typeof orchestrator>("orchestrator", payload, options),
      }),
    // An idempotent replay returns the original run ID. Upsert makes recording
    // that same ownership fact idempotent too instead of turning a safe retry
    // into a 502 on the unique runId constraint.
    recordTaskRun: async ({ runId, projectId, userId }) => {
      await prisma.taskRun.upsert({
        where: { runId },
        create: { runId, projectId, userId },
        update: {},
      });
    },
  });
}
