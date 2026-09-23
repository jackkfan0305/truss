"use client"

import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import { AiInputSettings } from "@/components/chat/ai-input-settings"
import { ComposerBeam } from "@/components/chat/border-beam"
import {
  MAX_CHAT_CONTENT_LENGTH,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks"

export interface AiChatComposerProps {
  draft: string
  isDisabled: boolean
  isWorking: boolean
  modelId: AiDesignModelId
  thinkingLevel: AiThinkingLevel
  onDraftChange: (value: string) => void
  onModelChange: (id: AiDesignModelId) => void
  onThinkingLevelChange: (level: AiThinkingLevel) => void
  onSubmit: (text: string) => Promise<void>
}

export function AiChatComposer({
  draft,
  isDisabled,
  isWorking,
  modelId,
  thinkingLevel,
  onDraftChange,
  onModelChange,
  onThinkingLevelChange,
  onSubmit,
}: AiChatComposerProps) {
  return (
    <ComposerBeam isActive={isWorking}>
      <PromptInput
        aria-busy={isWorking}
        maxFiles={0}
        className="rounded-2xl border border-surface-border bg-surface focus-within:border-copy-primary"
        onSubmit={({ text }) => {
          if (isDisabled || !text.trim()) return
          return onSubmit(text)
        }}
      >
        <PromptInputTextarea
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          disabled={isDisabled}
          maxLength={MAX_CHAT_CONTENT_LENGTH}
          aria-label="Ask about the system, request a change, or ask for a spec"
          placeholder={
            isWorking
              ? "Working on it…"
              : isDisabled
                ? "Connecting to the room…"
                : "Ask about the system, request a change, or ask for a spec…"
          }
          className="min-h-0 max-h-28 resize-none border-0 bg-transparent text-copy-primary placeholder:text-copy-faint"
        />
        <PromptInputFooter className="border-0 bg-transparent">
          <PromptInputTools>
            <AiInputSettings
              modelId={modelId}
              thinkingLevel={thinkingLevel}
              onModelChange={onModelChange}
              onThinkingLevelChange={onThinkingLevelChange}
              disabled={isDisabled}
            />
          </PromptInputTools>
          <PromptInputSubmit
            status={isWorking ? "submitted" : "ready"}
            aria-label={isWorking ? "Agent is working" : "Send message"}
            disabled={isDisabled || !draft.trim()}
            className="text-copy-primary"
          />
        </PromptInputFooter>
      </PromptInput>
    </ComposerBeam>
  )
}
