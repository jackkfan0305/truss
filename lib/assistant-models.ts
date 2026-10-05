import type { KeyValueStorage } from "@/lib/openrouter-auth";

export interface AssistantModel {
  id: string;
  label: string;
  tier: "paid" | "free";
}

/**
 * Checked 2026-10-04 against GET https://openrouter.ai/api/v1/models: every id
 * lists "tools" in supported_parameters, which create and edit depend on.
 * OpenRouter had no free Claude, GPT or Gemini with tools that day, so the
 * free group is the strongest free tool-calling models instead.
 */
export const ASSISTANT_MODELS: readonly AssistantModel[] = [
  { id: "anthropic/claude-sonnet-5.5", label: "Claude Sonnet 5.5", tier: "paid" },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", tier: "paid" },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", tier: "paid" },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", tier: "free" },
  { id: "qwen/qwen3.8-27b:free", label: "Qwen 3.8 27B", tier: "free" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super", tier: "free" },
];

export const DEFAULT_ASSISTANT_MODEL_ID = "anthropic/claude-sonnet-5.5";

/** Dispatched on `window` after the stored pick changes in this tab. */
export const ASSISTANT_MODEL_CHANGE_EVENT = "truss:assistant-model";

const MODEL_STORAGE_KEY = "truss.assistant.model";

export function readAssistantModel(storage: KeyValueStorage): string {
  try {
    const stored = storage.getItem(MODEL_STORAGE_KEY);
    return ASSISTANT_MODELS.some((model) => model.id === stored) && stored
      ? stored
      : DEFAULT_ASSISTANT_MODEL_ID;
  } catch {
    return DEFAULT_ASSISTANT_MODEL_ID;
  }
}

export function writeAssistantModel(storage: KeyValueStorage, id: string): void {
  try {
    storage.setItem(MODEL_STORAGE_KEY, id);
  } catch {
    // ponytail: a blocked store only costs the pick on reload.
  }
}
