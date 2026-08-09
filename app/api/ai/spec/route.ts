import { tasks } from "@trigger.dev/sdk";

import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";
import { specRequestSchema } from "@/lib/spec-requests";
import type { generateSpec } from "@/trigger/generate-spec";

/**
 * Starts a spec generation run (27-spec-generation-flow).
 *
 * Same shape as `/api/ai/design`: validate, authorize, hand the work to
 * Trigger.dev, answer with the run ID. The long-running model call belongs in
 * the task, per the invariants in `context/architecture-context.md`.
 *
 * `requireOwner: false` because a collaborator edits the canvas the spec is
 * written from, so a collaborator may ask for one.
 */
export async function POST(request: Request): Promise<Response> {
  // Parsed before authorizing, unlike the project routes: the project to
  // authorize against comes out of the body, not the path. Parsing is pure, so
  // nothing is spent on an unauthorized caller.
  const parsed = specRequestSchema.safeParse(await readJsonBody(request));

  if (!parsed.success) {
    return jsonError("A roomId and a valid canvas are required", 400);
  }

  const { roomId, chatHistory, nodes, edges } = parsed.data;

  // A room ID *is* its project ID (lib/room-id.ts), so the project is derived
  // here rather than read from the body — a client-supplied `projectId` would
  // be a second answer to a question this request has already answered.
  const access = await authorizeProject(roomId, { requireOwner: false });

  if (!access.ok) {
    return access.response;
  }

  let runId: string;

  try {
    // Type-only import plus trigger-by-ID: importing the task instance would
    // pull the Trigger.dev worker bundle into the Next.js server bundle.
    const handle = await tasks.trigger<typeof generateSpec>("generate-spec", {
      projectId: roomId,
      roomId,
      chatHistory,
      nodes,
      edges,
    });

    runId = handle.id;
  } catch (error: unknown) {
    console.error(`Spec trigger failed for ${roomId}`, error);
    return jsonError("Could not start spec generation", 502);
  }

  // Recorded after triggering, because the run ID does not exist before it. A
  // failure here leaves a run with no ownership record, so the token route will
  // refuse it — the safe direction: no token is issued for a run nobody can be
  // shown to own.
  try {
    await prisma.taskRun.create({
      data: { runId, projectId: roomId, userId: access.userId },
    });
  } catch (error: unknown) {
    console.error(`Task run record failed for ${runId}`, error);

    return jsonError(
      "Spec generation started, but this run could not be tracked.",
      502
    );
  }

  return Response.json({ runId }, { status: 202 });
}
