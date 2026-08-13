import type { AgentRunOptions, RunSubscription } from "@/hooks/use-agent-run";

export interface AiChatSendOptions {
  launchId?: string;
}

export type AiPromptSubmissionResult =
  | { status: "message-error" }
  | { status: "run-error"; promptMessageId: string }
  | {
      status: "started";
      promptMessageId: string;
      subscription: RunSubscription;
    };

export interface AiPromptSubmissionOptions {
  launchId?: string;
  promptMessageId?: string;
  onPromptSent?: (promptMessageId: string) => void;
  onRunStarting?: (promptMessageId: string) => void;
}

interface SubmitAiPromptInput {
  text: string;
  runOptions: AgentRunOptions;
  options?: AiPromptSubmissionOptions;
  send: (text: string, options?: AiChatSendOptions) => Promise<string | null>;
  start: (
    prompt: string,
    promptMessageId: string,
    options: AgentRunOptions,
  ) => Promise<RunSubscription>;
}

export async function submitAiPrompt(
  input: SubmitAiPromptInput,
): Promise<AiPromptSubmissionResult> {
  const existingPromptMessageId = input.options?.promptMessageId;
  const promptMessageId =
    existingPromptMessageId ??
    (await input.send(input.text, { launchId: input.options?.launchId }));

  if (!promptMessageId) {
    return { status: "message-error" };
  }

  if (!existingPromptMessageId) {
    input.options?.onPromptSent?.(promptMessageId);
  }

  input.options?.onRunStarting?.(promptMessageId);

  try {
    const subscription = await input.start(
      input.text,
      promptMessageId,
      input.runOptions,
    );

    return { status: "started", promptMessageId, subscription };
  } catch {
    return { status: "run-error", promptMessageId };
  }
}
