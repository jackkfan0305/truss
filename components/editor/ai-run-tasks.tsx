"use client"

import { BrainCircuit, Check, ChevronDown, CircleStop, CircleX, Loader2, TerminalSquare } from "lucide-react"

import { Response } from "@/components/chat/response"
import { ThinkingOrb } from "@/components/chat/thinking-orb"
import { Reasoning, ReasoningTrigger } from "@/components/ai-elements/reasoning-frame"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from "@/components/ai-elements/task"
import { CollapsibleContent } from "@/components/ui/collapsible"
import type { AiTimelinePart } from "@/lib/ai-timeline"
import { selectRunTaskGroups, type RunPhase } from "@/lib/run-task-groups"

export interface AiRunTasksState {
  id: string
  runId: string | null
  phase: RunPhase
  activity: AiTimelinePart[]
}

/**
 * A prompt-anchored work log, rendered from local or durable activity.
 *
 * The steps *are* the log now. They used to be filtered out of it and shown as
 * a status line above the composer, which put the answer to "why can't I
 * type?" in one place and the record of what happened in another. One stack
 * carries both, and the running task is the single live region.
 */
export function AiRunTasks({ state }: { state: AiRunTasksState }) {
  const groups = selectRunTaskGroups(state.activity, state.phase)
  const isLive = state.phase === "starting" || state.phase === "running"
  /*
   * Which part, if any, is still being written.
   *
   * Only the newest part of a run can be streaming, and only while the run is
   * live. Deciding this from the phase alone gave a run with four reasoning
   * parts four spinners all claiming to be thinking, three of them long
   * finished.
   */
  const streamingPartId = isLive ? state.activity.at(-1)?.id ?? null : null

  // A turn that answered in words and did nothing else has no steps. Rendering
  // the stack anyway would be a control that opens onto nothing.
  if (groups.length === 0) {
    if (isLive) {
      return (
        <p role="status" aria-live="polite" className="flex min-h-9 items-center gap-2 px-2 text-xs text-copy-secondary">
          <ThinkingOrb state="working" size={20} label="" />
          <Shimmer as="span" className="motion-reduce:text-copy-secondary">Thinking</Shimmer>
        </p>
      )
    }

    return state.phase === "error" || state.phase === "incomplete" ? (
      <RunOutcomeLine phase={state.phase} />
    ) : null
  }

  return (
    <div data-run-id={state.runId ?? undefined} className="flex flex-col gap-0.5">
      {groups.map((group, index) => {
        const isLast = index === groups.length - 1
        const visibleParts = group.parts.filter(
          (part) => part.type !== "action" ||
            (part.text !== "addEdge" && part.text !== "deleteEdge")
        )

        return (
          <Task key={group.id} defaultOpen className="group/task">
            <TaskTrigger
              title={group.title}
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-copy-secondary outline-none hover:bg-elevated/40 focus-visible:ring-2 focus-visible:ring-copy-primary/30"
            >
              {group.status === "running" ? <Loader2 aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" /> : null}
              {group.status === "complete" ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
              {group.status === "error" ? <CircleX aria-hidden className="size-3.5 shrink-0" /> : null}
              <span
                role={isLive && isLast ? "status" : undefined}
                aria-live={isLive && isLast ? "polite" : undefined}
                className="min-w-0 flex-1"
              >
                {isLive && isLast ? (
                  <Shimmer as="span" className="motion-reduce:text-copy-secondary">
                    {group.title}
                  </Shimmer>
                ) : group.title}
              </span>
              {isLast && (state.phase === "error" || state.phase === "incomplete") ? (
                <span className="text-copy-muted">{outcomeWording(state.phase)}</span>
              ) : null}
              <ChevronDown aria-hidden className="size-3.5 shrink-0 transition-transform group-data-[state=open]/task:rotate-180 motion-reduce:transition-none" />
            </TaskTrigger>
            {visibleParts.length > 0 ? (
              <TaskContent className="motion-reduce:animate-none [&>div]:mt-0 [&>div]:space-y-2 [&>div]:border-surface-border [&>div]:pl-6">
                {visibleParts.map((part) => (
                  <TaskItem key={part.id} className="min-w-0 text-xs text-copy-secondary">
                    <TaskPart
                      part={part}
                      isStreaming={part.id === streamingPartId}
                    />
                  </TaskItem>
                ))}
              </TaskContent>
            ) : null}
          </Task>
        )
      })}
    </div>
  )
}

/**
 * A stopped run is not a failed one. `incomplete` is a run that never reached
 * its own ending — a hard kill, a lost worker — and wording it as a failure
 * would blame the model for something the infrastructure did.
 */
function outcomeWording(phase: RunPhase): string {
  return phase === "incomplete"
    ? "Work stopped before completion"
    : "Generation failed"
}

/** A run that failed before emitting a step still has an outcome worth showing. */
function RunOutcomeLine({ phase }: { phase: RunPhase }) {
  const Icon = phase === "incomplete" ? CircleStop : CircleX

  return (
    <p className="flex items-center gap-2 text-xs text-copy-primary">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {outcomeWording(phase)}
    </p>
  )
}

function TaskPart({
  part,
  isStreaming,
}: {
  part: AiTimelinePart
  isStreaming: boolean
}) {
  if (part.type === "reasoning") {
    return <ThinkingDisclosure part={part} isStreaming={isStreaming} />
  }

  return (
    <span className="flex min-w-0 gap-2">
      <TerminalSquare
        aria-hidden
        className="mt-0.5 size-3.5 shrink-0 text-copy-secondary"
      />
      <span className="flex min-w-0 flex-col">
        <code className="truncate font-mono text-copy-primary">{part.text}</code>
        {part.detail ? (
          <TaskItemFile className="mt-0.5 w-fit max-w-full border-surface-border bg-page font-mono wrap-anywhere text-copy-secondary">
            {part.detail}
          </TaskItemFile>
        ) : null}
      </span>
    </span>
  )
}

/**
 * The model's own thinking, behind a disclosure inside its task.
 *
 * Curated summaries open while streaming, then return to a disclosure when
 * the run settles. Raw provider chain of thought never enters this component.
 *
 * Rendered through `Response` because the provider writes markdown: headings,
 * lists and emphasis arrive in the summaries and would otherwise show as
 * literal `**` and `-`.
 */
function ThinkingDisclosure({
  part,
  isStreaming,
}: {
  part: AiTimelinePart
  isStreaming: boolean
}) {
  return (
    <Reasoning defaultOpen={isStreaming} isStreaming={isStreaming} className="mb-0">
      <ReasoningTrigger className="min-h-8 rounded-lg px-1 text-xs font-medium text-copy-secondary outline-none focus-visible:ring-2 focus-visible:ring-copy-primary/30">
        {isStreaming ? (
          <ThinkingOrb state="working" size={20} label="" />
        ) : (
          <BrainCircuit aria-hidden className="size-3.5 shrink-0" />
        )}
        {isStreaming ? (
          <>
            <Shimmer as="span" className="motion-reduce:text-copy-secondary">Thinking</Shimmer>
            <span className="sr-only">Thought process</span>
          </>
        ) : "Thought process"}
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </ReasoningTrigger>
      <CollapsibleContent className="motion-reduce:animate-none">
        <Response
          isStreaming={isStreaming}
          className="mt-1 rounded-lg bg-elevated/40 px-2.5 py-2 text-xs leading-relaxed text-copy-secondary"
        >
          {part.text}
        </Response>
      </CollapsibleContent>
    </Reasoning>
  )
}
