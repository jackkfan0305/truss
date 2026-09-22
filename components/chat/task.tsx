"use client"

import { useState, type ReactNode } from "react"
import { Check, ChevronDown, CircleX, Loader2 } from "lucide-react"

import type { RunTaskStatus } from "@/lib/run-task-groups"
import { cn } from "@/lib/utils"

/**
 * One step of a run, as a disclosure.
 *
 * Built on native `<details>` rather than the Accordion primitive: keyboard
 * reach, the fold, and the open state are the element's own behaviour, and the
 * previous work log spent a nested Accordion per reasoning part getting back
 * what `<details>` gives for free.
 *
 * Tasks default to open. A reasoning trace stops being interesting once the
 * answer starts; the steps are the record of what the agent did to the canvas
 * and are worth scrolling back through. Pressing the trigger still folds one
 * away — only the default changed.
 */

function TaskRoot({
  defaultOpen = true,
  children,
  className,
}: {
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  // State rather than the bare `open` attribute: React writes the attribute on
  // every render, so an uncontrolled `<details open>` snaps back the moment
  // anything above it re-renders.
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className={cn("group", className)}
    >
      {children}
    </details>
  )
}

function TaskTrigger({
  title,
  status,
  isLive = false,
  detail,
}: {
  title: string
  status: RunTaskStatus
  /** Whether this is the step a run is working on right now. */
  isLive?: boolean
  detail?: string
}) {
  return (
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2.5 rounded-xl px-1 outline-none focus-visible:ring-2 focus-visible:ring-copy-primary/30 [&::-webkit-details-marker]:hidden">
      <TaskStatusIcon status={status} />

      <span className="min-w-0 flex-1">
        {/*
          The live region sits on the title rather than on the <summary>:
          role="status" on the summary would override its implicit button role
          and take the disclosure out of the accessibility tree. This is still
          exactly one announcing element, and only while the step is live — a
          finished task announces nothing.
        */}
        <span
          {...(isLive ? { role: "status", "aria-live": "polite" as const } : {})}
          className="block truncate text-xs font-medium text-copy-primary"
        >
          {title}
        </span>
        {detail ? (
          <span className="block truncate text-xs text-copy-muted">{detail}</span>
        ) : null}
      </span>

      <ChevronDown
        aria-hidden
        className="size-3.5 shrink-0 text-copy-faint transition-transform group-open:rotate-180 motion-reduce:transition-none"
      />
    </summary>
  )
}

/** Status is always an icon *and* the words beside it — never colour alone. */
function TaskStatusIcon({ status }: { status: RunTaskStatus }) {
  if (status === "running") {
    return (
      <Loader2
        aria-hidden
        className="size-3.5 shrink-0 text-copy-primary motion-safe:animate-spin"
      />
    )
  }

  if (status === "error") {
    return <CircleX aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
  }

  return <Check aria-hidden className="size-3.5 shrink-0 text-copy-primary" />
}

function TaskContent({ children }: { children: ReactNode }) {
  return (
    <ol className="flex flex-col gap-2 pb-2 pl-6 pt-1 text-xs">{children}</ol>
  )
}

/**
 * New items fade up instead of appearing instantly, so a run reads as progress
 * rather than as the panel snapping between states. Only new *parts* animate:
 * a reasoning delta appends under its existing key, so React updates that
 * element in place.
 */
const ENTRANCE =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200"

function TaskItem({ children }: { children: ReactNode }) {
  return <li className={cn("min-w-0", ENTRANCE)}>{children}</li>
}

/**
 * The thing an operation acted on, as a bordered chip.
 *
 * This is what makes a stack of canvas edits scannable: eight rows reading
 * `addNode` are indistinguishable until each one names the node it added.
 */
function TaskFile({ children }: { children: ReactNode }) {
  return (
    <span className="mt-0.5 inline-flex max-w-full items-center rounded-md border border-surface-border bg-page px-1.5 py-0.5 font-mono text-xs wrap-anywhere text-copy-secondary">
      {children}
    </span>
  )
}

export const Task = {
  Root: TaskRoot,
  Trigger: TaskTrigger,
  Content: TaskContent,
  Item: TaskItem,
  File: TaskFile,
}
