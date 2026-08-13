"use client";

import { useCallback } from "react";

import {
  useAgentRun,
  type AgentRun,
  type AgentRunOptions,
} from "@/hooks/use-agent-run";
import { useAiChat, type AiChat } from "@/hooks/use-ai-chat";
import {
  submitAiPrompt,
  type AiPromptSubmissionOptions,
  type AiPromptSubmissionResult,
} from "@/lib/ai-prompt-submission";

export interface AiPromptSubmission {
  chat: AiChat;
  run: AgentRun;
  submit: (
    text: string,
    runOptions: AgentRunOptions,
    options?: AiPromptSubmissionOptions,
  ) => Promise<AiPromptSubmissionResult>;
}

export function useAiPromptSubmission(roomId: string): AiPromptSubmission {
  const chat = useAiChat();
  const run = useAgentRun(roomId);

  const submit = useCallback(
    (
      text: string,
      runOptions: AgentRunOptions,
      options?: AiPromptSubmissionOptions,
    ): Promise<AiPromptSubmissionResult> =>
      submitAiPrompt({
        text,
        runOptions,
        options,
        send: chat.send,
        start: run.start,
      }),
    [chat.send, run.start],
  );

  return { chat, run, submit };
}
