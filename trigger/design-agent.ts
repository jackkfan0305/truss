import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { mutateFlow } from "@liveblocks/react-flow/node";
import { logger, task } from "@trigger.dev/sdk";
import { Output, jsonSchema, streamText } from "ai";

import {
  clearAiPresence,
  publishAiStatus,
  setAiPresence,
} from "@/lib/ai-activity";
import {
  openActivityStream,
  type ActivityEmitter,
} from "@/lib/ai-activity-stream";
import {
  createAiRunChatPublisher,
  resolveAiChatRunId,
} from "@/lib/ai-run-chat";
import { readCanvas, readChatHistory } from "@/lib/canvas-read";
import {
  DESIGN_ACTION_TYPES,
  MAX_DESIGN_ACTIONS,
  NODE_COLOR_NAMES,
  applyDesignAction,
  createCursorTargets,
  describeDesignAction,
  getPlanFocus,
  parseDesignPlan,
  type DesignContext,
  type DesignPlan,
} from "@/lib/design-plan";
import { SYSTEM_PROMPT, buildDesignPrompt } from "@/lib/design-prompt";
import { getGoogleApiKey } from "@/lib/google-ai";
import { getLiveblocks } from "@/lib/liveblocks";
import {
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";
import {
  AI_CURSOR_ARRIVAL_PAD_MS,
  AI_CURSOR_SWEEP_MS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  getBuildStepMs,
  parseAiDesignModelId,
  parseAiThinkingLevel,
  type AiActivityPart,
  type AiActivityTerminalPart,
  type AiThinkingLevel,
} from "@/types/tasks";

/**
 * The payload the orchestrator's `designCanvas` tool sends. `roomId` is the
 * Liveblocks room the generated nodes and edges are written into — which is also
 * the project ID (lib/room-id.ts), so the route validates the two agree before
 * triggering the orchestrator that triggers this.
 *
 * `prompt` is the orchestrator's own self-contained design brief, not the raw
 * user message: this agent cannot see the conversation the way the orchestrator
 * can, so "add that too" is resolved before it arrives.
 */
export interface DesignAgentPayload {
  prompt: string;
  promptMessageId: string;
  roomId: string;
  /**
   * The run that owns the turn's durable chat row, when this agent is a subagent.
   *
   * One user prompt produces exactly one assistant message, so a delegated run
   * publishes its work log into the *parent's* row rather than opening a second
   * one. Absent when the task is run directly — a dashboard replay still gets
   * its own row, keyed on its own run ID.
   */
  chatRunId?: string;
  /**
   * Which model to design with, chosen in the composer. Optional so a run
   * triggered without one (an older caller, a dashboard replay) still works.
   * Re-validated here rather than trusted: the route checks it, but a task
   * payload is not only ever written by that route.
   */
  modelId?: string;
  /**
   * How hard to think before answering. Optional and re-validated for the same
   * reasons as `modelId`.
   */
  thinkingLevel?: string;
}

/**
 * Flash over pro: a diagram edit is a short structured response.
 *
 * `gemini-2.5-flash` was here and is now closed to new API keys — it still
 * appears in `models.list` but answers 404 on generate, so the listing is not
 * the thing to check when this next expires. Verified against this project's
 * key with structured output and the configured thinking budget together.
 * Provider thoughts stay private; the activity stream carries curated updates.
 */
/**
 * One flat action shape rather than a discriminated union of seven — an `anyOf`
 * over seven variants is where provider-side schema support gets unreliable,
 * and the fields are validated per action type anyway.
 *
 * Every property is `required`, which reads wrong — a `deleteNode` has no shape
 * and an `addNode` has no source — but it is load-bearing. With only `type`
 * required, Gemini's structured output satisfies the schema *minimally*: it
 * returns a single action carrying nothing but `type`, or fields set to `null`,
 * no matter what the prompt asks for. Measured on this project's key: `type`-only
 * required yields 1 action, all-required yields 9 for the same prompt.
 *
 * Actions that genuinely have no value for a field send an empty string or a
 * zero, and `parseDesignPlan` drops those — an empty `source` is not an edge.
 * So the schema is what gets a *complete* response out of the provider, and the
 * parser is still the thing that decides what is valid.
 */
const ACTION_FIELDS = [
  "type",
  "id",
  "label",
  "shape",
  "color",
  "x",
  "y",
  "width",
  "height",
  "source",
  "target",
] as const;

const designPlanSchema = jsonSchema({
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "One short sentence describing what was changed.",
    },
    actions: {
      type: "array",
      description: `Ordered canvas edits, at most ${MAX_DESIGN_ACTIONS}.`,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...DESIGN_ACTION_TYPES] },
          id: {
            type: "string",
            description:
              "For addNode, a short slug naming the new node so later actions can reference it. Otherwise the id of an existing node or edge.",
          },
          label: {
            type: "string",
            description: "Node or edge label. Empty string when it has none.",
          },
          shape: { type: "string", enum: [...NODE_SHAPES] },
          color: { type: "string", enum: [...NODE_COLOR_NAMES] },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          source: {
            type: "string",
            description: "Edge source node id. Empty string on node actions.",
          },
          target: {
            type: "string",
            description: "Edge target node id. Empty string on node actions.",
          },
        },
        required: [...ACTION_FIELDS],
      },
    },
  },
  required: ["summary", "actions"],
});

