import assert from "node:assert/strict";

import { readAssistantChat, writeAssistantChat } from "../lib/assistant-history";
import { startAssistantTurn } from "../lib/assistant-turn";
import type { KeyValueStorage } from "../lib/openrouter-auth";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const storage = memoryStorage();
assert.deepEqual(readAssistantChat(storage, "a"), { messages: [], history: [] }, "nothing stored reads empty");

const chat = {
  messages: [
    { id: "user-1", role: "user" as const, content: "hi", sentAt: 1 },
    { id: "assistant-1", role: "assistant" as const, turn: { ...startAssistantTurn(), phase: "complete" as const, text: "hello" }, sentAt: 1 },
  ],
  history: [{ role: "user" as const, content: "hi" }],
};
writeAssistantChat(storage, "a", chat);
assert.deepEqual(readAssistantChat(storage, "a"), chat, "a saved chat reads back");
assert.deepEqual(readAssistantChat(storage, "b").messages, [], "chats are per diagram");

writeAssistantChat(storage, "c", {
  messages: [{ id: "assistant-2", role: "assistant", turn: startAssistantTurn(), sentAt: 2 }],
  history: [],
});
const restored = readAssistantChat(storage, "c").messages[0];
assert.ok(restored.role === "assistant" && restored.turn.phase === "incomplete", "an interrupted turn reads as stopped");

storage.setItem("truss.assistant.chat.d", "{not json");
assert.deepEqual(readAssistantChat(storage, "d").messages, [], "a corrupt entry reads empty");

const full: KeyValueStorage = { ...memoryStorage(), setItem: () => { throw new Error("QuotaExceededError"); } };
assert.doesNotThrow(() => writeAssistantChat(full, "a", chat), "a full store does not throw");

console.log("verify-assistant-history: ok");
