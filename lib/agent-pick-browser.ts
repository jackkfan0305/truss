import type { AgentGraphView } from "@/lib/agent-graph";
import {
  AGENT_PICK_PATH,
  AGENT_PICK_QUERY_KEY,
  agentPickStorageKey,
  parseAgentPickFragment,
  type AgentPickPayloadV1,
} from "@/lib/agent-pick";

// Only the two members `captureAgentPick`/`getStoredAgentPick` need, so a
// test can pass a minimal fake without implementing the whole `Storage`
// interface (notably `removeItem`, `length`, `key`, which this module never
// calls).
export type PickStorage = Pick<Storage, "getItem" | "setItem">;

export interface PickProject {
  id: string;
  name: string;
}

export interface AgentPickDependencies {
  fetch: typeof fetch;
  onWaitingForAgent?: () => void;
}

export type AgentPickResult =
  | { kind: "redirect"; projectId: string }
  | { kind: "confirm-delete"; projectId: string; projectName: string }
  | { kind: "failed"; message: string };

export interface RedirectGuard {
  current: boolean;
}

const inFlightPickOperations = new Map<string, Promise<AgentPickResult>>();
const inFlightPickDeletes = new Map<string, Promise<"done" | "failed">>();

// ponytail: `startAgentPickOperationOnce` and the delete guard below are the
// same "share the in-flight promise for this key" shape, so route both
// through one generic instead of copy-pasting the Map bookkeeping twice.
function runOnce<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = operation();
  inFlight.set(key, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      inFlight.delete(key);
    });

  return promise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toPickProjects(value: unknown): PickProject[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const projects: PickProject[] = [];

  for (const item of value) {
    if (isRecord(item) && typeof item.id === "string" && typeof item.name === "string") {
      projects.push({ id: item.id, name: item.name });
    }
  }

  return projects;
}

export function agentPickResumePath(pickId: string): string {
  return `${AGENT_PICK_PATH}?${AGENT_PICK_QUERY_KEY}=${pickId}`;
}

/**
 * Captures the one-shot pick fragment before Clerk's sign-in redirect can
 * discard it, and scrubs it from the URL. Resume after sign-in re-decodes the
 * same raw fragment from session storage rather than persisting a separate
 * record shape — `parseAgentPickFragment` stays the single source of truth
 * for what a valid payload looks like, on capture and on resume alike.
 */
export function captureAgentPick(
  hash: string,
  resumePickId: string | null,
  storage: PickStorage,
  scrubFragment: () => void,
): AgentPickPayloadV1 | null {
  const payload = parseAgentPickFragment(hash);

  if (payload) {
    scrubFragment();
    try {
      storage.setItem(agentPickStorageKey(payload.pickId), hash);
    } catch {
      // Storage can be blocked by quota limits or privacy settings. The
      // fragment is already out of the URL and the payload is already
      // decoded in memory for this call, so a failed resume-copy write is
      // non-fatal: the caller proceeds with `payload`, it just won't survive
      // a sign-in redirect round trip.
    }
    return payload;
  }

  return resumePickId ? getStoredAgentPick(resumePickId, storage) : null;
}

export function getStoredAgentPick(
  pickId: string,
  storage: PickStorage,
): AgentPickPayloadV1 | null {
  let raw: string | null;

  try {
    raw = storage.getItem(agentPickStorageKey(pickId));
  } catch {
    return null;
  }

  if (raw === null) {
    return null;
  }

  const payload = parseAgentPickFragment(raw);
  return payload && payload.pickId === pickId ? payload : null;
}

/**
 * Redirects to sign-in exactly once per mount. The guard lives in the
 * caller so React Strict Mode's double effect invocation — or any other
 * unrelated re-render — cannot fire a second navigation.
 */
export function redirectToSignInOnce(
  guard: RedirectGuard,
  pickId: string,
  redirectToSignIn: (options: { redirectUrl: string }) => void | Promise<unknown>,
): void {
  if (guard.current) {
    return;
  }

  guard.current = true;
  void redirectToSignIn({ redirectUrl: agentPickResumePath(pickId) });
}

export function startAgentPickOperationOnce(
  pickId: string,
  operation: () => Promise<AgentPickResult>,
): Promise<AgentPickResult> {
  return runOnce(inFlightPickOperations, pickId, operation);
}

/**
 * Same re-entrancy rigor as `startAgentPickOperationOnce`: a double-click on
 * Delete before React commits the "working" state must not fire the DELETE
 * request twice. Keyed by project id since a pick session only ever deletes
 * one project.
 */
export function startAgentPickDeleteOnce(
  projectId: string,
  operation: () => Promise<"done" | "failed">,
): Promise<"done" | "failed"> {
  return runOnce(inFlightPickDeletes, projectId, operation);
}

async function agentPickCallback(
  dependencies: AgentPickDependencies,
  port: number,
  nonce: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  dependencies.onWaitingForAgent?.();

  const response = await dependencies.fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, ...body }),
  });

  if (!response.ok) {
    throw new Error("The agent rejected the callback.");
  }

  return response.json();
}

