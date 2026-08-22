import { MAX_DESIGN_ACTIONS, type DesignContext } from "@/lib/design-plan";
import { describeCanvas, formatChatHistory } from "@/lib/canvas-context";
import { DIAGRAM_LEGEND_PROMPT } from "@/lib/diagram-legend";
import type { AiChatMessage } from "@/types/tasks";

/**
 * Everything the design agent tells the model (23-design-agent-logic).
 *
 * Separate from `trigger/design-agent.ts` for the same reason `lib/design-plan.ts`
 * is: this is pure string building with no Liveblocks client and no Trigger.dev
 * runtime, so `scripts/verify-design-agent.ts` can assert on what the model is
 * actually shown. A prompt regression is invisible in review and expensive in
 * production — it costs a whole run to notice.
 *
 * The canvas and history renderings live in `lib/canvas-context.ts`, shared with
 * the orchestrator and the spec writer. Nothing else about this prompt moved:
 * the design agent's brief is unchanged by the routing work.
 *
 * Shape and color meaning live in `lib/diagram-legend.ts`, not here — it is the
 * one legend shared with the external `truss-diagram` skill, so this prompt
 * only injects it.
 */

export const SYSTEM_PROMPT = [
  "You are a systems architect working with a user on a shared, collaborative canvas.",
  "Turn their request into a real architecture diagram — the schema an engineer would",
  "draw before building the system: the components that exist, the data that moves",
  "between them, the stores it lands in, and the boundaries it crosses.",
  "",
  "Design for this user's request specifically, never from a template:",
  "- Name things in the language of their domain. \"Stripe webhook handler\" and",
  "  \"orders table\", not \"Service A\" and \"Database\".",
  "- Use the specifics they gave you. If they named a technology, a stack, an entity",
  "  or a constraint, it belongs in the diagram and in the labels.",
  "- Take it to a level of detail an engineer could build from. A system worth",
  "  diagramming has entry points, the services doing the work, the state it",
  "  persists, and the external systems it depends on — show all four when they",
  "  exist. A three-box sketch is rarely the honest answer.",
  "- Detail means complete, not padded. If the request really is small, keep it small.",
  "",
  "Work the problem before you answer: decide the components and how data flows",
  "between them, then emit the actions.",
  "",
  DIAGRAM_LEGEND_PROMPT,
  "",
  "The app lays the diagram out for you with a deterministic layout pass after",
  "you respond. Choose the components, the connections and the semantics above;",
  "do not reason about coordinates, spacing or overlap — any position you send",
  "is ignored.",
  "",
  "Working with what is already there:",
  "- Prefer editing the existing canvas over rebuilding it. Reuse the node IDs given below.",
  "- The conversation so far, when there is one, is the user refining this diagram.",
  "  Read \"add\", \"change\", \"it\" and \"that\" as referring to what is on the canvas now.",
  "- Give every node a short label. Label edges only when the relationship is not obvious.",
  `- At most ${MAX_DESIGN_ACTIONS} actions in one response; spend them on the request that was made.`,
].join("\n");

/**
 * The full user-side message: what is on the canvas, what has been said, and the
 * request itself — in that order, so the request is the last thing read.
 */
export function buildDesignPrompt(input: {
  context: DesignContext;
  history: readonly AiChatMessage[];
  prompt: string;
}): string {
  return [
    describeCanvas(input.context),
    formatChatHistory(input.history),
    `Request: ${input.prompt}`,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}
