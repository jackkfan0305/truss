"use client"

import { ArrowUp, Plus } from "lucide-react"
import { MetalFx } from "metal-fx"

import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input"
import { AiInputSettings } from "@/components/chat/ai-input-settings"
import { ComposerBeam } from "@/components/chat/border-beam"
import { useReducedMotion } from "@/hooks/use-reduced-motion"
import { cn } from "@/lib/utils"
import {
  MAX_CHAT_CONTENT_LENGTH,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks"

export interface AiChatComposerProps {
  className?: string
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
  className,
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
  const prefersReducedMotion = useReducedMotion()

  const promptInput = (
      <PromptInput
        aria-busy={isWorking}
        maxFiles={0}
        className={cn(
          "ai-chat-composer w-auto overflow-hidden rounded-[1.625rem] border border-surface-border/50 bg-subtle px-2 pt-1 transition-colors focus-within:border-copy-secondary",
          !isWorking && className
        )}
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
                : "Build anything…"
          }
          className="min-h-12 max-h-28 resize-none border-0 bg-transparent px-3 pt-2 pb-1 text-[15px] text-copy-primary placeholder:text-copy-muted md:text-[15px]"
        />
        <PromptInputFooter className="min-h-13 border-0 bg-transparent px-2 pb-2 pt-1">
          <PromptInputTools className="flex-1 gap-2">
            <span
              data-slot="composer-plus"
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-surface-border-subtle/40 bg-surface-border/70 text-copy-secondary"
            >
              <Plus className="size-5" strokeWidth={1.8} />
            </span>
            <AiInputSettings
              modelId={modelId}
              thinkingLevel={thinkingLevel}
              onModelChange={onModelChange}
              onThinkingLevelChange={onThinkingLevelChange}
              disabled={isDisabled}
            />
          </PromptInputTools>
          <MetalFx
            preset="chromatic"
            variant="circle"
            theme="dark"
            innerShadow
            strength={0.85}
            paused={prefersReducedMotion}
            className="shrink-0"
          >
            <PromptInputSubmit
              status={isWorking ? "submitted" : "ready"}
              aria-label={isWorking ? "Agent is working" : "Send message"}
              disabled={isDisabled || !draft.trim()}
              size="icon-sm"
              className="size-10 rounded-full border-copy-secondary/60 bg-elevated text-copy-primary hover:bg-surface focus-visible:ring-2 focus-visible:ring-copy-primary/60 disabled:opacity-70"
            >
              <ArrowUp className="size-5" strokeWidth={2} />
            </PromptInputSubmit>
          </MetalFx>
        </PromptInputFooter>
      </PromptInput>
  )

  return isWorking ? (
    <ComposerBeam isActive className={className}>
      {promptInput}
    </ComposerBeam>
  ) : promptInput
}
