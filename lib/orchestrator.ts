import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, tool, type ModelMessage, type ToolResultPart } from "ai";
import { z } from "zod";

import { openActivityStream, type ActivityEmitter } from "@/lib/ai-activity-stream";
import {
  createAiRunChatPublisher,
  type AiRunChatPublisher,
} from "@/lib/ai-run-chat";
import {
  readCanvas,
  readChatHistory,
  type RoomReads,
} from "@/lib/canvas-read";
import { getGoogleApiKey } from "@/lib/google-ai";
import {
  describeDesignOutcome,
  describeSpecOutcome,
  createSequentialReadsProvider,
  runOrchestratorLoop,
  specIdForTurn,
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
import type { OrchestratorPayload } from "@/lib/orchestrate-requests";
import { runDesign } from "@/lib/design-agent";
import { runSpec } from "@/lib/generate-spec";
import {
  AI_RUN_STEPS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  type AiActivityPart,
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
 * The only thing the API runs, inside `/api/ai/orchestrate`'s own request. It
 * reads every message, answers general questions itself from the canvas and the
 * conversation, and delegates to a
 * specialist subagent — `design-agent` or `generate-spec` — when the user wants
 * work done. It owns the turn's durable chat row either way, so one prompt
 * produces exactly one assistant message with the subagent's work nested inside.
 *
 * ## Why the work runs in this process
 *
 * `designCanvas` calls `runDesign` and `writeSpec` calls `runSpec`, both here,
 * both with the canvas and transcript this run already read.
 *
 * ## Why a manual loop rather than automatic tool execution
 *
 * It runs tool calls **one at a time, in order**. A user essentially never wants
 * a spec written *while* the canvas is being modified, and both concurrent
 * combinations are unsafe — two designs read the same pre-state and place their
 * nodes on top of each other, and a spec written during a design documents a
 * diagram that is still being drawn. Automatic execution would run a model's
 * parallel tool calls in parallel.
 *
 * So tools are declared **without `execute`**: each model call returns either
 * final text or a tool call, the work happens in `runOrchestratorLoop` outside
 * the stream, and the result is fed back as a tool-result message.
 */
export async function runOrchestrator(
  payload: OrchestratorPayload,
  {
    runId,
    write,
  }: {
    runId: string;
    /** The response stream; see `openActivityStream`. */
    write: (part: AiActivityPart | AiActivityTerminalPart) => void;
  }
): Promise<{ text: string; steps: number }> {
  const { roomId, prompt, promptMessageId } = payload;

  console.info("Orchestration requested", { roomId, promptLength: prompt.length });

  const publisher = createAiRunChatPublisher({ roomId, runId, promptMessageId });
  const activity = openActivityStream(publisher.emit, write);
  let activityOutcome: AiActivityTerminalPart["phase"] = "error";

  await publisher.start();

  try {
    activity.emit({ type: "step", text: AI_RUN_STEPS.readCanvas });

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

    // How many specs this turn has written, so a second one does not overwrite
    // the first — see `specIdForTurn`. A box rather than a counter passed by
    // value because `runTool` is called once per tool call and has to carry
    // the count across them.
    const specsWritten = { count: 0 };
    const getReads = createSequentialReadsProvider(
      { context, history },
      async (): Promise<RoomReads> => ({
        context: await readCanvas(roomId),
        history,
      }),
    );

    const result = await runOrchestratorLoop(messages, {
      callModel: (turnMessages) =>
        callModel(turnMessages, publisher, activity),
      runTool: (call) =>
        runTool(call, {
          payload,
          runId,
          activity,
          getReads,
          specsWritten,
        }),
    });

    if (result.didHitStepCap) {
      console.warn("Orchestration hit the step cap", { roomId, steps: result.steps });
    }

    await publisher.finish("complete", result.text);
    activityOutcome = "complete";

    return { text: result.text, steps: result.steps };
  } catch (error: unknown) {
    console.error("Orchestration failed", {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    });

    await publisher.finish(
      "error",
      "Something went wrong while working on that. Please try again."
    );

    throw error;
  } finally {
    // Runs on the success and failure paths alike, so the browser always
    // learns how the turn ended.
    activity.emit({ type: "terminal", phase: activityOutcome });
  }
}

/** What the tools accept, shared by the declaration and the re-validation. */
const designToolInputSchema = z.object({
  instruction: z
    .string()
    .trim()
    .min(1)
    .describe(
      "A self-contained design brief grounded in the supplied canvas and conversation. Say what to build or change explicitly."
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
 * Declared without `execute` on purpose — see `runOrchestrator`. The model
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
  activity: ActivityEmitter;
  /** Initial room reads once, then a fresh canvas snapshot for each later tool. */
  getReads: () => Promise<RoomReads>;
  /** Mutable: how many specs this turn has written so far. */
  specsWritten: { count: number };
}

/**
 * Runs one tool call and turns it into a tool result the model can read.
 *
 * Both branches run in this process and fail the same way: a thrown error is
 * caught and returned as a value the model explains, never a throw that ends the
 * turn. A user who asked for a cache and did not get one is owed a sentence
 * saying so.
 */
async function runTool(
  call: OrchestratorToolCall,
  { payload, runId, activity, getReads, specsWritten }: ToolRunContext
): Promise<ToolResultPart> {
  if (call.toolName === DESIGN_TOOL_NAME) {
    // Re-validated at this boundary, not trusted: the model chose these
    // arguments, and a malformed one must become an explanation rather than a
    // design with a missing brief.
    const input = designToolInputSchema.safeParse(call.input);

    if (!input.success) {
      return toToolResult(call, {
        ok: false,
        error: "No design instruction was given.",
      });
    }

    activity.emit({ type: "step", text: AI_RUN_STEPS.designCanvas });

    // The design emits straight into this turn's one activity stream, so there
    // is no second publisher writing a competing snapshot. The first tool
    // reuses the room read at the top of this run; later tools refresh the
    // canvas so they observe any preceding design, including a partial build
    // that threw.
    try {
      const reads = await getReads();
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
      console.warn("Design failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return toToolResult(call, describeDesignOutcome({ ok: false, error }));
    }
  }

  if (call.toolName === SPEC_TOOL_NAME) {
    const input = specToolInputSchema.safeParse(call.input);

    if (!input.success) {
      return toToolResult(call, {
        ok: false,
        error: "The spec focus was invalid.",
      });
    }

    activity.emit({ type: "step", text: AI_RUN_STEPS.writeSpec });

    try {
      const reads = await getReads();
      const output = await runSpec(
        {
          projectId: payload.roomId,
          roomId: payload.roomId,
          promptMessageId: payload.promptMessageId,
          chatRunId: runId,
          ...(input.data.focus ? { focus: input.data.focus } : {}),
        },
        { runId, specId: specIdForTurn(runId, specsWritten.count), reads }
      );

      specsWritten.count += 1;

      // The artifact part rides the same durable snapshot as the work log, so
      // the document is reachable from the transcript rather than only from the
      // run's output. `text` is the file name and `detail` the spec ID — see the
      // `artifact` case in `types/tasks.ts`.
      activity.emit({
        type: "artifact",
        text: output.fileName,
        detail: output.specId,
      });

      return toToolResult(call, describeSpecOutcome({ ok: true, output }));
    } catch (error: unknown) {
      // Includes the error an empty canvas raises. Thrown out of
      // here it would abort the whole turn; as a tool result the model can say
      // there is nothing to write about yet.
      console.warn("Spec failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return toToolResult(call, describeSpecOutcome({ ok: false, error }));
    }
  }

  return toToolResult(call, {
    ok: false,
    error: `Unknown tool: ${call.toolName}`,
  });
}
