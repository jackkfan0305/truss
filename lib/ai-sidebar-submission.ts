import type { AiPromptSubmit } from "@/hooks/use-ai-prompt-submission";
import type { AiDesignModelId, AiThinkingLevel } from "@/types/tasks";

interface AiSidebarPromptSubmissionInput {
  text: string;
  isComposerDisabled: boolean;
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
  submitPrompt: AiPromptSubmit;
  clearDraft: () => void;
}

/** Keeps manual composer feedback aligned with the shared submission result. */
export async function submitAiSidebarPrompt({
  text,
  isComposerDisabled,
  modelId,
  thinkingLevel,
  submitPrompt,
  clearDraft,
}: AiSidebarPromptSubmissionInput): Promise<void> {
  if (isComposerDisabled) {
    return;
  }

  const result = await submitPrompt(text, { modelId, thinkingLevel });

  if (result.status !== "message-error") {
    clearDraft();
  }
}
