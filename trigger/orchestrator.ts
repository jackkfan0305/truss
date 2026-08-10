import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { logger, schemaTask, tasks } from "@trigger.dev/sdk";
import { streamText, tool, type ModelMessage, type ToolResultPart } from "ai";
import { z } from "zod";

import { openActivityStream, type ActivityEmitter } from "@/lib/ai-activity-stream";
import {
  createAiRunChatPublisher,
  type AiRunChatPublisher,
} from "@/lib/ai-run-chat";
import { readCanvas, readChatHistory } from "@/lib/canvas-read";
import { getGoogleApiKey } from "@/lib/google-ai";
import {
  describeDesignOutcome,
  describeSpecOutcome,
  runOrchestratorLoop,
  toToolResult,
  type OrchestratorModelTurn,
  type OrchestratorToolCall,
} from "@/lib/orchestrator-loop";
import {
  DESIGN_TOOL_NAME,
  ORCHESTRATOR_SYSTEM_PROMPT,
  SPEC_TOOL_NAME,
  buildOrchestratorPrompt,
} from "@/lib/orchestrator-prompt";
import {
  orchestratorPayloadSchema,
  type OrchestratorPayload,
} from "@/lib/orchestrate-requests";
import type { designAgent } from "@/trigger/design-agent";
import type { generateSpec } from "@/trigger/generate-spec";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  type AiActivityTerminalPart,
} from "@/types/tasks";

/**
 * The orchestrator's own thinking effort.
 *
 * Not the composer's picker: that configures the *design*, and is forwarded to
 * the design agent untouched. Routing a message and writing two sentences about
 * what happened does not need a knob, and a second picker would be a setting
 * nobody turns.
 */
const ORCHESTRATOR_THINKING_LEVEL = "low";

/**
 * Chat routing (35-orchestrator-backend).
 *
 * The only task the API triggers. It reads every message, answers general
 * questions itself from the canvas and the conversation, and delegates to a
 * specialist subagent — `design-agent` or `generate-spec` — when the user wants
 * work done. It owns the turn's durable chat row either way, so one prompt
 * produces exactly one assistant message with the subagent's work nested inside.
 *
 * ## Why a manual loop rather than automatic tool execution
 *
 * `triggerAndWait` checkpoints the parent: the run transitions to `WAITING`,
 * releases its concurrency slot, and resumes afterwards, potentially on a
 * different machine. An open `streamText` HTTP connection to the provider cannot
 * survive that, so a tool with an `execute` that waits on a child run would die
 * mid-stream.
 *
 * Tools are therefore declared **without `execute`**. Each model call runs to
 * completion and returns either final text or a tool call; the wait happens in
 * `runOrchestratorLoop`, outside the stream, and the result is fed back as a
 * tool-result message on the next iteration. Nothing is in flight when the run
 * checkpoints.
 *
 * ## Why sequential rather than batched
 *
 * `batchTriggerAndWait` is the supported fan-out primitive, and sequential waits
 * that could be batched are normally a defect. Not here: a user essentially never
 * wants a spec written *while* the canvas is being modified, and both concurrent
 * combinations are unsafe — two design runs read the same pre-state and place
 * their nodes on top of each other, and a spec written during a design documents
 * a diagram that is still being drawn.
 */
