"use client"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select"
import { ASSISTANT_MODELS } from "@/lib/assistant-models"

export interface AiInputSettingsProps {
  modelId: string
  onModelChange: (modelId: string) => void
  disabled: boolean
}

const MODEL_GROUPS = [
  { label: "Paid", models: ASSISTANT_MODELS.filter((model) => model.tier === "paid") },
  { label: "Free", models: ASSISTANT_MODELS.filter((model) => model.tier === "free") },
]

/** The composer's model pill. The thinking-effort pill had no OpenRouter equivalent here, so it is gone. */
export function AiInputSettings({
  modelId,
  onModelChange,
  disabled,
}: AiInputSettingsProps) {
  const model = ASSISTANT_MODELS.find((entry) => entry.id === modelId)

  return (
    <div className="ml-auto flex min-w-0 items-center gap-1.5">
      <Select
        value={modelId}
        onValueChange={(value) => {
          const selected = ASSISTANT_MODELS.find((entry) => entry.id === value)
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
          <span className="truncate">{model?.label ?? modelId}</span>
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false} className="w-52 min-w-0 rounded-xl border border-surface-border bg-surface p-1 text-copy-primary shadow-xl motion-reduce:animate-none">
          {MODEL_GROUPS.map((group) => (
            <SelectGroup key={group.label} className="p-0">
              <SelectLabel className="px-2 pt-1.5 text-copy-muted">{group.label}</SelectLabel>
              {group.models.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} className="min-h-9 px-2 py-1.5 text-xs text-copy-secondary focus:bg-elevated focus:text-copy-primary">
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
