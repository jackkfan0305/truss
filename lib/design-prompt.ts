import {
  MAX_DESIGN_ACTIONS,
  MIN_NODE_GAP,
  NODE_COLOR_NAMES,
  toBox,
  type DesignContext,
} from "@/lib/design-plan";
import type { ChatMessage } from "@/lib/ai-chat";
import { EDGE_LABEL_CLEARANCE, NODE_DEFAULT_SIZES } from "@/types/canvas";
import { AI_USER_NAME, type AiChatMessage } from "@/types/tasks";

/**
 * Everything the design agent tells the model (23-design-agent-logic).
 *
 * Separate from `trigger/design-agent.ts` for the same reason `lib/design-plan.ts`
 * is: this is pure string building with no Liveblocks client and no Trigger.dev
 * runtime, so `scripts/verify-design-agent.ts` can assert on what the model is
 * actually shown. A prompt regression is invisible in review and expensive in
 * production — it costs a whole run to notice.
 */

/**
 * How much of the canvas is described. High, because a model that cannot see a
 * node will happily create a second one just like it, and a duplicate on a
 * shared canvas is worse than a long prompt. The cap only exists so a pathological
 * diagram cannot blow the context window — and when it bites, the model is told,
 * rather than being left to believe the canvas ends there.
 */
export const MAX_CONTEXT_ITEMS = 400;

/** Recent turns carried into the next run. Older ones are on the canvas already. */
export const MAX_HISTORY_MESSAGES = 20;

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
  "between them, then place them, then emit the actions.",
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
  "Layout rules — you are placing rectangles, not points, so do the arithmetic:",
  "- A node's x,y is its top-left corner. It occupies x..x+width by y..y+height.",
  `- Unless you give width and height, a node is created at its shape's default size: ${Object.entries(
    NODE_DEFAULT_SIZES
  )
    .map(([shape, size]) => `${shape} ${size.width}x${size.height}`)
    .join(", ")}.`,
  `- Leave at least ${MIN_NODE_GAP} units of clear space between any two node rectangles.`,
  `- An edge's label is drawn as a pill centred on the middle of the edge, so it lands`,
  `  in the space between the two nodes: budget ${EDGE_LABEL_CLEARANCE.width} units across the flow`,
  `  direction and ${EDGE_LABEL_CLEARANCE.height} units across the other one for any edge you label.`,
  "  Two nodes you connect with a labelled edge need that much room between them,",
  "  on top of the minimum gap. Keep edge labels to a few words so they fit.",
  "- Lay flows left to right, or top to bottom, consistently.",
  "- Every existing node is listed below with its position and its size. Nothing you",
  "  add may overlap one of those rectangles.",
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

/** The canvas as text the model can reason about and address by ID. */
export function describeCanvas({ nodes, edges }: DesignContext): string {
  if (nodes.length === 0 && edges.length === 0) {
    return "The canvas is empty.";
  }

  const nodeLines = nodes.slice(0, MAX_CONTEXT_ITEMS).map((node) => {
    const box = toBox(node);

    return `- ${node.id} | ${node.data.shape} | ${node.data.color} | "${node.data.label}" | at ${Math.round(box.x)},${Math.round(box.y)} | ${Math.round(box.width)}x${Math.round(box.height)}`;
  });

  const edgeLines = edges
    .slice(0, MAX_CONTEXT_ITEMS)
    .map(
      (edge) =>
        `- ${edge.id} | ${edge.source} -> ${edge.target}${edge.data?.label ? ` | "${edge.data.label}"` : ""}`
    );

  return [
    "Current canvas nodes:",
    nodeLines.join("\n") || "- none",
    omitted(nodes.length, "nodes"),
    "",
    "Current canvas edges:",
    edgeLines.join("\n") || "- none",
    omitted(edges.length, "edges"),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Prior turns as a transcript, oldest first.
 *
 * `selectDesignChatHistory` removes the current prompt and deterministic run row
 * by ID before formatting. Keeping that boundary separate avoids content-based
 * guesses that would erase a legitimate earlier repeated request.
 *
 * Senders are named because the feed is shared — several collaborators can be
 * asking for different things, and "who wanted that" is part of the context.
 */
export function formatChatHistory(messages: readonly AiChatMessage[]): string {
  if (messages.length === 0) {
    return "";
  }

  return [
    "Conversation so far (oldest first):",
    ...messages
      .slice(-MAX_HISTORY_MESSAGES)
      .map(
        (message) =>
          `- ${message.role === "assistant" ? AI_USER_NAME : message.senderName}: ${message.content}`
      ),
  ].join("\n");
}

/**
 * Removes the two rows that belong to the run being generated. IDs, not prompt
 * text or feed position, distinguish the current request from a legitimate
 * earlier collaborator turn with identical content.
 */
export function selectDesignChatHistory(
  messages: readonly ChatMessage[],
  promptMessageId: string,
  runId: string,
): ChatMessage[] {
  const runMessageId = `chat-${runId}`;

  return messages.filter(
    (message) =>
      message.id !== promptMessageId && message.id !== runMessageId,
  );
}

/** Names the gap when the canvas is bigger than what was listed, or nothing. */
function omitted(total: number, label: string): string | null {
  return total > MAX_CONTEXT_ITEMS
    ? `- (${total - MAX_CONTEXT_ITEMS} more ${label} exist but are not listed here)`
    : null;
}
