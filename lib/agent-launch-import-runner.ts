import {
  withAgentLaunchStage,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";

const IMPORT_FAILURE_MESSAGE =
  "We couldn't import your diagram. Please try again.";

export interface AgentLaunchImportDependencies {
  load: () => AgentLaunchRecord | null;
  save: (record: AgentLaunchRecord) => void;
  remove: () => void;
  importGraph: (
    projectId: string,
    record: Pick<AgentLaunchRecord, "launchId" | "graph">,
  ) => Promise<Response>;
  scrubQuery: () => void;
}

export type AgentLaunchImportResult =
  | { status: "ignored" }
  | { status: "failed"; message: string }
  | { status: "imported" };

function persist(
  record: AgentLaunchRecord,
  stage: AgentLaunchRecord["stage"],
  dependencies: AgentLaunchImportDependencies,
): AgentLaunchRecord {
  const next = withAgentLaunchStage(record, stage, { error: undefined });
  dependencies.save(next);
  return next;
}

function fail(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchImportDependencies,
): AgentLaunchImportResult {
  const failed = withAgentLaunchStage(record, "failed", {
    error: IMPORT_FAILURE_MESSAGE,
  });
  dependencies.save(failed);
  return { status: "failed", message: IMPORT_FAILURE_MESSAGE };
}

function canImport(record: AgentLaunchRecord, roomId: string, launchId: string): boolean {
  return (
    record.launchId === launchId &&
    record.projectId === roomId &&
    Boolean(record.projectId) &&
    (record.stage === "project-created" ||
      record.stage === "importing-graph" ||
      record.stage === "failed")
  );
}

/** Imports the caller-owned graph through the authenticated owner route. */
export async function runAgentLaunchImport(input: {
  launchId: string;
  roomId: string;
  dependencies: AgentLaunchImportDependencies;
}): Promise<AgentLaunchImportResult> {
  const { dependencies, launchId, roomId } = input;
  const loadedRecord = dependencies.load();

  if (!loadedRecord || !canImport(loadedRecord, roomId, launchId)) {
    return { status: "ignored" };
  }

  let record = loadedRecord;

  if (record.stage !== "importing-graph") {
    record = persist(record, "importing-graph", dependencies);
  }

  let response: Response;
  try {
    response = await dependencies.importGraph(roomId, {
      launchId,
      graph: record.graph,
    });
  } catch {
    return fail(record, dependencies);
  }

  if (response.status !== 200) {
    return fail(record, dependencies);
  }

  record = persist(record, "graph-imported", dependencies);
  try {
    dependencies.remove();
  } catch {
    // A successful import is terminal even if tab cleanup is unavailable.
  }
  try {
    dependencies.scrubQuery();
  } catch {
    // A successful import is terminal even if URL cleanup is unavailable.
  }
  return { status: "imported" };
}

const inFlightLaunchImports = new Map<
  string,
  Promise<AgentLaunchImportResult>
>();

/** Shares one in-flight operation across React Strict Mode effect replays. */
export function startAgentLaunchImportOnce(
  launchId: string,
  operation: () => Promise<AgentLaunchImportResult>,
): Promise<AgentLaunchImportResult> {
  const existing = inFlightLaunchImports.get(launchId);
  if (existing) {
    return existing;
  }

  const promise = operation();
  inFlightLaunchImports.set(launchId, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      inFlightLaunchImports.delete(launchId);
    });

  return promise;
}
