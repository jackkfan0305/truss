import type { ModelMessage } from "ai";

import type { ChatMessage } from "@/components/editor/chat-entry";
import { settleAssistantTurn } from "@/lib/assistant-turn";
import type { KeyValueStorage } from "@/lib/openrouter-auth";

/**
 * The side chat for one diagram, kept in this browser beside the OpenRouter
 * key: the transcript the panel renders, and the model history the next turn
 * sends.
 */
export interface StoredAssistantChat {
  messages: ChatMessage[];
  history: ModelMessage[];
}

const EMPTY: StoredAssistantChat = { messages: [], history: [] };

function storageKey(diagramId: string): string {
  return `truss.assistant.chat.${diagramId}`;
}

export function readAssistantChat(storage: KeyValueStorage, diagramId: string): StoredAssistantChat {
  try {
    const stored = JSON.parse(storage.getItem(storageKey(diagramId)) ?? "null");
    if (!Array.isArray(stored?.messages) || !Array.isArray(stored?.history)) return EMPTY;
    return {
      // A turn still running when the page went away never finishes, so it
      // reads as stopped rather than spinning forever.
      messages: stored.messages.map((message: ChatMessage) =>
        message.role === "assistant" && message.turn.phase === "running"
          ? { ...message, turn: settleAssistantTurn(message.turn, { error: null, aborted: true }) }
          : message
      ),
      history: stored.history,
    };
  } catch {
    return EMPTY;
  }
}

export function writeAssistantChat(
  storage: KeyValueStorage,
  diagramId: string,
  chat: StoredAssistantChat
): void {
  try {
    storage.setItem(storageKey(diagramId), JSON.stringify(chat));
  } catch {
    // ponytail: past the ~5 MB localStorage quota the chat stops saving and
    // the last saved copy stays; trim old turns if long chats hit it.
  }
}
