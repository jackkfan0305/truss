"use client"

import { ArrowUp, Plus, Square } from "lucide-react"
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

/** Long enough for a paragraph, short enough that one message can't flood the panel. */
const MAX_CHAT_CONTENT_LENGTH = 2000

export interface AiChatComposerProps {
  className?: string
  draft: string
  isWorking: boolean
  modelId: string
  onDraftChange: (value: string) => void
  onModelChange: (id: string) => void
  onSubmit: (text: string) => void
  onStop: () => void
}

export function AiChatComposer({
  className,
  draft,
  isWorking,
  modelId,
  onDraftChange,
  onModelChange,
  onSubmit,
  onStop,
}: AiChatComposerProps) {
  const prefersReducedMotion = useReducedMotion()

  const promptInput = (
      <PromptInput
        aria-busy={isWorking}
        maxFiles={0}
        className="ai-chat-composer w-auto overflow-hidden rounded-[1.625rem] border border-surface-border/50 bg-subtle px-2 pt-1 transition-colors focus-within:border-copy-secondary"
        onSubmit={({ text }) => {
          if (isWorking || !text.trim()) return
          onSubmit(text)
        }}
      >
        <PromptInputTextarea
          value={draft}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
          maxLength={MAX_CHAT_CONTENT_LENGTH}
          aria-label="Message the assistant"
          placeholder={
            isWorking
              ? "Working on it…"
              : "Ask about this diagram, or describe one to create"
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
              onModelChange={onModelChange}
              disabled={isWorking}
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
              status={isWorking ? "streaming" : "ready"}
              onStop={onStop}
              aria-label={isWorking ? "Stop" : "Send message"}
              disabled={!isWorking && !draft.trim()}
              size="icon-sm"
              className="size-10 rounded-full border-copy-secondary/60 bg-elevated text-copy-primary hover:bg-surface focus-visible:ring-2 focus-visible:ring-copy-primary/60 disabled:opacity-70"
            >
              {isWorking ? (
                <Square className="size-4" strokeWidth={2} />
              ) : (
                <ArrowUp className="size-5" strokeWidth={2} />
              )}
            </PromptInputSubmit>
          </MetalFx>
        </PromptInputFooter>
      </PromptInput>
  )

  // The beam stays mounted and only lights while working: swapping the wrapper
  // in and out remounted the Metal FX ring, which then stayed invisible.
  return (
    <ComposerBeam isActive={isWorking} className={className}>
      {promptInput}
    </ComposerBeam>
  )
}