export const orchestrator = schemaTask({
  id: "orchestrator",
  schema: orchestratorPayloadSchema,
  // Same reasoning as `design-agent`: the loop can cause canvas writes, and a
  // second attempt would regenerate and duplicate them.
  retry: { maxAttempts: 1 },
  // `maxDuration` is compared against CPU time and explicitly excludes time
  // spent in `triggerAndWait`, so this only has to cover the orchestrator's own
  // model calls — not the subagents' 300s each.
  maxDuration: 180,
  run: async (payload, { ctx }) => {
    const { roomId, prompt, promptMessageId } = payload;
    const runId = ctx.run.id;

    logger.info("Orchestration requested", { roomId, promptLength: prompt.length });

    const publisher = createAiRunChatPublisher({ roomId, runId, promptMessageId });
    const activity = openActivityStream(publisher.emit);
    let activityOutcome: AiActivityTerminalPart["phase"] = "error";

    await publisher.start();

    try {
      activity.emit({ type: "step", text: "Reading the canvas" });

      // In parallel: neither read depends on the other, and both are pure reads
      // against the same room. `runId` is this run's own here, which is exactly
      // the row the history must exclude — it is the turn being written.
      const [context, history] = await Promise.all([
        readCanvas(roomId),
        readChatHistory(roomId, promptMessageId, runId),
      ]);

      const messages: ModelMessage[] = [
        {
          role: "user",
          content: buildOrchestratorPrompt({ context, history, prompt }),
        },
      ];

      const result = await runOrchestratorLoop(messages, {
        callModel: (turnMessages) =>
          callModel(turnMessages, publisher, activity),
        runTool: (call) => runTool(call, { payload, runId, publisher, activity }),
      });

      if (result.didHitStepCap) {
        logger.warn("Orchestration hit the step cap", { roomId, steps: result.steps });
      }

      await publisher.finish("complete", result.text);
      activityOutcome = "complete";

      return { text: result.text, steps: result.steps };
    } catch (error: unknown) {
      logger.error("Orchestration failed", {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      });

      await publisher.finish(
        "error",
        "Something went wrong while working on that. Please try again."
      );

      throw error;
    } finally {
      // Runs on the success and failure paths alike — a stream left open keeps
      // the sidebar waiting for chunks that will never come.
      activity.emit({ type: "terminal", phase: activityOutcome });
      await activity.close();
    }
  },
});

/** What the tools accept, shared by the declaration and the re-validation. */
const designToolInputSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1)
    .describe(
      "A self-contained design brief. The design agent cannot see this conversation or the canvas, so say what to build or change in full."
    ),
});

const specToolInputSchema = z.object({
  focus: z
    .string()
    .trim()
    .optional()
    .describe(
      "Optional emphasis for the document. Omit unless the user asked for something specific."
    ),
});

/**
 * Declared without `execute` on purpose — see the task comment. The model
 * returns a tool call, and the loop performs the wait outside the stream.
 */
const ORCHESTRATOR_TOOLS = {
  [DESIGN_TOOL_NAME]: tool({
    description:
      "Change the shared canvas: add, remove, rename, connect, rearrange or recolour nodes, or build a new diagram.",
    inputSchema: designToolInputSchema,
  }),
  [SPEC_TOOL_NAME]: tool({
    description:
      "Write the system on the canvas up as a Markdown technical specification, saved to the project.",
    inputSchema: specToolInputSchema,
  }),
};

/**
 * One model call, streamed.
 *
 * The two delta kinds land in different places, and the distinction is
 * load-bearing. Reasoning deltas become `reasoning` activity parts — the same
 * type the design agent emits — so they render inside the collapsed work-log
 * disclosure. Text deltas are the answer the user is waiting on, so they grow
 * the assistant message's own content instead. Routing the answer through the
 * activity list would print it twice: once as a step, once as the closing line.
 */
async function callModel(
  messages: readonly ModelMessage[],
  publisher: AiRunChatPublisher,
  activity: ActivityEmitter
): Promise<OrchestratorModelTurn> {
  const result = streamText({
    model: createGoogleGenerativeAI({ apiKey: getGoogleApiKey() })(
      DEFAULT_AI_DESIGN_MODEL_ID
    ),
    system: ORCHESTRATOR_SYSTEM_PROMPT,
    messages: [...messages],
    tools: ORCHESTRATOR_TOOLS,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel: ORCHESTRATOR_THINKING_LEVEL,
          includeThoughts: true,
        },
      },
    },
  });

  let text = "";
  const toolCalls: OrchestratorToolCall[] = [];

  // The stream has to be consumed to completion for `responseMessages` to
  // resolve, so this loop is the wait as well as the reader.
  for await (const part of result.fullStream) {
    if (part.type === "reasoning-delta" && part.text.length > 0) {
      activity.emit({ type: "reasoning", text: part.text });
      continue;
    }

    if (part.type === "text-delta" && part.text.length > 0) {
      text += part.text;
      publisher.appendContent(part.text);
      continue;
    }

    if (part.type === "tool-call") {
      toolCalls.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
    }
  }

  return { text, toolCalls, responseMessages: await result.responseMessages };
}

