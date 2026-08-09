import { tasks } from "@trigger.dev/sdk";

import { parseDesignRequest } from "@/lib/design-requests";
import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";
import type { designAgent } from "@/trigger/design-agent";

/**
 * Starts a design generation run (22-design-agent-api).
 *
 * The handler does no generation itself — it validates, authorizes, hands the
 * work to Trigger.dev and answers with the run ID. Long-running AI work in a
 * request handler is exactly what `context/architecture-context.md` forbids.
 *
 * `requireOwner: false` for the same reason the canvas routes are: a
 * collaborator edits the canvas, so a collaborator may ask for a design.
 */
export async function POST(request: Request): Promise<Response> {
  // Parsed before authorizing, unlike the project routes: the project to
  // authorize against is in the body, not the path. Parsing is pure and has no
  // side effects, so nothing is spent on an unauthorized caller.
  const designRequest = parseDesignRequest(await readJsonBody(request));

  if (!designRequest) {
    return jsonError("A prompt and a matching projectId and roomId are required", 400);
  }

  const access = await authorizeProject(designRequest.projectId, {
    requireOwner: false,
  });

  if (!access.ok) {
    return access.response;
  }

  let runId: string;

  try {
    // Type-only import plus trigger-by-ID: importing the task instance would
    // pull the Trigger.dev worker bundle into the Next.js server bundle.
    const handle = await tasks.trigger<typeof designAgent>("design-agent", {
      prompt: designRequest.prompt,
      roomId: designRequest.roomId,
      modelId: designRequest.modelId,
      thinkingLevel: designRequest.thinkingLevel,
    });

    runId = handle.id;
  } catch (error: unknown) {
    console.error(`Design trigger failed for ${designRequest.projectId}`, error);
    return jsonError("Could not start design generation", 502);
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
        projectId: designRequest.projectId,
        userId: access.userId,
      },
    });
  } catch (error: unknown) {
    console.error(`Task run record failed for ${runId}`, error);

    return jsonError(
      "Generation started, but this run could not be tracked. The canvas will still update.",
      502
    );
  }

  return Response.json({ runId }, { status: 202 });
}
