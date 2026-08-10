"use client"

import { useCallback, useEffect, useRef } from "react"
import type { RealtimeRun } from "@trigger.dev/core/v3"
import { useRealtimeRun, useRealtimeStream } from "@trigger.dev/react-hooks"

import type {
  AgentRunSettlement,
  RunSubscription,
} from "@/hooks/use-agent-run"
import { resolveAiRunPhase } from "@/lib/ai-run-turns"
import {
  appendAiActivityTimelinePart,
  type AiTimelinePart,
} from "@/lib/ai-timeline"
import type { orchestrator } from "@/trigger/orchestrator"
import { AI_ACTIVITY_STREAM_ID, isAiActivityTerminalPart } from "@/types/tasks"

export interface DesignRunObserverProps {
  subscription: RunSubscription
  onSettled: (settlement: AgentRunSettlement) => void
}

const TERMINAL_GRACE_MS = 1_500

/** One keyed observer with a locally controlled, lossless activity accumulator. */
export function DesignRunObserver({
  subscription,
  onSettled,
}: DesignRunObserverProps) {
  const activityRef = useRef<AiTimelinePart[]>([])
  const sourceIndexRef = useRef(0)
  const terminalPhaseRef = useRef<"complete" | "error" | null>(null)
  const runOutcomeRef = useRef<"complete" | "error" | null>(null)
  const didGraceElapseRef = useRef(false)
  const didSettleRef = useRef(false)
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const settleIfReady = useCallback(() => {
    if (didSettleRef.current) {
      return
    }

    const phase = resolveAiRunPhase({
      terminalPhase: terminalPhaseRef.current,
      runOutcome: runOutcomeRef.current,
      didGraceElapse: didGraceElapseRef.current,
    })

    if (!phase) return

    didSettleRef.current = true
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }

    onSettled({
      runId: subscription.runId,
      phase,
      activity: activityRef.current,
    })
  }, [onSettled, subscription.runId])

  const handleActivity = useCallback(
    (rawPart: unknown) => {
      if (isAiActivityTerminalPart(rawPart)) {
        terminalPhaseRef.current = rawPart.phase
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
    (run: RealtimeRun<typeof orchestrator>, runError?: Error) => {
      if (run.id !== subscription.runId) return

      runOutcomeRef.current =
        runError || run.status !== "COMPLETED" ? "error" : "complete"

      if (!didSettleRef.current && fallbackTimerRef.current === null) {
        fallbackTimerRef.current = setTimeout(() => {
          fallbackTimerRef.current = null
          didGraceElapseRef.current = true
          settleIfReady()
        }, TERMINAL_GRACE_MS)
      }

      settleIfReady()
    },
    [settleIfReady, subscription.runId]
  )

  // `onData` is the authoritative accumulator. The installed hook's `parts`
  // cache can overwrite bursty zero-throttle chunks before its ref commits, so
  // it is intentionally ignored here.
  useRealtimeStream<unknown>(
    subscription.runId,
    AI_ACTIVITY_STREAM_ID,
    {
      id: `${subscription.runId}-activity`,
      accessToken: subscription.token,
      onData: handleActivity,
    }
  )

  useRealtimeRun<typeof orchestrator>(subscription.runId, {
    id: `${subscription.runId}-run`,
    accessToken: subscription.token,
    onComplete: handleComplete,
  })

  /*
   * The stream's `error` used to settle the run from an effect here. Both are
   * gone: it was only ever a 1.5s shortcut, because `settleIfReady` needs a run
   * outcome regardless — so the effect could never settle anything by itself,
   * and by the time `handleComplete` has that outcome it has already scheduled
   * the grace timer that settles. Dropping it costs at most TERMINAL_GRACE_MS
   * on a stream that has already failed, and buys back a component that reports
   * to its parent only from callbacks.
   */

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
