"use client"

import { Check } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AiInput } from "@/components/chat/ai-input"
import { cn } from "@/lib/utils"
import {
  AI_DESIGN_MODELS,
  AI_THINKING_LEVELS,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks"

/**
 * Model and effort, behind one pill.
 *
 * Two settings on one send, so they belong on one surface. The pair of bare
 * selects that used to sit inside the composer border put two chevrons and two
 * hover surfaces on a row whose job is to hold the send control.
 *
 * Choice rows rather than a select's option list: the hint beside each label
 * ("Fastest", "Deepest") is the reason to pick one, and a select trigger can
 * only ever show the label.
 */
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
  const level = AI_THINKING_LEVELS.find((entry) => entry.id === thinkingLevel)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <AiInput.Pill
            label={model?.label ?? modelId}
            detail={level?.label ?? thinkingLevel}
            disabled={disabled}
          />
        }
      />
      <PopoverContent
        align="start"
        className="w-64 rounded-2xl border border-surface-border bg-surface p-1.5"
      >
        <ChoiceGroup label="Design model">
          {AI_DESIGN_MODELS.map((entry) => (
            <ChoiceRow
              key={entry.id}
              label={entry.label}
              hint={entry.hint}
              isSelected={entry.id === modelId}
              onSelect={() => onModelChange(entry.id)}
            />
          ))}
        </ChoiceGroup>

        <div className="my-1.5 border-t border-surface-border" />

        <ChoiceGroup label="Thinking effort">
          {AI_THINKING_LEVELS.map((entry) => (
            <ChoiceRow
              key={entry.id}
              label={entry.label}
              hint={entry.hint}
              isSelected={entry.id === thinkingLevel}
              onSelect={() => onThinkingLevelChange(entry.id)}
            />
          ))}
        </ChoiceGroup>
      </PopoverContent>
    </Popover>
  )
}

function ChoiceGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div role="group" aria-label={label}>
      <p className="px-2 py-1 text-xs font-medium text-copy-faint">{label}</p>
      {children}
    </div>
  )
}

/**
 * The check is the selection, and the row is also `aria-pressed`: a tick mark
 * alone is an icon with no name, and this panel's rule is that no state is
 * carried by one cue.
 */
function ChoiceRow({
  label,
  hint,
  isSelected,
  onSelect,
}: {
  label: string
  hint: string
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-xs outline-none",
        "hover:bg-elevated focus-visible:ring-2 focus-visible:ring-copy-primary/30",
        isSelected ? "text-copy-primary" : "text-copy-secondary"
      )}
    >
      <Check
        aria-hidden
        className={cn("size-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-copy-faint">{hint}</span>
    </button>
  )
}
