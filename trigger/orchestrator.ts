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
import { runDesign, type DesignRoomReads } from "@/trigger/design-agent";
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
 * `writeSpec` still goes through `triggerAndWait`, which checkpoints the parent:
 * the run transitions to `WAITING`, releases its concurrency slot, and resumes
 * afterwards, potentially on a different machine. An open `streamText` HTTP
 * connection to the provider cannot survive that, so a tool with an `execute`
 * that waits on a child run would die mid-stream.
 *
 * Tools are therefore declared **without `execute`**. Each model call runs to
 * completion and returns either final text or a tool call; the work happens in
 * `runOrchestratorLoop`, outside the stream, and the result is fed back as a
 * tool-result message on the next iteration. Nothing is in flight when the run
 * checkpoints.
 *
 * `designCanvas` is the exception, and calls `runDesign` in this process — the
 * hop was costing about a minute a turn in boot and checkpoint time with no
 * model call in it. The loop shape is unchanged; only where the design runs is.
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
  // spent in `triggerAndWait` — so it covers the model calls, and now the whole
  // inlined design as well: its generation *and* its paced build, whose sleeps
  // are plain timers rather than `wait.for` and so are counted. Sized as the
  // design agent's own 300s plus the routing and closing calls, with slack; a
  // run killed here dies mid-build and leaves a half-drawn canvas.
  maxDuration: 600,
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
        runTool: (call) =>
          runTool(call, {
            payload,
            runId,
            publisher,
            activity,
            reads: { context, history },
          }),
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
  /** This turn's canvas and transcript, so `runDesign` need not re-read them. */
  reads: DesignRoomReads;
}

/**
 * Runs one tool call and turns it into a tool result the model can read.
 *
 * The two branches fail the same way by different means, and either way a
 * failure is a value the model explains rather than a throw that ends the turn.
 * `designCanvas` runs inline, so its failure is caught here. `writeSpec` still
 * goes through `triggerAndWait`, which answers with a `Result` rather than the
 * child's output — hence the `ok` check, and no `.unwrap()`.
 *
 * `generate-spec` is triggered by ID with a type-only import, matching the
 * convention the routes use, so the worker bundles stay separate.
 */
async function runTool(
  call: OrchestratorToolCall,
  { payload, runId, publisher, activity, reads }: ToolRunContext
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

    // Called, not triggered. `triggerAndWait` cost ~27s of child boot plus a
    // checkpoint and restore of this run, none of it model time — see the
    // `runDesign` comment. Inline, the design emits straight into this turn's
    // one activity stream, so there is no second publisher writing a competing
    // snapshot and nothing to replay afterwards. The canvas and history read at
    // the top of this run are handed over rather than fetched again.
    try {
      const output = await runDesign(
        {
          prompt: input.data.instruction,
          promptMessageId: payload.promptMessageId,
          roomId: payload.roomId,
          modelId: payload.modelId,
          thinkingLevel: payload.thinkingLevel,
        },
        { runId, activity, reads }
      );

      return toToolResult(call, describeDesignOutcome({ ok: true, output }));
    } catch (error: unknown) {
      // A failed design is a tool result the model explains, never a failed
      // turn: the user asked for a cache, did not get one, and is owed a
      // sentence saying so.
      logger.warn("Design failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return toToolResult(call, describeDesignOutcome({ ok: false, error }));
    }
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
