"use client"

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react"
import { ArrowUp, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MAX_CHAT_CONTENT_LENGTH } from "@/types/tasks"

/**
 * The composer, as a compound component.
 *
 * A root holding value, status and disabled state in context, with the parts
 * arranged by the caller. The alternative — one component with a dozen props —
 * puts the panel's layout decisions inside the control, which is exactly what
 * made the previous composer hard to restyle.
 *
 * Submit has two states, not the three the source doc describes. The third is
 * a stop button, and this app has no cancel route to honour it; an indicator
 * that looked pressable would be a promise the backend cannot keep.
 */

/** The field opens one row tall and grows to this before it starts scrolling. */
const MAX_FIELD_ROWS = 5

interface AiInputContextValue {
  value: string
  status: "ready" | "working"
  isDisabled: boolean
  onValueChange: (next: string) => void
  onSubmit: () => void
}

const AiInputContext = createContext<AiInputContextValue | null>(null)

function useAiInput(): AiInputContextValue {
  const context = useContext(AiInputContext)

  if (!context) {
    throw new Error("AiInput parts must be rendered inside AiInput.Root")
  }

  return context
}

function AiInputRoot({
  value,
  status,
  isDisabled,
  onValueChange,
  onSubmit,
  children,
  className,
}: AiInputContextValue & { children: ReactNode; className?: string }) {
  return (
    <AiInputContext.Provider
      value={{ value, status, isDisabled, onValueChange, onSubmit }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
        className={cn(
          "rounded-2xl border border-surface-border bg-surface px-3 py-2.5 focus-within:border-copy-primary focus-within:ring-1 focus-within:ring-copy-primary/20",
          className
        )}
      >
        {children}
      </form>
    </AiInputContext.Provider>
  )
}

/**
 * A plain textarea rather than the shadcn primitive.
 *
 * That primitive fills itself with `dark:bg-input/30` and swaps to
 * `dark:disabled:bg-input/80` while disabled — which is exactly when a run is
 * in flight — so every use of it inside a composer spent four class resets
 * undoing a background it never wanted.
 */
function AiInputField({
  placeholder,
  "aria-label": ariaLabel,
}: {
  placeholder: string
  "aria-label": string
}) {
  const { value, isDisabled, onValueChange, onSubmit } = useAiInput()
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  // Height is measured, not animated: `height` is layout-bound, so this sets
  // it once per keystroke rather than transitioning it.
  useLayoutEffect(() => {
    const field = fieldRef.current

    if (!field) return

    const style = window.getComputedStyle(field)
    const lineHeight = Number.parseFloat(style.lineHeight) || 20
    const padding =
      Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const ceiling = lineHeight * MAX_FIELD_ROWS + padding

    field.style.height = "auto"

    const wanted = field.scrollHeight

    field.style.height = `${Math.min(wanted, ceiling)}px`
    // Past the ceiling the field holds its height and scrolls its own content,
    // so a long prompt never pushes the send control out of the panel.
    field.style.overflowY = wanted > ceiling ? "auto" : "hidden"
  }, [value])

  return (
    <textarea
      ref={fieldRef}
      rows={1}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault()
          onSubmit()
        }
      }}
      maxLength={MAX_CHAT_CONTENT_LENGTH}
      disabled={isDisabled}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="block w-full resize-none border-0 bg-transparent p-0 text-sm leading-relaxed text-copy-primary outline-none placeholder:text-copy-faint disabled:cursor-not-allowed"
    />
  )
}

function AiInputToolbar({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex items-center gap-1.5">{children}</div>
}

interface AiInputPillProps extends React.ComponentPropsWithRef<typeof Button> {
  label: string
  detail: string
}

/**
 * The composer's one setting surface: a label and a detail on a borderless
 * control. Borderless because it sits inside the composer's own border, and a
 * second bordered control there reads as a nested box rather than as a setting
 * on the thing it belongs to.
 *
 * Accepts and forwards `ref` and any unrecognised props (`...rest`) rather
 * than a fixed prop list: wrapped in a `PopoverTrigger`'s `render` prop, Base
 * UI clones this element with its own computed `ref`, `aria-haspopup`,
 * `aria-expanded`, `aria-controls` and `id` — Floating UI needs the ref as its
 * anchor, and a screen reader needs the ARIA to know this opens a dialog.
 * Dropping any of them silently breaks the popover.
 */
function AiInputPill({
  ref,
  label,
  detail,
  disabled = false,
  className,
  "aria-label": ariaLabel,
  ...rest
}: AiInputPillProps) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      data-composer-pill=""
      // Base UI's PopoverTrigger never injects its own `aria-label`, so this
      // composed one always wins — but an explicit caller-supplied label (the
      // `??` branch) still takes priority over the default.
      aria-label={ariaLabel ?? `Model and effort: ${label}, ${detail}`}
      className={cn(
        "min-w-0 gap-1.5 px-2 text-xs text-copy-secondary hover:bg-elevated hover:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/30",
        className
      )}
      {...rest}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-copy-faint">{detail}</span>
    </Button>
  )
}

function AiInputSpacer() {
  return <span className="flex-1" />
}

function AiInputSubmit() {
  const { value, status, isDisabled } = useAiInput()
  const isWorking = status === "working"
  // Two states. Empty means nothing to send; working means nothing to press.
  const canSend = !isDisabled && !isWorking && value.trim().length > 0

  return (
    <Button
      type="submit"
      size="icon-sm"
      disabled={!canSend}
      aria-busy={isWorking}
      aria-label={isWorking ? "Agent is working" : "Send message"}
      className="shrink-0 rounded-full bg-copy-primary text-page hover:bg-copy-secondary focus-visible:border-copy-primary focus-visible:ring-copy-primary/30"
    >
      {isWorking ? (
        <Loader2 aria-hidden className="size-3.5 motion-safe:animate-spin" />
      ) : (
        <ArrowUp aria-hidden className="size-3.5" />
      )}
    </Button>
  )
}

export const AiInput = {
  Root: AiInputRoot,
  Field: AiInputField,
  Toolbar: AiInputToolbar,
  Pill: AiInputPill,
  Spacer: AiInputSpacer,
  Submit: AiInputSubmit,
}
