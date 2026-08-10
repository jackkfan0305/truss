import { auth as clerkAuth } from "@clerk/nextjs/server";
import { auth as triggerAuth } from "@trigger.dev/sdk";

import { parseRunId } from "@/lib/orchestrate-requests";
import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";

/**
 * A public access token is only ever scoped to runs the caller triggered, so it
 * expires on roughly the timescale of a single run rather than a session.
 * `maxDuration` in trigger.config.ts is 3600s, so a shorter window would expire
 * mid-run and drop the client's subscription.
 */
const TOKEN_EXPIRATION = "1h";

/**
 * Issues a Trigger.dev public access token scoped to one run, so the client can
 * subscribe to it in realtime.
 *
 * The `TaskRun` proves this user triggered the run, then current project access
 * is rechecked so a removed collaborator cannot mint a new token later. A
 * collaborator cannot pull another member's generation, and unknown,
 * unauthorized, and revoked runs deliberately collapse into the same 404.
 *
 * `/api/ai/orchestrate/token` is its only caller now that the design and spec
 * routes are gone, and it stays a shared helper because the check is about the
 * run record rather than about what the run does. A per-route copy would be the
 * same code twice with two places to forget the project recheck.
 */
export async function issueRunToken(request: Request): Promise<Response> {
  const runId = parseRunId(await readJsonBody(request));

  if (!runId) {
    return jsonError("A runId is required", 400);
  }

  const { userId } = await clerkAuth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  const taskRun = await prisma.taskRun.findUnique({
    where: { runId },
    select: { userId: true, projectId: true },
  });

  if (!taskRun || taskRun.userId !== userId) {
    return jsonError("Run not found", 404);
  }

  // Run ownership is necessary but not permanent access. Recheck the project
  // so a removed collaborator cannot mint a fresh stream token from an old
  // TaskRun record.
  const projectAccess = await authorizeProject(taskRun.projectId, {
    requireOwner: false,
  });

  if (!projectAccess.ok || projectAccess.userId !== userId) {
    return jsonError("Run not found", 404);
  }

  try {
    const token = await triggerAuth.createPublicToken({
      // Read-only, and one run — a token that could read every run of the task
      // would expose other users' generations.
      scopes: { read: { runs: [runId] } },
      expirationTime: TOKEN_EXPIRATION,
    });

    return Response.json({ token });
  } catch (error: unknown) {
    console.error(`Token creation failed for run ${runId}`, error);
    return jsonError("Could not create a run token", 502);
  }
}
