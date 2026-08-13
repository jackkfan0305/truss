import type { AgentRunOptions } from "@/hooks/use-agent-run";
import {
  withAgentLaunchStage,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import type {
  AiPromptSubmissionOptions,
  AiPromptSubmissionResult,
} from "@/lib/ai-prompt-submission";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
} from "@/types/tasks";

export interface AgentLaunchPromptDependencies {
  load: () => AgentLaunchRecord | null;
  save: (record: AgentLaunchRecord) => void;
  remove: () => void;
  submit: (
    text: string,
    runOptions: AgentRunOptions,
    options: AiPromptSubmissionOptions,
  ) => Promise<AiPromptSubmissionResult>;
  scrubQuery: () => void;
}

export type AgentLaunchPromptResult =
  | { status: "ignored" }
  | { status: "failed"; message: string }
  | { status: "started"; runId: string };

const PROMPT_FAILURE_MESSAGE = "We couldn't send your request. Please try again.";
const RUN_FAILURE_MESSAGE =
  "We couldn't start diagram generation. Please try again.";
const DEFAULT_RUN_OPTIONS: AgentRunOptions = {
  modelId: DEFAULT_AI_DESIGN_MODEL_ID,
  thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
};

const inFlightLaunchPrompts = new Map<
  string,
  Promise<AgentLaunchPromptResult>
>();

function persist(
  record: AgentLaunchRecord,
  stage: AgentLaunchRecord["stage"],
  dependencies: AgentLaunchPromptDependencies,
  fields?: Pick<AgentLaunchRecord, "promptMessageId" | "error">,
): AgentLaunchRecord {
  const next = withAgentLaunchStage(record, stage, fields);
  dependencies.save(next);
  return next;
}

function fail(
  record: AgentLaunchRecord,
  message: string,
  dependencies: AgentLaunchPromptDependencies,
): AgentLaunchPromptResult {
  persist(record, "failed", dependencies, { error: message });
  return { status: "failed", message };
}

function isResumable(record: AgentLaunchRecord): boolean {
  return (
    record.stage === "project-created" ||
    record.stage === "sending-prompt" ||
    record.stage === "prompt-sent" ||
    record.stage === "starting-run" ||
    record.stage === "failed"
  );
}

/**
 * Takes the durable launch handoff through chat and the existing idempotent
 * run controller. The launch description is used only as the chat body and
 * never appears in URLs, logs, or visible editor state.
 */
export async function runAgentLaunchPrompt(input: {
  launchId: string;
  roomId: string;
  dependencies: AgentLaunchPromptDependencies;
}): Promise<AgentLaunchPromptResult> {
  const { dependencies, launchId, roomId } = input;
  const loadedRecord = dependencies.load();

  if (
    !loadedRecord ||
    loadedRecord.launchId !== launchId ||
    loadedRecord.projectId !== roomId ||
    loadedRecord.stage === "run-started" ||
    !isResumable(loadedRecord)
  ) {
    return { status: "ignored" };
  }

  let record: AgentLaunchRecord = loadedRecord;

  try {
    if (record.promptMessageId) {
      if (record.stage !== "starting-run") {
        record = persist(record, "starting-run", dependencies, {
          promptMessageId: record.promptMessageId,
          error: undefined,
        });
      }
    } else if (record.stage !== "sending-prompt") {
      record = persist(record, "sending-prompt", dependencies, {
        error: undefined,
      });
    }

    const result = await dependencies.submit(record.description, DEFAULT_RUN_OPTIONS, {
      launchId,
      ...(record.promptMessageId
        ? { promptMessageId: record.promptMessageId }
        : {}),
      onPromptSent: (promptMessageId) => {
        if (record.stage !== "prompt-sent") {
          record = persist(record, "prompt-sent", dependencies, {
            promptMessageId,
            error: undefined,
          });
        }
      },
      onRunStarting: (promptMessageId) => {
        if (record.stage !== "starting-run") {
          record = persist(record, "starting-run", dependencies, {
            promptMessageId,
            error: undefined,
          });
        }
      },
    });

    if (result.status === "message-error") {
      return fail(record, PROMPT_FAILURE_MESSAGE, dependencies);
    }

    if (result.status === "run-error") {
      return fail(record, RUN_FAILURE_MESSAGE, dependencies);
    }

    record = persist(record, "run-started", dependencies, {
      promptMessageId: result.promptMessageId,
      error: undefined,
    });
    dependencies.remove();
    dependencies.scrubQuery();

    return { status: "started", runId: result.subscription.runId };
  } catch {
    return fail(
      record,
      record.promptMessageId ? RUN_FAILURE_MESSAGE : PROMPT_FAILURE_MESSAGE,
      dependencies,
    );
  }
}

/** Shares one in-flight launch operation across Strict Mode effect replays. */
export function startAgentLaunchPromptOnce(
  launchId: string,
  operation: () => Promise<AgentLaunchPromptResult>,
): Promise<AgentLaunchPromptResult> {
  const existing = inFlightLaunchPrompts.get(launchId);
  if (existing) {
    return existing;
  }

  const promise = operation();
  inFlightLaunchPrompts.set(launchId, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      inFlightLaunchPrompts.delete(launchId);
    });

  return promise;
}
