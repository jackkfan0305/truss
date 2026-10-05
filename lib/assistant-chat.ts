import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, RetryError, stepCountIs, streamText, type ModelMessage } from "ai";

import {
  AssistantStopError,
  createAssistantTools,
  type AssistantActions,
} from "@/lib/assistant-tools";

export const MAX_ASSISTANT_STEPS = 8;

export interface AssistantError {
  message: string;
  clearKey: boolean;
}

export type AssistantEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-start"; id: string; label: string }
  | { type: "tool-end"; id: string; ok: boolean; label?: string; href?: string };

const TOOL_LABELS: Record<string, string> = {
  list_diagrams: "Listing diagrams",
  get_diagram: "Reading diagram",
  apply_diagram_edit: "Editing diagram",
  create_diagram: "Creating diagram",
};

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function describeAssistantError(error: unknown): AssistantError | null {
  if (RetryError.isInstance(error)) error = error.lastError;
  if (isAbort(error)) return null;
  if (error instanceof AssistantStopError) return { message: error.message, clearKey: false };
  if (APICallError.isInstance(error)) {
    if (error.statusCode === 401) {
      return { message: "OpenRouter disconnected, connect again.", clearKey: true };
    }
    if (error.statusCode === 402) {
      return { message: "Your OpenRouter account is out of credits.", clearKey: false };
    }
    if (error.statusCode === 429) {
      return {
        message: "Rate limited by OpenRouter. Free models have tight limits, try again or pick a paid model.",
        clearKey: false,
      };
    }
  }
  return { message: "The model call failed. Try again.", clearKey: false };
}

/**
 * The truss-diagram skill's rules, condensed, plus the open diagram so chat
 * answers are about what is on the canvas.
 */
export function buildAssistantInstructions(diagramId: string, current: unknown): string {
  const hasGraph =
    current !== null && typeof current === "object" && "fingerprint" in current;
  return [
    "You are the Truss assistant. You explain and draw system diagrams.",
    "Answer questions about the open diagram from its graph below. Keep replies short. Use concise markdown (short paragraphs, lists, inline code) only when it helps.",
    "To change the open diagram, call apply_diagram_edit with the full desired graph and the fingerprint you read. If it returns a conflict, call get_diagram again and reapply.",
    "To make a new diagram, call create_diagram. Default to an overview of four to eight blocks that explains the main flow. Add detail only when asked.",
    "Omit x and y for new blocks. Keep x and y unchanged for blocks you are not moving.",
    "Ids are lowercase kebab-case. Node labels are at most 80 characters, edge labels at most 40.",
    `The open diagram id is "${diagramId}".`,
    hasGraph
      ? `Its current graph and fingerprint: ${JSON.stringify(current)}`
      : "The open diagram could not be read. Call get_diagram if you need it.",
  ].join("\n");
}

export async function runAssistantTurn(options: {
  apiKey: string;
  modelId: string;
  diagramId: string;
  history: ModelMessage[];
  userText: string;
  actions: AssistantActions;
  signal: AbortSignal;
  onEvent: (event: AssistantEvent) => void;
}): Promise<{ history: ModelMessage[]; error: AssistantError | null }> {
  const userMessage: ModelMessage = { role: "user", content: options.userText };
  const current = await options.actions
    .getDiagram({ diagramId: options.diagramId })
    .catch(() => null);

  // A tool failure that should end the turn aborts the stream itself.
  const controller = new AbortController();
  const stopWithUser = () => controller.abort();
  options.signal.addEventListener("abort", stopWithUser, { once: true });

  const result = streamText({
    model: createOpenRouter({ apiKey: options.apiKey })(options.modelId),
    instructions: buildAssistantInstructions(options.diagramId, current),
    messages: [...options.history, userMessage],
    tools: createAssistantTools(options.actions),
    stopWhen: stepCountIs(MAX_ASSISTANT_STEPS),
    abortSignal: controller.signal,
    maxRetries: 0,
    // The loop below reports every failure; the default handler would also
    // console.error it, which raises the Next.js dev Issues badge.
    onError: () => {},
  });

  let text = "";
  let error: AssistantError | null = null;

  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        text += part.text;
        options.onEvent({ type: "text", text: part.text });
      } else if (part.type === "reasoning-delta") {
        options.onEvent({ type: "reasoning", text: part.text });
      } else if (part.type === "tool-call") {
        options.onEvent({
          type: "tool-start",
          id: part.toolCallId,
          label: TOOL_LABELS[part.toolName] ?? part.toolName,
        });
      } else if (part.type === "tool-result") {
        const output = part.output as { url?: string; error?: string } | undefined;
        const ok = !output?.error;
        // A create whose import failed carries a url too; only a clean result is "Created".
        if (part.toolName === "create_diagram" && ok && output?.url) {
          const title = (part.input as { title?: string }).title ?? "diagram";
          options.onEvent({ type: "tool-end", id: part.toolCallId, ok, label: `Created ${title}`, href: output.url });
        } else {
          options.onEvent({ type: "tool-end", id: part.toolCallId, ok });
        }
      } else if (part.type === "tool-error") {
        options.onEvent({ type: "tool-end", id: part.toolCallId, ok: false });
        if (part.error instanceof AssistantStopError) {
          error = describeAssistantError(part.error);
          controller.abort();
        }
      } else if (part.type === "error") {
        error = describeAssistantError(part.error);
      }
    }
  } catch (caught) {
    error ??= describeAssistantError(caught);
  } finally {
    options.signal.removeEventListener("abort", stopWithUser);
  }

  if (error || controller.signal.aborted) {
    const partial: ModelMessage[] = text ? [{ role: "assistant", content: text }] : [];
    return { history: [...options.history, userMessage, ...partial], error };
  }

  const [response, steps, finishReason] = await Promise.all([
    result.response,
    result.steps,
    result.finishReason,
  ]);
  const hitStepCap = steps.length >= MAX_ASSISTANT_STEPS && finishReason === "tool-calls";
  return {
    history: [...options.history, userMessage, ...response.messages],
    error: hitStepCap ? { message: "Stopped after 8 steps.", clearKey: false } : null,
  };
}
