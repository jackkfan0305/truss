import { tasks } from "@trigger.dev/sdk";

import { startVerifiedAgentRun } from "@/lib/agent-run-server";
import { getLiveblocks } from "@/lib/liveblocks";
import { parseOrchestrateRequest } from "@/lib/orchestrate-requests";
import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";
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
  // Parsed before authorizing, unlike the project routes: the project to
  // authorize against is in the body, not the path. Parsing is pure and has no
  // side effects, so nothing is spent on an unauthorized caller.
  const orchestrateRequest = parseOrchestrateRequest(await readJsonBody(request));

  if (!orchestrateRequest) {
    return jsonError(
      "A prompt and a matching projectId and roomId are required",
      400
    );
  }

  const access = await authorizeProject(orchestrateRequest.projectId, {
    requireOwner: false,
  });

  if (!access.ok) {
    return access.response;
  }

  let runId: string;

  try {
    const verifiedRunId = await startVerifiedAgentRun(
      orchestrateRequest,
      access.userId,
      {
        readFeedMessages: (params) => getLiveblocks().getFeedMessages(params),
        // Type-only import plus trigger-by-ID: importing the task instance
        // would pull the Trigger.dev worker bundle into the Next.js bundle.
        trigger: (payload) =>
          tasks.trigger<typeof orchestrator>("orchestrator", payload),
      },
    );

    if (!verifiedRunId) {
      return jsonError("The prompt message could not be verified", 400);
    }

    runId = verifiedRunId;
  } catch (error: unknown) {
    console.error(
      `Orchestrator trigger failed for ${orchestrateRequest.projectId}`,
      error
    );
    return jsonError("Could not start the agent", 502);
  }

  // Recorded after triggering, because the run ID does not exist before it. A
  // failure here leaves a run with no ownership record, so the token route will
  // refuse it — the safe direction: no token is issued for a run nobody can be
  // shown to own.
  //
  // Handled rather than left to bubble: an unhandled throw here is an opaque 500
  // with nothing in the log, and the run is *already going* — the caller needs to
  // be told the difference between "nothing happened" and "it is running but you
  // cannot watch it".
  try {
    await prisma.taskRun.create({
      data: {
        runId,
        projectId: orchestrateRequest.projectId,
        userId: access.userId,
      },
    });
  } catch (error: unknown) {
    console.error(`Task run record failed for ${runId}`, error);

    return jsonError(
      "The agent started, but this run could not be tracked. The canvas will still update.",
      502
    );
  }

  return Response.json({ runId }, { status: 202 });
}
