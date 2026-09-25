import { Check } from "lucide-react"

/**
 * Shared look for the one-time agent entry pages (`/agent/new`, `/agent/link`,
 * `/agent/pick`), so the three read as one family. Working states use
 * `TrussLoader`; these cover what is left: cards that need a decision or
 * report a failure, and the finished state.
 */
export const agentCardClassName =
  "w-full max-w-sm rounded-2xl border border-surface-border bg-elevated p-6 shadow-lg shadow-page/60"
export const agentLabelClassName =
  "font-mono text-xs uppercase tracking-[0.18em] text-copy-muted"
export const agentSecondaryButtonClassName =
  "rounded-xl border border-surface-border bg-subtle px-3.5 py-2 text-sm font-medium text-copy-primary transition-colors hover:border-surface-border-subtle hover:bg-surface-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
export const agentDestructiveButtonClassName =
  "rounded-xl border border-transparent bg-destructive/10 px-3.5 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"

/** The finished state: a check that settles in, and what happened. */
export function AgentDoneStatus({ message }: { message: string }) {
  return (
    <section role="status" className="flex flex-col items-center gap-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-surface-border bg-elevated text-brand motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-90 motion-safe:duration-500">
        <Check aria-hidden className="size-5" strokeWidth={2.25} />
      </span>
      <p className="max-w-xs text-sm text-copy-secondary">{message}</p>
    </section>
  )
}
