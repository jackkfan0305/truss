import {
  MAX_DESIGN_ACTIONS,
  NODE_COLOR_NAMES,
  type DesignContext,
} from "@/lib/design-plan";
import { describeCanvas, formatChatHistory } from "@/lib/canvas-context";
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
 */

export const SYSTEM_PROMPT = [
  "You help people understand a system through a clear pictorial explanation.",
  "Default to a small overview of the main flow, usually four to eight blocks.",
  "Use fewer when that explains the request. Add technical detail only when asked.",
  "This is a preference, not a limit: include every component the user explicitly requests.",
  "",
  "Choose what the reader needs to understand:",
  "- Start with the actor or entry point, show the main steps, and end with the outcome.",
  "- Give each block one clear purpose and a short label in the user's own vocabulary.",
  "- Keep infrastructure and implementation details out of an overview unless needed",
  "  to explain the flow or explicitly requested. Do not invent extra services.",
  "- Use a few words for an edge label, only when the relationship is not obvious.",
  "- Avoid duplicate connections and decorative blocks.",
  "",
  "Shapes convey meaning: rectangle for a step or component, diamond for a decision,",
  "circle for an actor or endpoint, pill for a process, cylinder for storage,",
  "and hexagon for an external system. Prefer rectangles when no special meaning applies.",
  `Colors are limited to: ${NODE_COLOR_NAMES.join(", ")}. Use neutral by default.`,
  "Use color only to distinguish meaningful roles, consistently within the diagram.",
  "",
  "Truss arranges new blocks, routes connections, and places labels automatically.",
  "For addNode, send 0 for x, y, width, and height. Concentrate on the connections.",
  "Emit all new nodes before their edges. Do not emit moveNode or resizeNode for a new node.",
  "",
  "Working with an existing diagram:",
  "- Reuse existing IDs. Change only what the user requests.",
  "- Small edits preserve existing block positions automatically.",
  "- Use moveNode or resizeNode only when the user asks to move or resize an existing block.",
  "  Existing coordinates identify top-left corners; sizes are included in the canvas context.",
  "- Read the conversation to resolve add, change, it, and that against the current diagram.",
  `- At most ${MAX_DESIGN_ACTIONS} actions per response.`,
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
