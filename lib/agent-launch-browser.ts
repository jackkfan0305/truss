import {
  agentLaunchStorageKey,
  createAgentLaunchRecord,
  isAgentLaunchId,
  parseAgentLaunchFragment,
  parseAgentLaunchRecord,
  withAgentLaunchStage,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import { buildRoomId } from "@/lib/room-id";

export interface AgentLaunchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AgentLaunchProjectDependencies {
  fetch: typeof fetch;
  createSuffix: () => string;
  storage: AgentLaunchStorage;
}

const inFlightProjectLaunches = new Map<string, Promise<AgentLaunchRecord>>();
const PROJECT_CREATION_ERROR = "We couldn't create your project. Please try again.";

function saveAgentLaunch(
  record: AgentLaunchRecord,
  storage: AgentLaunchStorage,
): AgentLaunchRecord {
  storage.setItem(agentLaunchStorageKey(record.launchId), JSON.stringify(record));
  return record;
}

function failProjectCreation(
  record: AgentLaunchRecord,
  storage: AgentLaunchStorage,
): AgentLaunchRecord {
  return saveAgentLaunch(
    withAgentLaunchStage(record, "failed", { error: PROJECT_CREATION_ERROR }),
    storage,
  );
}

async function readMatchingProject(
  response: Response,
  record: AgentLaunchRecord,
): Promise<boolean> {
  if (!response.ok) {
    return false;
  }

  try {
    const body: unknown = await response.json();
    const project = (body as { project?: { id?: unknown; name?: unknown } })
      .project;

    return (
      project !== undefined &&
      project.id === record.projectId &&
      project.name === record.title
    );
  } catch {
    return false;
  }
}

function createPendingProjectRecord(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchProjectDependencies,
): AgentLaunchRecord | null {
  const projectId =
    record.projectId ?? buildRoomId(record.title, dependencies.createSuffix());

  if (!projectId) {
    return null;
  }

  return saveAgentLaunch(
    withAgentLaunchStage(record, "creating-project", {
      projectId,
      error: undefined,
    }),
    dependencies.storage,
  );
}

async function postProject(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchProjectDependencies,
): Promise<Response> {
  return dependencies.fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: record.projectId, name: record.title }),
  });
}

function projectCreated(
  record: AgentLaunchRecord,
  storage: AgentLaunchStorage,
): AgentLaunchRecord {
  return saveAgentLaunch(
    withAgentLaunchStage(record, "project-created", { error: undefined }),
    storage,
  );
}

async function recoverPendingProject(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchProjectDependencies,
): Promise<boolean> {
  try {
    const response = await dependencies.fetch(`/api/projects/${record.projectId}`);
    return readMatchingProject(response, record);
  } catch {
    return false;
  }
}

/**
 * Captures an unlogged URL fragment before Clerk can redirect. Resume is scoped
 * to one canonical UUID and one tab's session storage record.
 */
export function captureAgentLaunch(
  hash: string,
  resumeLaunchId: string | null,
  storage: AgentLaunchStorage,
  scrubFragment: () => void,
): AgentLaunchRecord | null {
  const payload = parseAgentLaunchFragment(hash);

  if (payload) {
    scrubFragment();
    const record = createAgentLaunchRecord(payload);
    storage.setItem(agentLaunchStorageKey(payload.launchId), JSON.stringify(record));
    return record;
  }

  return resumeLaunchId ? getStoredAgentLaunch(resumeLaunchId, storage) : null;
}

export function getStoredAgentLaunch(
  launchId: string,
  storage: AgentLaunchStorage,
): AgentLaunchRecord | null {
  if (!isAgentLaunchId(launchId)) {
    return null;
  }

  const record = parseAgentLaunchRecord(storage.getItem(agentLaunchStorageKey(launchId)));
  return record?.launchId === launchId ? record : null;
}

/**
 * Creates an ID before posting so a lost response can be recovered through an
 * owner-only read. A real collision gets one fresh ID and one replacement POST.
 */
export async function createAgentLaunchProject(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchProjectDependencies,
): Promise<AgentLaunchRecord> {
  let pending = record;

  try {
    const prepared = createPendingProjectRecord(record, dependencies);

    if (!prepared) {
      return failProjectCreation(record, dependencies.storage);
    }

    pending = prepared;
    let response: Response;
    try {
      response = await postProject(pending, dependencies);
    } catch {
      return (await recoverPendingProject(pending, dependencies))
        ? projectCreated(pending, dependencies.storage)
        : failProjectCreation(pending, dependencies.storage);
    }

    if (await readMatchingProject(response, pending)) {
      return projectCreated(pending, dependencies.storage);
    }

    if (response.ok) {
      return (await recoverPendingProject(pending, dependencies))
        ? projectCreated(pending, dependencies.storage)
        : failProjectCreation(pending, dependencies.storage);
    }

    if (response.status !== 409) {
      return failProjectCreation(pending, dependencies.storage);
    }

    if (await recoverPendingProject(pending, dependencies)) {
      return projectCreated(pending, dependencies.storage);
    }

    const replacementId = buildRoomId(record.title, dependencies.createSuffix());
    if (!replacementId) {
      return failProjectCreation(pending, dependencies.storage);
    }

    pending = saveAgentLaunch(
      withAgentLaunchStage(pending, "creating-project", {
        projectId: replacementId,
        error: undefined,
      }),
      dependencies.storage,
    );
    try {
      response = await postProject(pending, dependencies);
    } catch {
      return (await recoverPendingProject(pending, dependencies))
        ? projectCreated(pending, dependencies.storage)
        : failProjectCreation(pending, dependencies.storage);
    }

    if (await readMatchingProject(response, pending)) {
      return projectCreated(pending, dependencies.storage);
    }

    if (response.ok && (await recoverPendingProject(pending, dependencies))) {
      return projectCreated(pending, dependencies.storage);
    }

    return failProjectCreation(pending, dependencies.storage);
  } catch {
    return failProjectCreation(pending, dependencies.storage);
  }
}

export function startAgentLaunchProjectOnce(
  launchId: string,
  operation: () => Promise<AgentLaunchRecord>,
): Promise<AgentLaunchRecord> {
  const existing = inFlightProjectLaunches.get(launchId);
  if (existing) {
    return existing;
  }

  const promise = operation();
  inFlightProjectLaunches.set(launchId, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      inFlightProjectLaunches.delete(launchId);
    });

  return promise;
}
