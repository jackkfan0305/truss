"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
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
  const model = AI_DESIGN_MODELS.find((entry) => entry.id === modelId)
  const effort = AI_THINKING_LEVELS.find((entry) => entry.id === thinkingLevel)

  return (
    <div className="ml-auto flex min-w-0 items-center gap-1.5">
      <Select
        value={modelId}
        onValueChange={(value) => {
          const selected = AI_DESIGN_MODELS.find((entry) => entry.id === value)
          if (selected) onModelChange(selected.id)
        }}
      >
        <SelectTrigger
          size="sm"
          disabled={disabled}
          aria-label="Choose model"
          title={model?.label ?? modelId}
          style={{ borderRadius: 9999 }}
          className="h-9 min-w-0 gap-1.5 rounded-full border border-surface-border bg-surface-border/70 px-3 text-xs text-copy-secondary shadow-none hover:bg-surface-border hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30 dark:bg-surface-border/70 dark:hover:bg-surface-border [&_svg]:size-3"
        >
          <span className="truncate">Agent</span>
        </SelectTrigger>
        <SelectContent align="start" className="w-44 min-w-0 rounded-xl border border-surface-border bg-surface p-1 text-copy-primary shadow-xl motion-reduce:animate-none">
          {AI_DESIGN_MODELS.map((entry) => (
            <SelectItem key={entry.id} value={entry.id} className="min-h-9 px-2 py-1.5 text-xs text-copy-secondary focus:bg-elevated focus:text-copy-primary">
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={thinkingLevel}
        onValueChange={(value) => {
          const selected = AI_THINKING_LEVELS.find((entry) => entry.id === value)
          if (selected) onThinkingLevelChange(selected.id)
        }}
      >
        <SelectTrigger
          size="sm"
          disabled={disabled}
          aria-label="Choose thinking effort"
          style={{ borderRadius: 9999 }}
          className="h-9 gap-1.5 rounded-full border border-surface-border bg-surface-border/70 px-3 text-xs text-copy-secondary shadow-none hover:bg-surface-border hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30 dark:bg-surface-border/70 dark:hover:bg-surface-border [&_svg]:size-3"
        >
          <span className="truncate">{effort?.label.split(" ")[0] ?? thinkingLevel}</span>
        </SelectTrigger>
        <SelectContent align="start" className="w-36 min-w-0 rounded-xl border border-surface-border bg-surface p-1 text-copy-primary shadow-xl motion-reduce:animate-none">
          {AI_THINKING_LEVELS.map((entry) => (
            <SelectItem key={entry.id} value={entry.id} className="min-h-9 px-2 py-1.5 text-xs text-copy-secondary focus:bg-elevated focus:text-copy-primary">
              <span className="min-w-0 flex-1">{entry.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