/**
 * Gemini's internal thinking effort.
 *
 * High, not the `low` this ran on: the work is not "emit some JSON", it is
 * deciding what a system is made of and how it lays out — which components
 * exist, what flows between them, and where each one goes without landing on
 * something already there. At `low` the model reached for the generic shape of a
 * diagram instead of the one that was asked for. Thinking tokens are billed, and
 * this is what they are for.
 *
 * `thinkingLevel`, not a `thinkingBudget: 1024`: this model is a Gemini 3, which
 * takes a level. Passing a numeric budget did not clamp thinking — it made
 * generation degenerate, burning ~41k output tokens over ~167s to emit a single
 * malformed action.
 *
 * The level itself is now a per-prompt choice from the composer
 * (`AI_THINKING_LEVELS`); `high` is only its default, kept because a small edit
 * is the case for turning it down, not the common one.
 */

/**
 * Ask Gemini for its thought summaries, and show them.
 *
 * These are the provider's own summaries of its reasoning, not raw chain of
 * thought — Gemini does not return the latter, and this is the supported way to
 * see anything at all. Worth the extra response bytes: at `high` the thinking
 * *is* the visible wait, and the sidebar was previously filling it with three
 * hardcoded sentences that were the same on every run.
 *
 * Still model output, so still untrusted: `parseAiActivityPart` validates and
 * clamps it on the way in, and the sidebar renders it as text, never as markup.
 */
const INCLUDE_THOUGHTS = true;

/**
 * Design generation (23-design-agent-logic).
 *
 * Reads the room's current diagram, asks Gemini for a set of canvas edits,
 * validates them, and writes them into the same Liveblocks Storage the canvas
 * edits through — so a generated node is indistinguishable from a dragged one.
 * Progress is announced as AI presence plus messages on the room's status feed.
 *
 * Backend code triggers this by ID with a type-only import, never by importing
 * the task instance.
 */
