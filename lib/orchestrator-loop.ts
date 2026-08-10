import type { ModelMessage, ToolResultPart } from "ai";

import { MAX_ORCHESTRATOR_STEPS } from "@/lib/orchestrator-prompt";

/**
 * The orchestrator's tool-calling loop, without the runtime (35-orchestrator-backend).
 *
 * Split out of `trigger/orchestrator.ts` for the same reason the prompts are:
 * this is where a turn can silently stop converging, spend an unbounded number
 * of paid model calls, or turn a failed subagent into a failed turn — and none
 * of that is observable from a diff. `scripts/verify-orchestrator.ts` drives it
 * with fake model turns and fake subagent results, which needs a module free of
 * Trigger.dev, Liveblocks and a provider key.
 */

export interface OrchestratorToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** One model call's outcome: what it said, and what it wants run. */
export interface OrchestratorModelTurn {
  text: string;
  toolCalls: OrchestratorToolCall[];
  /** The assistant messages to carry into the next call, tool calls included. */
  responseMessages: ModelMessage[];
}

export interface OrchestratorLoopDependencies {
  callModel: (messages: readonly ModelMessage[]) => Promise<OrchestratorModelTurn>;
  runTool: (call: OrchestratorToolCall) => Promise<ToolResultPart>;
  maxSteps?: number;
}

export interface OrchestratorLoopResult {
  /** The closing message. Never empty — see `FALLBACK_CLOSING`. */
  text: string;
  /** How many model calls the turn actually made. */
  steps: number;
  /** True when the step cap ended the turn rather than the model did. */
  didHitStepCap: boolean;
}

/**
 * Ends a turn that produced tool calls but never a sentence about them. A blank
 * assistant bubble reads as a broken run, and `parseAiChatMessage` drops an
 * empty non-running message outright — so the row would vanish, not just look
 * odd.
 */
export const FALLBACK_CLOSING = "Done.";

/**
 * Runs model calls until one returns no tool call, or the cap is reached.
 *
 * Tools are executed here rather than by the SDK because their writes must stay
 * sequential. Each call's result is appended as a tool message and the loop
 * goes round again, so the model reads what happened before it writes the
 * closing message.
 *
 * `messages` is mutated in place by design: the caller owns the transcript for
 * the turn and there is exactly one loop over it, so copying the array on every
 * step would be allocation without an owner to protect.
 */
export async function runOrchestratorLoop(
  messages: ModelMessage[],
  {
    callModel,
    runTool,
    maxSteps = MAX_ORCHESTRATOR_STEPS,
  }: OrchestratorLoopDependencies
): Promise<OrchestratorLoopResult> {
  let text = "";
  let steps = 0;

  while (steps < maxSteps) {
    const turn = await callModel(messages);

    steps += 1;
    // Kept rather than overwritten by a later empty turn: the model can answer
    // and then take one more step that says nothing, and the answer is what the
    // user is waiting on.
    text = turn.text.trim() || text;
    messages.push(...turn.responseMessages);

    if (turn.toolCalls.length === 0) {
      return { text: text || FALLBACK_CLOSING, steps, didHitStepCap: false };
    }

    const results: ToolResultPart[] = [];

    // One at a time, in the order the model asked for them. The system prompt
    // asks for one tool per step; a model that ignores that still gets
    // serialised rather than racing two writers at the same canvas.
    for (const call of turn.toolCalls) {
      results.push(await runTool(call));
    }

    messages.push({ role: "tool", content: results });
  }

  // Hitting the cap is a normal terminal state, not an error: the work the
  // tools did already happened, and the turn ends with whatever has been said
  // about it rather than with a failed run.
  return { text: text || FALLBACK_CLOSING, steps, didHitStepCap: true };
}

/** A `triggerAndWait` Result, as much of it as this module reads. */
export type SubagentResult<TOutput> =
  | { ok: true; output: TOutput }
  | { ok: false; error?: unknown };

export interface DesignSubagentOutput {
  summary: string;
  applied: number;
}

export interface SpecSubagentOutput {
  specId: string;
  fileName: string;
}

/**
 * Turns a subagent Result into something the model can explain.
 *
 * A failure is a value here, never a throw. The turn is a conversation: a user
 * who asked for a cache and did not get one is owed a sentence saying so, and
 * an exception out of this path would end the run with no message at all.
 *
 * A partial canvas build is reported, never rolled back — `design-agent` writes
 * incrementally, so "the canvas is unchanged" stops being true the moment the
 * first action flushes, and undoing on a shared canvas either clobbers or misses
 * concurrent human edits.
 */
export function describeDesignOutcome(
  result: SubagentResult<DesignSubagentOutput>
): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      error:
        "The canvas edit did not complete. Some of it may already be on the canvas.",
    };
  }

  return {
    ok: true,
    summary: result.output.summary,
    changesApplied: result.output.applied,
  };
}

export function describeSpecOutcome(
  result: SubagentResult<SpecSubagentOutput>
): Record<string, unknown> {
  if (!result.ok) {
    // `generate-spec` throws `AbortTaskRunError` when the canvas and the
    // conversation are both empty. Under the orchestrator that becomes an
    // explanation the user can act on rather than a crashed run.
    return {
      ok: false,
      error:
        "The spec could not be written. There may be nothing on the canvas or in the conversation to write about yet.",
    };
  }

  return { ok: true, fileName: result.output.fileName };
}

/**
 * Reuses the room snapshot already paid for by the router once, then refreshes
 * before every later tool. Tool execution is deliberately sequential, so this
 * small closure is enough to prevent a second design or following spec from
 * seeing the canvas as it existed before the first tool wrote to it.
 */
export function createSequentialReadsProvider<T>(
  initial: T,
  refresh: () => Promise<T>,
): () => Promise<T> {
  let hasProvidedInitial = false;

  return async () => {
    if (!hasProvidedInitial) {
      hasProvidedInitial = true;
      return initial;
    }

    return refresh();
  };
}

/**
 * The ID the `written + 1`th spec of a turn is stored under.
 *
 * A `ProjectSpec` ID is the ID of the run that produced it. Inline that run is
 * the orchestrator's own, so the first spec of a turn keeps exactly the ID it
 * had when `generate-spec` owned a run of its own — and the blob pathname and
 * the row stay keyed on something no other run can produce.
 *
 * A turn can call `writeSpec` more than once, though, and it could not when each
 * call was its own run. A second document reusing the first's ID would overwrite
 * its blob and upsert its row: two specs asked for, one kept, silently. Later
 * writes are suffixed so each is its own document.
 *
 * Only successful writes count, so a retried call after a failure reuses the ID
 * it failed on rather than leaving a gap.
 */
export function specIdForTurn(runId: string, written: number): string {
  return written === 0 ? runId : `${runId}-${written + 1}`;
}

/** Wraps a JSON value as the tool result for one call. */
export function toToolResult(
  call: OrchestratorToolCall,
  value: Record<string, unknown>
): ToolResultPart {
  return {
    type: "tool-result",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: { type: "json", value: value as never },
  };
}
