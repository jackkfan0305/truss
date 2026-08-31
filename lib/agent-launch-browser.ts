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

export interface AgentLaunchDiagramDependencies {
  fetch: typeof fetch;
  createSuffix: () => string;
  storage: AgentLaunchStorage;
}

const inFlightDiagramLaunches = new Map<string, Promise<AgentLaunchRecord>>();
const DIAGRAM_CREATION_ERROR = "We couldn't create your diagram. Please try again.";

function saveAgentLaunch(
  record: AgentLaunchRecord,
  storage: AgentLaunchStorage,
): AgentLaunchRecord {
  storage.setItem(agentLaunchStorageKey(record.launchId), JSON.stringify(record));
  return record;
}

function failDiagramCreation(
  record: AgentLaunchRecord,
  storage: AgentLaunchStorage,
): AgentLaunchRecord {
  return saveAgentLaunch(
    withAgentLaunchStage(record, "failed", { error: DIAGRAM_CREATION_ERROR }),
    storage,
  );
}

async function readMatchingDiagram(
  response: Response,
  record: AgentLaunchRecord,
): Promise<boolean> {
  if (!response.ok) {
    return false;
  }

  try {
    const body: unknown = await response.json();
    const diagram = (body as { diagram?: { id?: unknown; name?: unknown } })
      .diagram;

    return (
      diagram !== undefined &&
      diagram.id === record.diagramId &&
      diagram.name === record.title
    );
  } catch {
    return false;
  }
}

function createPendingDiagramRecord(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchDiagramDependencies,
): AgentLaunchRecord | null {
  const diagramId =
    record.diagramId ?? buildRoomId(record.title, dependencies.createSuffix());

  if (!diagramId) {
    return null;
  }

  return saveAgentLaunch(
    withAgentLaunchStage(record, "creating-diagram", {
      diagramId,
      error: undefined,
    }),
    dependencies.storage,
  );
}

async function postDiagram(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchDiagramDependencies,
): Promise<Response> {
  return dependencies.fetch("/api/diagrams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: record.diagramId, name: record.title }),
  });
}

function diagramCreated(
  record: AgentLaunchRecord,
  storage: AgentLaunchStorage,
): AgentLaunchRecord {
  return saveAgentLaunch(
    withAgentLaunchStage(record, "diagram-created", { error: undefined }),
    storage,
  );
}

async function recoverPendingDiagram(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchDiagramDependencies,
): Promise<boolean> {
  try {
    const response = await dependencies.fetch(`/api/diagrams/${record.diagramId}`);
    return readMatchingDiagram(response, record);
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
export async function createAgentLaunchDiagram(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchDiagramDependencies,
): Promise<AgentLaunchRecord> {
  let pending = record;

  try {
    const prepared = createPendingDiagramRecord(record, dependencies);

    if (!prepared) {
      return failDiagramCreation(record, dependencies.storage);
    }

    pending = prepared;
    let response: Response;
    try {
      response = await postDiagram(pending, dependencies);
    } catch {
      return (await recoverPendingDiagram(pending, dependencies))
        ? diagramCreated(pending, dependencies.storage)
        : failDiagramCreation(pending, dependencies.storage);
    }

    if (await readMatchingDiagram(response, pending)) {
      return diagramCreated(pending, dependencies.storage);
    }

    if (response.ok) {
      return (await recoverPendingDiagram(pending, dependencies))
        ? diagramCreated(pending, dependencies.storage)
        : failDiagramCreation(pending, dependencies.storage);
    }

    if (response.status !== 409) {
      return failDiagramCreation(pending, dependencies.storage);
    }

    if (await recoverPendingDiagram(pending, dependencies)) {
      return diagramCreated(pending, dependencies.storage);
    }

    const replacementId = buildRoomId(record.title, dependencies.createSuffix());
    if (!replacementId) {
      return failDiagramCreation(pending, dependencies.storage);
    }

    pending = saveAgentLaunch(
      pending.stage === "creating-diagram"
        ? {
            ...pending,
            diagramId: replacementId,
            error: undefined,
            graph: {
              version: pending.graph.version,
              nodes: pending.graph.nodes.map((node) => ({ ...node })),
              edges: pending.graph.edges.map((edge) => ({ ...edge })),
            },
          }
        : withAgentLaunchStage(pending, "creating-diagram", {
            diagramId: replacementId,
            error: undefined,
          }),
      dependencies.storage,
    );
    try {
      response = await postDiagram(pending, dependencies);
    } catch {
      return (await recoverPendingDiagram(pending, dependencies))
        ? diagramCreated(pending, dependencies.storage)
        : failDiagramCreation(pending, dependencies.storage);
    }

    if (await readMatchingDiagram(response, pending)) {
      return diagramCreated(pending, dependencies.storage);
    }

    if (response.ok && (await recoverPendingDiagram(pending, dependencies))) {
      return diagramCreated(pending, dependencies.storage);
    }

    return failDiagramCreation(pending, dependencies.storage);
  } catch {
    return failDiagramCreation(pending, dependencies.storage);
  }
}

export function startAgentLaunchDiagramOnce(
  launchId: string,
  operation: () => Promise<AgentLaunchRecord>,
): Promise<AgentLaunchRecord> {
  const existing = inFlightDiagramLaunches.get(launchId);
  if (existing) {
    return existing;
  }

  const promise = operation();
  inFlightDiagramLaunches.set(launchId, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      inFlightDiagramLaunches.delete(launchId);
    });

  return promise;
}
