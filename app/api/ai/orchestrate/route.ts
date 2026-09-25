import { after } from "next/server";

import { consumeAiRequestSlot } from "@/lib/ai-request-rate-limit";
import { startVerifiedAgentRun } from "@/lib/agent-run-server";
import { getLiveblocks } from "@/lib/liveblocks";
import type { OrchestratorPayload } from "@/lib/orchestrate-requests";
import { handleOrchestratePost } from "@/lib/orchestrate-route-handler";
import { runOrchestrator } from "@/lib/orchestrator";
import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";

/**
 * Sized for the worst case a single turn can reach: a high-thinking design with
 * its paced build, then a spec. A turn cut off here dies mid-build and leaves a
 * half-drawn canvas, so the ceiling is generous rather than tight.
 */
export const maxDuration = 600;

/**
 * Runs an orchestrated chat turn (35-orchestrator-backend).
 *
 * The one AI entry point. It validates, authorizes and verifies the prompt, then
 * runs the orchestrator inside this request and streams its activity back as
 * newline-delimited JSON. The durable record of the turn is the Liveblocks chat
 * row the orchestrator writes, so the stream is only the initiating tab's live
 * view of it.
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
      }),
    // The run ID is derived from the prompt, so a replay collides on the unique
    // `runId` and is refused rather than run twice.
    recordTaskRun: async ({ runId, projectId, userId }) => {
      const { count } = await prisma.taskRun.createMany({
        data: [{ runId, projectId, userId }],
        skipDuplicates: true,
      });

      return count === 1;
    },
    streamRun,
  });
}

function streamRun(payload: OrchestratorPayload, runId: string): Response {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start: (streamController) => {
      controller = streamController;
    },
  });

  const run = runOrchestrator(payload, {
    runId,
    // Throws once the tab has gone; `openActivityStream` stops writing then,
    // and the run finishes for the room regardless.
    write: (part) => controller.enqueue(encoder.encode(`${JSON.stringify(part)}\n`)),
  })
    .catch(() => {
      // Already logged and settled on the chat row by `runOrchestrator`.
    })
    .finally(() => {
      try {
        controller.close();
      } catch {
        // The client cancelled the stream first.
      }
    });

  // Keeps the function alive until the turn ends, even if the tab closes.
  after(() => run);

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Run-Id": runId,
    },
  });
}