export const designAgent = task({
  id: "design-agent",
  // A canvas write is not safely repeatable: a second attempt regenerates the
  // design and adds a second copy of it. One shot, and a failure is reported to
  // the room rather than retried.
  retry: { maxAttempts: 1 },
  // Room for the three phases that actually take time: a high-thinking
  // generation, and a paced build that spends `AI_BUILD_BUDGET_MS` plus a cursor
  // sweep per action on purpose. A run that overruns this is killed mid-build,
  // which leaves a half-drawn canvas — the expensive failure, so the ceiling is
  // generous rather than tight.
  maxDuration: 300,
  run: async (payload: DesignAgentPayload, { ctx }) => {
    const { roomId, prompt, promptMessageId } = payload;
    const runId = ctx.run.id;
    // An unknown id falls back rather than failing the run: the canvas edit is
    // the work, and refusing to design because a model name was stale would be
    // a worse answer than designing with the default one.
    const parsedModelId = parseAiDesignModelId(payload.modelId);
    const modelId =
      parsedModelId === null || parsedModelId === "invalid"
        ? DEFAULT_AI_DESIGN_MODEL_ID
        : parsedModelId;
    const parsedThinkingLevel = parseAiThinkingLevel(payload.thinkingLevel);
    const thinkingLevel =
      parsedThinkingLevel === null || parsedThinkingLevel === "invalid"
        ? DEFAULT_AI_THINKING_LEVEL
        : parsedThinkingLevel;

    logger.info("Design requested", {
      roomId,
      promptLength: prompt.length,
      modelId,
      thinkingLevel,
    });

    // The turn's chat row belongs to the orchestrator when there is one. Two
    // publishers on one message would each write a *complete* snapshot and
    // clobber the other's activity, so a delegated run only ever emits into the
    // parent's row: it does not open it (`start`) and does not close it
    // (`finish`). The parent writes the closing message and the terminal phase,
    // and replays `activity` from this run's output so the settled snapshot
    // carries the per-action log as well as the routing.
    const isDelegated = Boolean(payload.chatRunId);
    const chatRunId = resolveAiChatRunId(payload.chatRunId, runId);
    const publisher = createAiRunChatPublisher({
      roomId,
      runId: chatRunId,
      promptMessageId,
    });
    // What the parent replays. Reasoning is left out on purpose: it is the
    // largest part of a run by far, it is the first thing the byte budget drops
    // anyway, and a task output is not the place to carry sixteen kilobytes of
    // thought summaries that were already streamed live.
    const replayable: AiActivityPart[] = [];
    const activity = openActivityStream((part) => {
      publisher.emit(part);

      if (part.type !== "reasoning") {
        replayable.push(part);
      }
    });
    let activityOutcome: AiActivityTerminalPart["phase"] = "error";
    // Paced writes flush as they go, so a failure can leave part of the plan on
    // the canvas. Both are read by the error path, so both are declared out
    // here rather than inside the `try` that assigns them.
    let applied = 0;
    let planned = 0;

    if (!isDelegated) {
      await publisher.start();
    }

    await Promise.all([
      setAiPresence(roomId, { cursor: null, isThinking: true }),
      publishAiStatus(roomId, {
        kind: "design",
        status: "started",
        runId,
        text: "Reading the canvas…",
      }),
    ]);

    /**
     * Ends this run's contribution to the chat row.
     *
     * A delegated run only flushes what it has emitted: marking the row
     * complete would settle the parent's turn before the parent has written a
     * word of it. The flush is not optional — a scheduled debounce would not
     * survive this run finishing, and would leave the row on stale activity.
     */
    const settleChatRow = async (
      phase: "complete" | "error",
      text: string
    ): Promise<void> => {
      if (isDelegated) {
        await publisher.flush();
        return;
      }

      await publisher.finish(phase, text);
    };

    try {
      activity.emit({ type: "step", text: "Reading the canvas" });

      // In parallel: neither read depends on the other, and both are pure reads
      // against the same room.
      const [context, history] = await Promise.all([
        readCanvas(roomId),
        readChatHistory(roomId, promptMessageId, chatRunId),
      ]);

      activity.emit({
        type: "reasoning",
        text:
          context.nodes.length === 0
            ? "The canvas is empty, so I’ll build the requested system from a clean layout."
            : `I found ${context.nodes.length} nodes and ${context.edges.length} connections to preserve or extend.`,
      });

      await publishAiStatus(roomId, {
        kind: "design",
        status: "processing",
        runId,
        text: "Designing…",
      });

      activity.emit({ type: "step", text: "Designing" });

      const object = await generateDesign({
        modelId,
        thinkingLevel,
        prompt: buildDesignPrompt({ context, history, prompt }),
        activity,
      });

      activity.emit({ type: "step", text: "Validating the proposed changes" });

      const plan = parseDesignPlan(object, context);

      planned = plan.actions.length;

      logger.info("Design plan parsed", {
        roomId,
        actions: plan.actions.length,
      });

      activity.emit({
        type: "reasoning",
        text:
          plan.actions.length === 0
            ? "The current canvas already satisfies the request; no safe edits are needed."
            : `I validated ${plan.actions.length} canvas changes and will apply them together.`,
      });

      if (plan.actions.length === 0) {
        await publishAiStatus(roomId, {
          kind: "design",
          status: "complete",
          runId,
          text: "No canvas changes to make.",
        });

        await settleChatRow("complete", plan.summary || "No canvas changes to make.");
        activityOutcome = "complete";
        return { summary: plan.summary, applied: 0, activity: replayable };
      }

      // Park the AI cursor where the work is landing, so collaborators watching
      // the canvas see it happen somewhere rather than nowhere.
      await setAiPresence(roomId, {
        cursor: getPlanFocus(plan),
        isThinking: true,
      });

      activity.emit({ type: "step", text: "Applying to the canvas" });

      applied = await buildCanvas(roomId, plan, context, activity);

      await publishAiStatus(roomId, {
        kind: "design",
        status: "complete",
        runId,
        text: plan.summary || `Applied ${plan.actions.length} canvas changes.`,
      });

      await settleChatRow(
        "complete",
        plan.summary || `Applied ${plan.actions.length} canvas changes.`
      );

      activityOutcome = "complete";
      return { summary: plan.summary, applied, activity: replayable };
    } catch (error: unknown) {
      logger.error("Design generation failed", {
        roomId,
        applied,
        error: error instanceof Error ? error.message : String(error),
      });

      // The build writes incrementally, so "the canvas is unchanged" stops
      // being true the moment the first action flushes. Report what landed.
      const failureText =
        applied === 0
          ? "Generation failed. The canvas is unchanged."
          : `Generation failed partway. ${applied} of ${planned} changes were applied.`;

      await publishAiStatus(roomId, {
        kind: "design",
        status: "error",
        runId,
        text: failureText,
      });

      await settleChatRow("error", failureText);

      throw error;
    } finally {
      // Runs on the success and failure paths alike — a ghost AI avatar left
      // thinking forever is worse than no avatar at all, and a stream left open
      // keeps the sidebar waiting for chunks that will never come.
      activity.emit({ type: "terminal", phase: activityOutcome });
      await Promise.all([clearAiPresence(roomId), activity.close()]);
    }
  },
});

