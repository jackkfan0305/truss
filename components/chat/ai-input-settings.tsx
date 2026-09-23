"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  AI_DESIGN_MODELS,
  AI_THINKING_LEVELS,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks"

export interface AiInputSettingsProps {
  modelId: AiDesignModelId
  thinkingLevel: AiThinkingLevel
  onModelChange: (modelId: AiDesignModelId) => void
  onThinkingLevelChange: (thinkingLevel: AiThinkingLevel) => void
  disabled: boolean
}

export function AiInputSettings({
  modelId,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  disabled,
}: AiInputSettingsProps) {
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)
  const model = AI_DESIGN_MODELS.find((entry) => entry.id === modelId)
  const effort = AI_THINKING_LEVELS.find((entry) => entry.id === thinkingLevel)

  return (
    <div className="flex min-w-0 items-center gap-1">
      <ModelSelector open={modelOpen} onOpenChange={setModelOpen}>
        <ModelSelectorTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              aria-label="Choose model"
              className="flex min-h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-xs text-copy-secondary outline-none hover:bg-elevated hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
          }
        >
          <span className="truncate">{model?.label ?? modelId}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        </ModelSelectorTrigger>
        <ModelSelectorContent title="Choose model" className="border border-surface-border bg-surface text-copy-primary">
          <ModelSelectorInput placeholder="Search models" />
          <ModelSelectorList>
            <ModelSelectorEmpty>No matching model</ModelSelectorEmpty>
            <ModelSelectorGroup heading="Google models">
              {AI_DESIGN_MODELS.map((entry) => (
                <ModelSelectorItem
                  key={entry.id}
                  value={entry.id}
                  onSelect={() => {
                    onModelChange(entry.id)
                    setModelOpen(false)
                  }}
                >
                  <Check aria-hidden className={cn("size-3.5", entry.id === modelId ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  <span className="text-copy-muted">{entry.hint}</span>
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          </ModelSelectorList>
        </ModelSelectorContent>
      </ModelSelector>

      <Popover open={effortOpen} onOpenChange={setEffortOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={disabled}
              aria-label="Choose thinking effort"
              className="flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs text-copy-secondary outline-none hover:bg-elevated hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
          }
        >
          {effort?.label ?? thinkingLevel}
          <ChevronDown aria-hidden className="size-3" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 rounded-2xl border border-surface-border bg-surface p-1.5">
          <p className="px-2 py-1 text-xs font-medium text-copy-muted">Thinking effort</p>
          {AI_THINKING_LEVELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={entry.id === thinkingLevel}
              onClick={() => {
                onThinkingLevelChange(entry.id)
                setEffortOpen(false)
              }}
              className="flex min-h-10 w-full items-center gap-2 rounded-xl px-2 text-left text-xs text-copy-secondary hover:bg-elevated hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30"
            >
              <Check aria-hidden className={cn("size-3.5", entry.id === thinkingLevel ? "opacity-100" : "opacity-0")} />
              <span className="flex-1">{entry.label}</span>
              <span className="text-copy-muted">{entry.hint}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
