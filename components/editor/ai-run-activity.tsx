"use client"

import { useState } from "react"
import {
  BrainCircuit,
  Check,
  Circle,
  CircleStop,
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
import { useSmoothText } from "@/hooks/use-smooth-text"
import type { AiTimelinePart } from "@/lib/ai-timeline"
import { MARKDOWN_STYLES, renderChatMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"

export interface AiRunActivityState {
  id: string
  runId: string | null
  phase: "starting" | "running" | "complete" | "error" | "incomplete"
  activity: AiTimelinePart[]
}

interface AiRunActivityProps {
  state: AiRunActivityState
}

/** A prompt-anchored work log, rendered from local or durable activity. */
export function AiRunActivity({ state }: AiRunActivityProps) {
  const isRunning = state.phase === "starting" || state.phase === "running"
  const isStopped = state.phase === "error" || state.phase === "incomplete"
  // Two kinds of part are deliberately not in the log. Artifacts are attached
  // beneath the message by `SpecAttachmentList` — a document is the result of a
  // turn, not a step inside it. Steps are the live status line above the
  // composer now (38-live-step-status), so listing them here as well would
  // print the same six verbs twice, and they are the least interesting thing in
  // the log once the run is over: what the model thought and what it changed
  // are worth reading afterwards, "Reading the canvas" is not.
  const activity = state.activity.filter(
    (part) => part.type !== "artifact" && part.type !== "step"
  )
  // Still read from the *unfiltered* activity: the steps are gone from the list
  // but they are still the best label for a run in flight.
  const latestStep = state.activity.findLast((part) => part.type === "step")
  const headline =
    state.phase === "incomplete"
      ? "Work stopped before completion"
      : isRunning
        ? latestStep?.text ?? "Starting…"
        : state.phase === "error"
          ? "Generation stopped"
          : "Work complete"
  const stepCount = activity.length
  /*
   * Which part, if any, is still being written.
   *
   * Only the newest part of a run can be streaming, and only while the run is
   * live. Every `ThinkingDisclosure` used to decide this from the run phase
   * alone, so a run with four reasoning parts showed four spinners all claiming
   * to be thinking — three of them long finished. Compared against the
   * *unfiltered* activity so that a step arriving after a reasoning part still
   * settles it, even though that step is not rendered here.
   */
  const streamingPartId = isRunning ? state.activity.at(-1)?.id ?? null : null

  // Whether the log starts open is a mount-time decision: a live run shows its
  // work, a finished one from history stays folded. This hook must remain above
  // every early return so a turn changing from live to complete keeps a stable
  // hook order.
  const [defaultOpen] = useState(() => (isRunning || isStopped ? [state.id] : []))

  // A turn that answered in words and did nothing else has an empty log once
  // steps are out of it. Rendering the disclosure anyway would be a control
  // that opens onto "Waiting for the first activity event…" forever. A stopped
  // run keeps its header — that a run failed is worth showing even with nothing
  // under it.
  if (activity.length === 0 && state.phase === "complete") {
    return null
  }

  return (
    <div data-run-id={state.runId ?? undefined}>
      {/* No card: the work log sits on the panel background like the messages
          around it, so a run reads as part of the conversation rather than as
          a widget dropped into it. */}
      <Accordion defaultValue={defaultOpen}>
        <AccordionItem value={state.id} className="border-0">
          <AccordionTrigger className="min-h-11 gap-3 py-1 hover:no-underline focus-visible:border-copy-primary focus-visible:ring-copy-primary/20">
            <span className="flex min-w-0 items-center gap-2.5">
              <RunStateIcon phase={state.phase} />
              <span className="min-w-0 text-left">
                {/* No `role="status"`: the live region is the step line above
                    the composer now, and two of them announcing the same verb
                    reads it twice to a screen reader. */}
                <span className="block truncate text-xs font-medium text-copy-primary">
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
            {activity.length > 0 ? (
              <ol className="flex flex-col gap-2.5">
                {activity.map((part) => (
                  <ActivityItem
                    key={part.id}
                    part={part}
                    phase={state.phase}
                    isStreaming={part.id === streamingPartId}
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
    </div>
  )
}

function RunStateIcon({ phase }: { phase: AiRunActivityState["phase"] }) {
  if (phase === "starting" || phase === "running") {
    return (
      <Loader2
        aria-hidden
        className="size-3.5 shrink-0 motion-safe:animate-spin text-copy-primary"
      />
    )
  }

  if (phase === "incomplete") {
    return <CircleStop aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
  }

  if (phase === "error") {
    return <CircleX aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
  }

  return <Check aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
}

function ActivityItem({
  part,
  phase,
  isStreaming,
}: {
  part: AiTimelinePart
  phase: AiRunActivityState["phase"]
  isStreaming: boolean
}) {
  if (part.type === "reasoning") {
    return (
      <li className={cn("text-xs", ENTRANCE)}>
        <ThinkingDisclosure part={part} isStreaming={isStreaming} />
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
 * The model's own thinking, behind a disclosure (33-thinking-disclosure).
 *
 * Collapsed by default and on every run: this is the provider's reasoning
 * summary, which is worth having but is not what the panel is *for*. The
 * collapsed row is the status — a spinner and "Thinking" while deltas are still
 * arriving — so the common case reads as one line rather than as a wall of text
 * pushing the actions out of view.
 *
 * Rendered as Markdown because the provider writes Markdown: headings, lists
 * and emphasis arrive in the summaries, and as plain text they show up as
 * literal `**` and `-` noise.
 */
function ThinkingDisclosure({
  part,
  isStreaming,
}: {
  part: AiTimelinePart
  isStreaming: boolean
}) {
  // Deltas only arrive while the run is live *and* this is the part they are
  // arriving into — see `streamingPartId`. A part that is finished, whether
  // because the run ended or because the model moved on to something else, is
  // revealed whole rather than typed out to a reader who has already scrolled
  // to it.
  const text = useSmoothText(part.text, !isStreaming)

  return (
    <Accordion defaultValue={[]}>
      <AccordionItem value={part.id} className="border-0">
        <AccordionTrigger className="min-h-8 gap-2 py-0.5 text-xs hover:no-underline focus-visible:border-copy-primary focus-visible:ring-copy-primary/20">
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-copy-secondary">
            {isStreaming ? (
              <Loader2
                aria-hidden
                className="size-3.5 shrink-0 motion-safe:animate-spin"
              />
            ) : (
              <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
            )}
            {isStreaming ? "Thinking" : "Thought process"}
          </span>
        </AccordionTrigger>

        <AccordionContent className="pb-1">
          <div
            className={cn(
              "wrap-anywhere leading-relaxed text-copy-muted",
              MARKDOWN_STYLES
            )}
            dangerouslySetInnerHTML={{ __html: renderChatMarkdown(text) }}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
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

/**
 * A canvas operation that is in the log has already happened.
 *
 * This used to spin a dashed circle on every action until the whole run
 * finished, from when the build was one atomic write and the list was announced
 * ahead of it. The build is paced now and `design-agent` emits each action
 * *after* `applyDesignAction`, so an action appears at the moment it lands — a
 * dozen of them spinning was a dozen claims that nothing had happened yet,
 * beside a canvas visibly filling up.
 */
function ActionStateIcon({ phase }: { phase: AiRunActivityState["phase"] }) {
  // The run's own outcome still colours the ones it managed to apply: a stopped
  // run leaves a partial diagram, and the log should not read as a clean pass.
  return phase === "incomplete" ? (
    <CircleStop aria-hidden className="size-3 shrink-0" />
  ) : phase === "error" ? (
    <CircleX aria-hidden className="size-3 shrink-0" />
  ) : (
    <Check aria-hidden className="size-3 shrink-0" />
  )
}