/**
 * Asks for the plan, and forwards the model's thinking to the sidebar while it
 * is still thinking.
 *
 * `streamText` with `Output.object`, not `generateObject`: reasoning only exists
 * on a stream, and showing it *after* the wait it explains is not showing it.
 * The trap `generateObject` was picked to avoid is still avoided — the plan is
 * read from `result.output`, which parses the complete response once the stream
 * ends. `partialOutputStream` is the thing that truncates an action list
 * mid-array, and nothing here reads it.
 *
 * Deltas are emitted as they land rather than buffered into sentences:
 * `appendAiActivityTimelinePart` already concatenates adjacent reasoning parts
 * into one disclosure, so the sidebar renders a growing paragraph, and
 * `streams.pipe` batches the transport underneath.
 */
async function generateDesign({
  modelId,
  thinkingLevel,
  prompt,
  activity,
}: {
  modelId: string;
  thinkingLevel: AiThinkingLevel;
  prompt: string;
  activity: ActivityEmitter;
}): Promise<unknown> {
  const result = streamText({
    model: createGoogleGenerativeAI({ apiKey: getGoogleApiKey() })(modelId),
    output: Output.object({ schema: designPlanSchema }),
    system: SYSTEM_PROMPT,
    prompt,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingLevel,
          includeThoughts: INCLUDE_THOUGHTS,
        },
      },
    },
  });

  let thoughts = 0;

  // The stream has to be consumed to completion for `output` to resolve.
  for await (const part of result.fullStream) {
    if (part.type === "reasoning-delta" && part.text.length > 0) {
      activity.emit({ type: "reasoning", text: part.text });
      thoughts += 1;
    }
  }

  // Not an error: whether thought summaries come back is the provider's call,
  // and a plan without them is still a plan. Logged because a run that silently
  // stops narrating looks like a broken sidebar from the outside.
  if (thoughts === 0) {
    logger.info("No thought summaries returned for this run", {
      modelId,
      thinkingLevel,
    });
  }

  return result.output;
}

/**
 * Applies the plan at a watchable pace, with the AI cursor arriving before each
 * change lands (32-live-canvas-building).
 *
 * One `mutateFlow`, not one per action. `Liveblocks.mutateStorage` fetches
 * Storage once and then flushes buffered ops on a 200ms debounce *while the
 * callback is still running*, and `mutateFlow` awaits its callback inside that —
 * so sleeping between actions broadcasts them incrementally off a single fetch.
 * A call per action would re-fetch the whole document every time, which is
 * O(n²) transfer as the diagram grows, for the same thing on screen.
 *
 * Returns how many actions actually landed, which on the failure path is what
 * tells the room how much of the plan is sitting on the canvas.
 */
async function buildCanvas(
  roomId: string,
  plan: DesignPlan,
  context: DesignContext,
  activity: ActivityEmitter
): Promise<number> {
  const stepMs = getBuildStepMs(plan.actions.length);
  const cursor = createCursorTargets(context);
  let applied = 0;

  await mutateFlow<CanvasNode, CanvasEdge>(
    { client: getLiveblocks(), roomId },
    async (flow) => {
      for (const action of plan.actions) {
        const target = cursor.next(action);

        if (target) {
          // Not awaited: presence is commentary on a canvas write, and a slow
          // or failed presence call must not stall the work itself. The sweep
          // below is the wait that matters.
          void setAiPresence(roomId, { cursor: target, isThinking: true });
          await sleep(AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS);
        }

        applyDesignAction(flow, action);

        // Emitted with the write rather than ahead of the whole batch, so the
        // sidebar list and the canvas describe the same moment.
        activity.emit({
          type: "action",
          text: action.type,
          detail: describeDesignAction(action),
        });

        applied += 1;

        await sleep(stepMs);
      }
    }
  );

  return applied;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
