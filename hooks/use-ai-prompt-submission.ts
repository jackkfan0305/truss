"use client";

import { useMemo } from "react";

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
  submit: AiPromptSubmit;
}

export type AiPromptSubmit = (
  text: string,
  runOptions: AgentRunOptions,
  options?: AiPromptSubmissionOptions,
) => Promise<AiPromptSubmissionResult>;

export function createAiPromptSubmit(
  chat: Pick<AiChat, "send">,
  run: Pick<AgentRun, "start">,
): AiPromptSubmit {
  return (text, runOptions, options) =>
    submitAiPrompt({
      text,
      runOptions,
      options,
      send: chat.send,
      start: run.start,
    });
}

export function useAiPromptSubmission(roomId: string): AiPromptSubmission {
  const chat = useAiChat();
  const run = useAgentRun(roomId);
  const { send } = chat;
  const { start } = run;

  const submit = useMemo(
    () => createAiPromptSubmit({ send }, { start }),
    [send, start],
  );

  return { chat, run, submit };
}
