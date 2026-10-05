"use client"

import Link from "next/link"
import { BrainCircuit, Check, ChevronDown, CircleStop, CircleX, Loader2 } from "lucide-react"

import { Response } from "@/components/chat/response"
import { ThinkingOrb } from "@/components/chat/thinking-orb"
import { Reasoning, ReasoningTrigger } from "@/components/ai-elements/reasoning-frame"
import { Shimmer } from "@/components/ai-elements/shimmer"
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task"
import { CollapsibleContent } from "@/components/ui/collapsible"
import {
  selectAssistantTaskGroups,
  type AssistantTaskGroup,
  type AssistantTaskStatus,
  type AssistantTurn,
  type AssistantTurnPart,
} from "@/lib/assistant-turn"

const ROW_CLASS =
  "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-copy-secondary"

/**
 * A turn's work log: one task per tool call, with the reasoning that followed
 * it inside. The running task is the turn's single live region.
 */
export function AiRunTasks({ turn }: { turn: AssistantTurn }) {
  const groups = selectAssistantTaskGroups(turn)
  const isLive = turn.phase === "running"
  // Only the newest part of a live turn can still be streaming.
  const streamingPartId = isLive ? turn.parts.at(-1)?.id ?? null : null

  if (groups.length === 0) {
    // Once words arrive, the reply itself says the turn is alive.
    if (isLive && !turn.text) {
      return (
        <p role="status" aria-live="polite" className="flex min-h-9 items-center gap-2 px-2 text-xs text-copy-secondary">
          <ThinkingOrb state="working" size={20} label="" />
          <Shimmer as="span" className="motion-reduce:text-copy-secondary">Thinking</Shimmer>
        </p>
      )
    }
    return null
  }

  return (
    <div className="flex flex-col gap-0.5">
      {groups.map((group, index) => {
        const isCurrent = isLive && index === groups.length - 1
        const title = (
          <span
            role={isCurrent ? "status" : undefined}
            aria-live={isCurrent ? "polite" : undefined}
            className="min-w-0 flex-1"
          >
            {group.href ? (
              <Link href={group.href} className="underline underline-offset-2 decoration-copy-faint hover:text-copy-primary hover:decoration-copy-primary">
                {group.title}
              </Link>
            ) : isCurrent ? (
              <Shimmer as="span" className="motion-reduce:text-copy-secondary">{group.title}</Shimmer>
            ) : (
              group.title
            )}
          </span>
        )

        // A task with nothing inside is a row, not a control that opens onto nothing.
        // A link cannot sit inside the trigger button either, so linked tasks list
        // their reasoning open beneath them.
        if (group.reasoning.length === 0 || group.href) {
          return (
            <div key={group.id}>
              <div className={ROW_CLASS}>
                <StatusIcon status={group.status} />
                {title}
              </div>
              {group.reasoning.length > 0 ? (
                <div className="space-y-2 border-l border-surface-border pl-6">
                  <ReasoningItems group={group} streamingPartId={streamingPartId} />
                </div>
              ) : null}
            </div>
          )
        }

        return (
          <Task key={group.id} defaultOpen className="group/task">
            <TaskTrigger
              title={group.title}
              className={`${ROW_CLASS} outline-none hover:bg-elevated/40 focus-visible:ring-2 focus-visible:ring-copy-primary/30`}
            >
              <StatusIcon status={group.status} />
              {title}
              <ChevronDown aria-hidden className="size-3.5 shrink-0 transition-transform group-data-open/task:rotate-180 motion-reduce:transition-none" />
            </TaskTrigger>
            <TaskContent className="motion-reduce:animate-none [&>div]:mt-0 [&>div]:space-y-2 [&>div]:border-surface-border [&>div]:pl-6">
              <ReasoningItems group={group} streamingPartId={streamingPartId} />
            </TaskContent>
          </Task>
        )
      })}
    </div>
  )
}

function StatusIcon({ status }: { status: AssistantTaskStatus }) {
  if (status === "running") return <Loader2 aria-hidden className="size-3.5 shrink-0 motion-safe:animate-spin" />
  if (status === "error") return <CircleX aria-hidden className="size-3.5 shrink-0" />
  return <Check aria-hidden className="size-3.5 shrink-0" />
}

function ReasoningItems({
  group,
  streamingPartId,
}: {
  group: AssistantTaskGroup
  streamingPartId: string | null
}) {
  return group.reasoning.map((part) => (
    <TaskItem key={part.id} className="min-w-0 text-xs text-copy-secondary">
      <ThinkingDisclosure part={part} isStreaming={part.id === streamingPartId} />
    </TaskItem>
  ))
}

/**
 * How a turn ended when it did not end cleanly. An error from the assistant is
 * shown verbatim; a stopped turn is not a failed one, so it is worded apart.
 */
export function RunOutcomeLine({ turn }: { turn: AssistantTurn }) {
  if (turn.phase !== "error" && turn.phase !== "incomplete") return null
  const Icon = turn.phase === "incomplete" ? CircleStop : CircleX

  return (
    <p role={turn.phase === "error" ? "alert" : undefined} className="flex items-start gap-2 text-xs text-copy-primary">
      <Icon aria-hidden className="mt-px size-3.5 shrink-0" />
      {turn.notice ?? "Stopped before finishing."}
    </p>
  )
}

/**
 * The model's visible reasoning, behind a disclosure inside its task. Open
 * while it streams, then folded once the turn moves on. Rendered through
 * `Response` because providers write markdown here too.
 */
function ThinkingDisclosure({
  part,
  isStreaming,
}: {
  part: Extract<AssistantTurnPart, { type: "reasoning" }>
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
