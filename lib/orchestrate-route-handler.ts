import type { AgentRunStartResult } from "@/lib/agent-run-server";
import type { OrchestrateRequest } from "@/lib/orchestrate-requests";
import { parseOrchestrateRequest } from "@/lib/orchestrate-requests";
import { jsonError, readJsonBody } from "@/lib/project-requests";

type ProjectAccess =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

export interface OrchestratePostDependencies {
  authorizeProject: (
    projectId: string,
    options: { requireOwner: false },
  ) => Promise<ProjectAccess>;
  startAgentRun: (
    request: OrchestrateRequest,
    userId: string,
  ) => Promise<AgentRunStartResult>;
  recordTaskRun: (run: {
    runId: string;
    projectId: string;
    userId: string;
  }) => Promise<void>;
}

/** Injectable route workflow: every public boundary is verifiable without Next. */
export async function handleOrchestratePost(
  request: Request,
  dependencies: OrchestratePostDependencies,
): Promise<Response> {
  const orchestrateRequest = parseOrchestrateRequest(
    await readJsonBody(request),
  );

  if (!orchestrateRequest) {
    return jsonError(
      "A prompt and a matching projectId and roomId are required",
      400,
    );
  }

  const access = await dependencies.authorizeProject(
    orchestrateRequest.projectId,
    { requireOwner: false },
  );

  if (!access.ok) {
    return access.response;
  }

  let start: AgentRunStartResult;

  try {
    start = await dependencies.startAgentRun(
      orchestrateRequest,
      access.userId,
    );
  } catch (error: unknown) {
    console.error(
      `Orchestrator trigger failed for ${orchestrateRequest.projectId}`,
      error,
    );
    return jsonError("Could not start the agent", 502);
  }

  if (start.status === "unverified") {
    return jsonError("The prompt message could not be verified", 400);
  }

  if (start.status === "rate_limited") {
    return Response.json(
      { error: "Too many agent requests. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    await dependencies.recordTaskRun({
      runId: start.runId,
      projectId: orchestrateRequest.projectId,
      userId: access.userId,
    });
  } catch (error: unknown) {
    console.error(`Task run record failed for ${start.runId}`, error);

    return jsonError(
      "The agent started, but this run could not be tracked. The canvas will still update.",
      502,
    );
  }

  return Response.json({ runId: start.runId }, { status: 202 });
}
