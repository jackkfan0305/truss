import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { mutateFlow } from "@liveblocks/react-flow/node";
import { logger, streams, task } from "@trigger.dev/sdk";
import { generateObject, jsonSchema } from "ai";

import {
  clearAiPresence,
  publishAiChatSummary,
  publishAiStatus,
  setAiPresence,
} from "@/lib/ai-activity";
import {
  DESIGN_ACTION_TYPES,
  MAX_DESIGN_ACTIONS,
  MIN_NODE_GAP,
  NODE_COLOR_NAMES,
  applyDesignPlan,
  describeDesignAction,
  getPlanFocus,
  parseDesignPlan,
  type DesignContext,
} from "@/lib/design-plan";
import { getGoogleApiKey } from "@/lib/google-ai";
import { getLiveblocks } from "@/lib/liveblocks";
import {
  NODE_DEFAULT_SIZES,
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";
import {
  AI_ACTIVITY_STREAM_ID,
  DEFAULT_AI_DESIGN_MODEL_ID,
  parseAiDesignModelId,
  type AiActivityPart,
  type AiActivityTerminalPart,
} from "@/types/tasks";

/**
 * The payload `POST /api/ai/design` sends. `roomId` is the Liveblocks room the
 * generated nodes and edges are written into — which is also the project ID
 * (lib/room-id.ts), so the route validates the two agree before triggering.
 */
export interface DesignAgentPayload {
  prompt: string;
  roomId: string;
  /**
   * Which model to design with, chosen in the composer. Optional so a run
   * triggered without one (an older caller, a dashboard replay) still works.
   * Re-validated here rather than trusted: the route checks it, but a task
   * payload is not only ever written by that route.
   */
  modelId?: string;
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

const SYSTEM_PROMPT = [
  "You are a systems architect editing a shared diagram on a collaborative canvas.",
  "Return a list of canvas actions that satisfies the user's request, and a one-sentence summary.",
  "",
  "Node shapes carry meaning — use them:",
  "- rectangle: general component",
  "- diamond: decision or gateway",
  "- circle: event or endpoint",
  "- pill: service or process",
  "- cylinder: database or storage",
  "- hexagon: external system or boundary",
  "",
  `Colors are limited to: ${NODE_COLOR_NAMES.join(", ")}. Use them semantically`,
  "(for example teal for data stores, blue for services, orange for external systems),",
  "not decoratively. Use neutral when nothing else applies.",
  "",
  "Layout rules:",
  `- Position nodes on a grid with at least ${MIN_NODE_GAP} units of clear space between them.`,
  "- Lay flows left to right, or top to bottom, consistently.",
  `- Default sizes: ${Object.entries(NODE_DEFAULT_SIZES)
    .map(([shape, size]) => `${shape} ${size.width}x${size.height}`)
    .join(", ")}.`,
  "- Never place a new node on top of an existing one.",
  "",
  "Prefer editing what is already on the canvas over rebuilding it.",
  "Give every node a short label. Label edges only when the relationship is not obvious.",
].join("\n");

/** Enough canvas for the model to edit it, capped so a big diagram cannot blow the context. */
const MAX_CONTEXT_ITEMS = 120;

/**
 * Gemini's internal thinking effort. Kept low because a diagram edit is not a
 * maths olympiad and thinking tokens are billed. Thoughts are not requested in
 * the response; the browser receives curated progress summaries instead.
 *
 * `thinkingLevel`, not the `thinkingBudget: 1024` that was here: this model is
 * a Gemini 3, which takes a level. Passing a numeric budget did not clamp
 * thinking — it made generation degenerate, burning ~41k output tokens over
 * ~167s to emit a single malformed action, which is what put runs past
 * `maxDuration` and left the sidebar waiting on a run that never landed.
 */
const THINKING_LEVEL = "low";

/**
 * The run's live activity, as a stream the sidebar subscribes to.
 *
 * A `ReadableStream` handed to `streams.pipe` rather than a chain of
 * `streams.append` calls: phases, summaries, and operations can be enqueued
 * synchronously while the pipe batches transport in the background.
 */
function openActivityStream() {
  let controller!: ReadableStreamDefaultController<
    AiActivityPart | AiActivityTerminalPart
  >;
  let isWritable = true;
  let didClose = false;
  let didLogTransportError = false;

  const { waitUntilComplete } = streams.pipe(
    AI_ACTIVITY_STREAM_ID,
    new ReadableStream<AiActivityPart | AiActivityTerminalPart>({
      start: (streamController) => {
        controller = streamController;
      },
    })
  );

  return {
    // Never throws: activity is commentary, and a closed stream must not be
    // able to fail the canvas write that is the actual work.
    emit: (part: AiActivityPart | AiActivityTerminalPart): void => {
      if (!isWritable) {
        return;
      }

      try {
        controller.enqueue(part);
      } catch (error: unknown) {
        isWritable = false;
        logActivityTransportError(error);
      }
    },
    close: async (): Promise<void> => {
      if (didClose) {
        return;
      }

      didClose = true;
      isWritable = false;

      try {
        controller.close();
      } catch (error: unknown) {
        logActivityTransportError(error);
      }

      try {
        await waitUntilComplete();
      } catch (error: unknown) {
        logActivityTransportError(error);
      }
    },
  };

  function logActivityTransportError(error: unknown): void {
    if (didLogTransportError) {
      return;
    }

    didLogTransportError = true;
    logger.warn("AI activity stream transport failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

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
  maxDuration: 180,
  run: async (payload: DesignAgentPayload, { ctx }) => {
    const { roomId, prompt } = payload;
    const runId = ctx.run.id;
    // An unknown id falls back rather than failing the run: the canvas edit is
    // the work, and refusing to design because a model name was stale would be
    // a worse answer than designing with the default one.
    const parsedModelId = parseAiDesignModelId(payload.modelId);
    const modelId =
      parsedModelId === null || parsedModelId === "invalid"
        ? DEFAULT_AI_DESIGN_MODEL_ID
        : parsedModelId;

    logger.info("Design requested", {
      roomId,
      promptLength: prompt.length,
      modelId,
    });

    const activity = openActivityStream();
    let activityOutcome: AiActivityTerminalPart["phase"] = "error";

    await Promise.all([
      setAiPresence(roomId, { cursor: null, isThinking: true }),
      publishAiStatus(roomId, {
        kind: "design",
        status: "started",
        runId,
        text: "Reading the canvas…",
      }),
    ]);

    try {
      activity.emit({ type: "step", text: "Reading the canvas" });

      const context = await readCanvas(roomId);

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
      activity.emit({
        type: "reasoning",
        text: "I’m mapping the request to components, boundaries, and connections that fit the existing canvas.",
      });

      // `generateObject`, not `streamText` with `Output.object`: nothing here
      // consumes model tokens as they arrive — the sidebar is fed curated
      // activity parts, never raw provider chain of thought — so the streaming
      // variant bought only its partial-JSON repair, which silently truncated
      // the action list to whatever had arrived when it decided to close the
      // object. One request, one complete plan, validated below.
      const { object } = await generateObject({
        model: createGoogleGenerativeAI({ apiKey: getGoogleApiKey() })(modelId),
        schema: designPlanSchema,
        system: SYSTEM_PROMPT,
        prompt: `${describeCanvas(context)}\n\nRequest: ${prompt}`,
        providerOptions: {
          google: {
            thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          },
        },
      });

      activity.emit({ type: "step", text: "Validating the proposed changes" });

      const plan = parseDesignPlan(object, context);

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

        await publishAiChatSummary(
          roomId,
          runId,
          plan.summary || "No canvas changes to make."
        );
        activityOutcome = "complete";
        return { summary: plan.summary, applied: 0 };
      }

      // Park the AI cursor where the work is landing, so collaborators watching
      // the canvas see it happen somewhere rather than nowhere.
      await setAiPresence(roomId, {
        cursor: getPlanFocus(plan),
        isThinking: true,
      });

      activity.emit({ type: "step", text: "Applying to the canvas" });

      // Announced before the write, not during it: the write is one atomic
      // `mutateFlow`, and every action in the plan is already validated, so
      // this is the list that is about to land rather than a guess.
      for (const action of plan.actions) {
        activity.emit({
          type: "action",
          text: action.type,
          detail: describeDesignAction(action),
        });
      }

      await mutateFlow<CanvasNode, CanvasEdge>({ client: getLiveblocks(), roomId }, (flow) =>
        applyDesignPlan(flow, plan)
      );

      await publishAiStatus(roomId, {
        kind: "design",
        status: "complete",
        runId,
        text: plan.summary || `Applied ${plan.actions.length} canvas changes.`,
      });

      await publishAiChatSummary(
        roomId,
        runId,
        plan.summary || `Applied ${plan.actions.length} canvas changes.`
      );

      activityOutcome = "complete";
      return { summary: plan.summary, applied: plan.actions.length };
    } catch (error: unknown) {
      // The canvas is left exactly as it was: the only write is the single
      // `mutateFlow` above, and a failure before it writes nothing.
      logger.error("Design generation failed", {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      });

      await publishAiStatus(roomId, {
        kind: "design",
        status: "error",
        runId,
        text: "Generation failed. The canvas is unchanged.",
      });

      await publishAiChatSummary(
        roomId,
        runId,
        "Generation failed. The canvas is unchanged."
      );

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
 * Reads the diagram without changing it. `mutateFlow` is the read path as well
 * as the write path: it is the only thing that knows how `@liveblocks/react-flow`
 * lays nodes and edges out in Storage, and a callback that mutates nothing
 * flushes nothing.
 */
async function readCanvas(roomId: string): Promise<DesignContext> {
  let context: DesignContext = { nodes: [], edges: [] };

  await mutateFlow<CanvasNode, CanvasEdge>(
    { client: getLiveblocks(), roomId },
    (flow) => {
      context = flow.toJSON();
    }
  );

  return context;
}

/** The canvas as text the model can reason about and address by ID. */
function describeCanvas({ nodes, edges }: DesignContext): string {
  if (nodes.length === 0 && edges.length === 0) {
    return "The canvas is empty.";
  }

  const nodeLines = nodes
    .slice(0, MAX_CONTEXT_ITEMS)
    .map(
      (node) =>
        `- ${node.id} | ${node.data.shape} | ${node.data.color} | "${node.data.label}" | at ${Math.round(node.position.x)},${Math.round(node.position.y)}`
    );

  const edgeLines = edges
    .slice(0, MAX_CONTEXT_ITEMS)
    .map(
      (edge) =>
        `- ${edge.id} | ${edge.source} -> ${edge.target}${edge.data?.label ? ` | "${edge.data.label}"` : ""}`
    );

  return [
    "Current canvas nodes:",
    nodeLines.join("\n") || "- none",
    "",
    "Current canvas edges:",
    edgeLines.join("\n") || "- none",
  ].join("\n");
}
