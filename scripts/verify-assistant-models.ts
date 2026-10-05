import assert from "node:assert/strict";

import {
  ASSISTANT_MODELS,
  DEFAULT_ASSISTANT_MODEL_ID,
  readAssistantModel,
  writeAssistantModel,
} from "../lib/assistant-models";
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

const paid = ASSISTANT_MODELS.filter((model) => model.tier === "paid");
const free = ASSISTANT_MODELS.filter((model) => model.tier === "free");
assert.ok(paid.length > 0 && free.length > 0, "both groups are present");
assert.ok(free.every((model) => model.id.endsWith(":free")), "free slugs end in :free");
assert.ok(paid.every((model) => !model.id.endsWith(":free")), "paid slugs are not free");
assert.equal(new Set(ASSISTANT_MODELS.map((model) => model.id)).size, ASSISTANT_MODELS.length);

const defaultModel = ASSISTANT_MODELS.find((model) => model.id === DEFAULT_ASSISTANT_MODEL_ID);
assert.equal(defaultModel?.tier, "paid");
assert.ok(defaultModel?.id.startsWith("anthropic/"), "default is a paid Claude model");

{
  const storage = memoryStorage();
  assert.equal(readAssistantModel(storage), DEFAULT_ASSISTANT_MODEL_ID);
  writeAssistantModel(storage, free[0].id);
  assert.equal(readAssistantModel(storage), free[0].id);
  storage.setItem("truss.assistant.model", "retired/model");
  assert.equal(readAssistantModel(storage), DEFAULT_ASSISTANT_MODEL_ID);
}

{
  const throwing: KeyValueStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => undefined,
  };
  assert.equal(readAssistantModel(throwing), DEFAULT_ASSISTANT_MODEL_ID);
  writeAssistantModel(throwing, free[0].id);
}

console.log("verify-assistant-models: ok");