interface ToolRunContext {
  payload: OrchestratorPayload;
  runId: string;
  publisher: AiRunChatPublisher;
  activity: ActivityEmitter;
}

/**
 * Runs one tool call and turns it into a tool result the model can read.
 *
 * `triggerAndWait` answers with a `Result`, not the child's output, so both call
 * sites check `ok` before reading `output`. `.unwrap()` is deliberately not
 * used: a failed subagent has to reach the model as a tool result it can explain,
 * rather than throwing and failing the whole turn.
 *
 * Both subagents are triggered by ID with type-only imports, matching the
 * convention the routes use, so the worker bundles stay separate.
 */
async function runTool(
  call: OrchestratorToolCall,
  { payload, runId, publisher, activity }: ToolRunContext
): Promise<ToolResultPart> {
  if (call.toolName === DESIGN_TOOL_NAME) {
    // Re-validated at this boundary, not trusted: the model chose these
    // arguments, and a malformed one must become an explanation rather than a
    // triggered run with a missing brief.
    const input = designToolInputSchema.safeParse(call.input);

    if (!input.success) {
      return toToolResult(call, {
        ok: false,
        error: "No design instruction was given.",
      });
    }

    activity.emit({ type: "step", text: "Designing the canvas" });
    // Not the debounce: `triggerAndWait` can suspend this run, and a scheduled
    // flush does not fire while it is suspended — the step announcing the
    // subagent would land only after the subagent had finished.
    await publisher.flush();

    const run = await tasks.triggerAndWait<typeof designAgent>("design-agent", {
      prompt: input.data.instruction,
      promptMessageId: payload.promptMessageId,
      roomId: payload.roomId,
      modelId: payload.modelId,
      thinkingLevel: payload.thinkingLevel,
      chatRunId: runId,
    });

    if (run.ok) {
      // The subagent published its work log live into this turn's row while it
      // ran, but from its own snapshot — which this run's next flush overwrites.
      // Replaying it folds the per-action log into the timeline that settles, so
      // the finished turn shows what was drawn, not just that drawing happened.
      for (const part of run.output.activity) {
        activity.emit(part);
      }
    } else {
      logger.warn("Design subagent failed", { error: run.error });
    }

    return toToolResult(call, describeDesignOutcome(run));
  }

  if (call.toolName === SPEC_TOOL_NAME) {
    const input = specToolInputSchema.safeParse(call.input);

    activity.emit({ type: "step", text: "Writing the spec" });
    await publisher.flush();

    const run = await tasks.triggerAndWait<typeof generateSpec>("generate-spec", {
      projectId: payload.roomId,
      roomId: payload.roomId,
      promptMessageId: payload.promptMessageId,
      chatRunId: runId,
      ...(input.success && input.data.focus ? { focus: input.data.focus } : {}),
    });

    if (run.ok) {
      // The artifact part rides the same durable snapshot as the work log, so
      // the document is reachable from the transcript rather than only from the
      // run's output. `text` is the file name and `detail` the spec ID — see the
      // `artifact` case in `types/tasks.ts`.
      activity.emit({
        type: "artifact",
        text: run.output.fileName,
        detail: run.output.specId,
      });
    } else {
      logger.warn("Spec subagent failed", { error: run.error });
    }

    return toToolResult(call, describeSpecOutcome(run));
  }

  return toToolResult(call, {
    ok: false,
    error: `Unknown tool: ${call.toolName}`,
  });
}
