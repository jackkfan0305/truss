"use client"

import {
  BrainCircuit,
  Check,
  Circle,
  CircleDashed,
  CircleX,
  Loader2,
  TerminalSquare,
} from "lucide-react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import type { AiRunTurn } from "@/lib/ai-run-turns"
import type { AiTimelinePart } from "@/lib/ai-timeline"
import { cn } from "@/lib/utils"
import { type AiStatusMessage, type AiTaskStatus } from "@/types/tasks"

interface AiRunActivityProps {
  turn: AiRunTurn
  status: AiStatusMessage | null
}

/** A Cursor-style, session-only work log anchored to the prompt that ran it. */
export function AiRunActivity({ turn, status }: AiRunActivityProps) {
  const isRunning = turn.phase === "starting" || turn.phase === "running"
  const isError = turn.phase === "error"
  const matchingStatus =
    turn.runId && status?.runId === turn.runId ? status : null
  const latestStep = turn.activity.findLast((part) => part.type === "step")
  const headline =
    matchingStatus?.text ??
    (matchingStatus ? STATUS_FALLBACK[matchingStatus.status] : null) ??
    latestStep?.text ??
    (isRunning ? "Starting…" : isError ? "Generation stopped" : "Work complete")
  const stepCount = turn.activity.length

  return (
    <li data-run-id={turn.runId ?? undefined}>
      {/* No card: the work log sits on the panel background like the messages
          around it, so a run reads as part of the conversation rather than as
          a widget dropped into it. */}
      <Accordion
        defaultValue={isRunning || isError ? [turn.promptMessageId] : []}
      >
        <AccordionItem value={turn.promptMessageId} className="border-0">
          <AccordionTrigger className="min-h-11 gap-3 py-1 hover:no-underline focus-visible:border-copy-primary focus-visible:ring-copy-primary/20">
            <span className="flex min-w-0 items-center gap-2.5">
              <RunStateIcon phase={turn.phase} />
              <span className="min-w-0 text-left">
                <span
                  role="status"
                  aria-live="polite"
                  className="block truncate text-xs font-medium text-copy-primary"
                >
                  {headline}
                </span>
                {/* The model used to be named here, from a constant. It is a
                    per-run choice now, and a turn does not carry which one ran,
                    so printing any single id would be a guess. The composer's
                    picker is the honest place for it. */}
                {stepCount > 0 ? (
                  <span className="block truncate text-xs font-normal text-copy-muted">
                    {stepCount} {stepCount === 1 ? "step" : "steps"}
                  </span>
                ) : null}
              </span>
            </span>
          </AccordionTrigger>

          <AccordionContent className="pb-2">
            {turn.activity.length > 0 ? (
              <ol className="flex flex-col gap-2.5">
                {turn.activity.map((part) => (
                  <ActivityItem
                    key={part.id}
                    part={part}
                    phase={turn.phase}
                  />
                ))}
              </ol>
            ) : (
              <p className="text-xs leading-relaxed text-copy-muted">
                Waiting for the first activity event…
              </p>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </li>
  )
}

function RunStateIcon({ phase }: { phase: AiRunTurn["phase"] }) {
  if (phase === "starting" || phase === "running") {
    return (
      <Loader2
        aria-hidden
        className="size-3.5 shrink-0 motion-safe:animate-spin text-copy-primary"
      />
    )
  }

  if (phase === "error") {
    return <CircleX aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
  }

  return <Check aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
}

function ActivityItem({
  part,
  phase,
}: {
  part: AiTimelinePart
  phase: AiRunTurn["phase"]
}) {
  if (part.type === "reasoning") {
    return (
      <li className={cn("text-xs", ENTRANCE)}>
        <span className="flex items-center gap-1.5 font-medium text-copy-secondary">
          <BrainCircuit aria-hidden className="size-3.5" />
          Reasoning summary
        </span>
        <p className="mt-1 whitespace-pre-wrap wrap-anywhere leading-relaxed text-copy-muted">
          {part.text}
        </p>
      </li>
    )
  }

  if (part.type === "action") {
    return (
      <li className={cn("flex gap-2 text-xs", ENTRANCE)}>
        <TerminalSquare
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-copy-secondary"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <ActionStateIcon phase={phase} />
            <code className="font-mono text-copy-primary">{part.text}</code>
          </span>
          {part.detail ? (
            <span className="mt-0.5 block wrap-anywhere text-copy-muted">
              {part.detail}
            </span>
          ) : null}
        </span>
      </li>
    )
  }

  return (
    <li className={cn("flex items-start gap-2 text-xs text-copy-muted", ENTRANCE)}>
      <Circle aria-hidden className="mt-0.5 size-3 shrink-0" />
      <span>{part.text}</span>
    </li>
  )
}

/**
 * New activity fades up instead of appearing instantly, so a run reads as
 * progress rather than as the panel snapping between states.
 *
 * Only new *parts* animate. A reasoning delta appends to the previous part
 * under its existing key (`appendAiActivityTimelinePart`), so React updates
 * that element in place and the animation does not replay on every chunk.
 */
const ENTRANCE =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"

function ActionStateIcon({ phase }: { phase: AiRunTurn["phase"] }) {
  return phase === "complete" ? (
    <Check aria-hidden className="size-3 shrink-0" />
  ) : phase === "error" ? (
    <CircleX aria-hidden className="size-3 shrink-0" />
  ) : (
    <CircleDashed
      aria-hidden
      className={cn(
        "size-3 shrink-0",
        phase === "running" && "motion-safe:animate-spin"
      )}
    />
  )
}

const STATUS_FALLBACK: Record<AiTaskStatus, string> = {
  started: "Starting…",
  processing: "Working on the canvas…",
  complete: "Work complete",
  error: "Generation stopped",
}
