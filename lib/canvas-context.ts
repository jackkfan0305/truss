import { toBox, type DesignContext } from "@/lib/design-plan";
import type { ChatMessage } from "@/lib/ai-chat";
import { AI_USER_NAME, type AiChatMessage } from "@/types/tasks";

/**
 * The canvas and the conversation, as text a model can reason about.
 *
 * Extracted from `lib/design-prompt.ts` when the orchestrator arrived
 * (35-orchestrator-backend): three prompts now describe the same room — the
 * router, the design agent and the spec writer — and a second rendering of the
 * same diagram is a second thing to keep in step.
 *
 * Pure string building with no Liveblocks client and no Trigger.dev runtime, so
 * the verify scripts can assert on what each model is actually shown. A prompt
 * regression is invisible in review and costs a whole run to notice.
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
 *
 * Under the orchestrator the run row belongs to the *parent* turn, so the ID
 * passed here is the chat run ID rather than a subagent's own run ID.
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