interface AgentGraphRead {
  graph: AgentGraphView["graph"];
  opaqueNodeIds: string[];
  opaqueEdgeIds: string[];
  fingerprint: string;
}

async function fetchAgentGraph(
  projectId: string,
  dependencies: AgentPickDependencies,
): Promise<AgentGraphRead | null> {
  const response = await dependencies.fetch(`/api/projects/${projectId}/agent-graph`);

  if (!response.ok) {
    return null;
  }

  const body: unknown = await response.json();

  if (
    !isRecord(body) ||
    !isRecord(body.graph) ||
    !Array.isArray(body.opaqueNodeIds) ||
    !Array.isArray(body.opaqueEdgeIds) ||
    typeof body.fingerprint !== "string"
  ) {
    return null;
  }

  return {
    graph: body.graph as AgentGraphView["graph"],
    opaqueNodeIds: body.opaqueNodeIds as string[],
    opaqueEdgeIds: body.opaqueEdgeIds as string[],
    fingerprint: body.fingerprint,
  };
}

/**
 * Reads the live graph, asks the agent for the desired graph, and applies it.
 * A stale fingerprint (409) is retried once from a fresh read, matching the
 * one collaborator-collision retry the spec allows before giving up.
 */
async function runEditFlow(
  projectId: string,
  payload: AgentPickPayloadV1,
  dependencies: AgentPickDependencies,
): Promise<AgentPickResult> {
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const read = await fetchAgentGraph(projectId, dependencies);

    if (!read) {
      return { kind: "failed", message: "We couldn't read this diagram. Please try again." };
    }

    const desired = await agentPickCallback(dependencies, payload.port, payload.nonce, {
      projectId,
      graph: read.graph,
      opaqueNodeIds: read.opaqueNodeIds,
      opaqueEdgeIds: read.opaqueEdgeIds,
      fingerprint: read.fingerprint,
    });
    const desiredGraph = isRecord(desired) ? desired.desiredGraph : undefined;

    if (!isRecord(desiredGraph)) {
      return { kind: "failed", message: "The agent didn't return a diagram." };
    }

    const applyResponse = await dependencies.fetch(
      `/api/projects/${projectId}/agent-graph-edit`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint: read.fingerprint, graph: desiredGraph }),
      },
    );

    if (applyResponse.status === 200) {
      return { kind: "redirect", projectId };
    }

    if (applyResponse.status !== 409) {
      return { kind: "failed", message: "We couldn't apply that change. Please try again." };
    }
  }

  return {
    kind: "failed",
    message: "This diagram is being actively edited elsewhere. Please try again in a moment.",
  };
}

/**
 * Runs the shared first exchange — list projects, hand them to the agent,
 * get back the chosen project — then branches: edit continues into the
 * read/apply loop, delete stops and hands the caller a name to confirm.
 * Never sends more than `{id, name}` to the loopback.
 *
 * The agent's chosen `projectId` is only ever trusted if it matches an id we
 * actually listed. Otherwise a malformed or hallucinated response would flow
 * straight into the delete confirmation dialog with a blank project name and
 * a live Delete button next to it — confirming by nothing, which is exactly
 * what "confirm by real name, never by index" rules out.
 */
export async function runAgentPickOperation(
  payload: AgentPickPayloadV1,
  dependencies: AgentPickDependencies,
): Promise<AgentPickResult> {
  try {
    const projectsResponse = await dependencies.fetch("/api/projects");

    if (!projectsResponse.ok) {
      return { kind: "failed", message: "We couldn't read your projects. Please try again." };
    }

    const projectsBody: unknown = await projectsResponse.json();
    const projects = toPickProjects(isRecord(projectsBody) ? projectsBody.projects : undefined);

    const picked = await agentPickCallback(dependencies, payload.port, payload.nonce, {
      op: payload.op,
      projects,
    });
    const pickedProjectId =
      isRecord(picked) && typeof picked.projectId === "string" ? picked.projectId : null;
    const matchedProject = pickedProjectId
      ? projects.find((project) => project.id === pickedProjectId)
      : undefined;

    if (!matchedProject) {
      return { kind: "failed", message: "The agent chose a project we don't recognize." };
    }

    if (payload.op === "delete") {
      return {
        kind: "confirm-delete",
        projectId: matchedProject.id,
        projectName: matchedProject.name,
      };
    }

    return await runEditFlow(matchedProject.id, payload, dependencies);
  } catch {
    return { kind: "failed", message: "We couldn't reach your agent. Please try again." };
  }
}

export async function deleteAgentPickProject(
  projectId: string,
  dependencies: AgentPickDependencies,
): Promise<"done" | "failed"> {
  try {
    const response = await dependencies.fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
    return response.status === 204 ? "done" : "failed";
  } catch {
    return "failed";
  }
}
