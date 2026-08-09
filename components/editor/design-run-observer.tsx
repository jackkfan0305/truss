"use client"

import { useCallback, useEffect, useRef } from "react"
import type { RealtimeRun } from "@trigger.dev/core/v3"
import { useRealtimeRun, useRealtimeStream } from "@trigger.dev/react-hooks"

import type {
  DesignRunSettlement,
  RunSubscription,
} from "@/hooks/use-design-run"
import {
  appendAiActivityTimelinePart,
  type AiTimelinePart,
} from "@/lib/ai-timeline"
import type { designAgent } from "@/trigger/design-agent"
import { AI_ACTIVITY_STREAM_ID, isAiActivityTerminalPart } from "@/types/tasks"

export interface DesignRunObserverProps {
  subscription: RunSubscription
  onSettled: (settlement: DesignRunSettlement) => void
}

interface CompletedRun {
  run: RealtimeRun<typeof designAgent>
  error?: Error
}

const TERMINAL_GRACE_MS = 1_500

/** One keyed observer with a locally controlled, lossless activity accumulator. */
export function DesignRunObserver({
  subscription,
  onSettled,
}: DesignRunObserverProps) {
  const activityRef = useRef<AiTimelinePart[]>([])
  const sourceIndexRef = useRef(0)
  const receivedTerminalRef = useRef(false)
  const completedRunRef = useRef<CompletedRun | null>(null)
  const didSettleRef = useRef(false)
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const settleIfReady = useCallback(() => {
    const completed = completedRunRef.current

    if (
      didSettleRef.current ||
      !receivedTerminalRef.current ||
      !completed ||
      completed.run.id !== subscription.runId
    ) {
      return
    }

    didSettleRef.current = true
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
    const didFail =
      Boolean(completed.error) || completed.run.status !== "COMPLETED"

    onSettled({
      runId: completed.run.id,
      phase: didFail ? "error" : "complete",
      activity: activityRef.current,
    })
  }, [onSettled, subscription.runId])

  const handleActivity = useCallback(
    (rawPart: unknown) => {
      if (isAiActivityTerminalPart(rawPart)) {
        receivedTerminalRef.current = true
        settleIfReady()
        return
      }

      const next = appendAiActivityTimelinePart(
        activityRef.current,
        rawPart,
        sourceIndexRef.current
      )

      sourceIndexRef.current += 1
      activityRef.current = next
    },
    [settleIfReady]
  )

  const handleComplete = useCallback(
    (run: RealtimeRun<typeof designAgent>, runError?: Error) => {
      completedRunRef.current = { run, error: runError }
      settleIfReady()

      // Normally the worker closes the activity stream before the run becomes
      // terminal. Transport failure or a hard kill can omit that marker, so a
      // short grace period prevents a permanently locked composer without
      // truncating a healthy stream's final tail.
      if (!receivedTerminalRef.current && !didSettleRef.current) {
        fallbackTimerRef.current = setTimeout(() => {
          receivedTerminalRef.current = true
          settleIfReady()
        }, TERMINAL_GRACE_MS)
      }
    },
    [settleIfReady]
  )

  // `onData` is the authoritative accumulator. The installed hook's `parts`
  // cache can overwrite bursty zero-throttle chunks before its ref commits, so
  // it is intentionally ignored here.
  const { error: activityError } = useRealtimeStream<unknown>(
    subscription.runId,
    AI_ACTIVITY_STREAM_ID,
    {
      id: `${subscription.runId}-activity`,
      accessToken: subscription.token,
      onData: handleActivity,
    }
  )

  useRealtimeRun<typeof designAgent>(subscription.runId, {
    id: `${subscription.runId}-run`,
    accessToken: subscription.token,
    onComplete: handleComplete,
  })

  useEffect(() => {
    if (activityError) {
      receivedTerminalRef.current = true
      settleIfReady()
    }
  }, [activityError, settleIfReady])

  useEffect(
    () => () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current)
      }
    },
    []
  )

  return null
}
