"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RealtimeRun } from "@trigger.dev/core/v3"
import { useRealtimeRun, useRealtimeStream } from "@trigger.dev/react-hooks"

import { AiRunActivity } from "@/components/editor/ai-run-activity"
import type {
  DesignRunSettlement,
  RunSubscription,
} from "@/hooks/use-design-run"
import { resolveAiRunPhase, type AiRunTurn } from "@/lib/ai-run-turns"
import {
  appendAiActivityTimelinePart,
  type AiTimelinePart,
} from "@/lib/ai-timeline"
import type { designAgent } from "@/trigger/design-agent"
import {
  AI_ACTIVITY_STREAM_ID,
  isAiActivityTerminalPart,
  type AiStatusMessage,
} from "@/types/tasks"

interface DesignRunObserverProps {
  subscription: RunSubscription
  turn: AiRunTurn
  status: AiStatusMessage | null
  onSettled: (settlement: DesignRunSettlement) => void
}

const TERMINAL_GRACE_MS = 1_500

/** One keyed observer with a locally controlled, lossless activity accumulator. */
export function DesignRunObserver({
  subscription,
  turn,
  status,
  onSettled,
}: DesignRunObserverProps) {
  const [activity, setActivity] = useState<AiTimelinePart[]>([])
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

    if (!phase) {
      return
    }

    didSettleRef.current = true
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }

    onSettled({
      // The observer is keyed by run id, so its subscription is the only run it
      // can be describing — including on the terminal-marker path, which settles
      // before there is a run record to read an id off.
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
      setActivity(next)
    },
    [settleIfReady]
  )

  const handleComplete = useCallback(
    (run: RealtimeRun<typeof designAgent>, runError?: Error) => {
      if (run.id !== subscription.runId) {
        return
      }

      runOutcomeRef.current =
        runError || run.status !== "COMPLETED" ? "error" : "complete"

      // A healthy run settles off its terminal marker long before this fires —
      // the run record lags the worker by ~30s. So reaching here without a
      // marker means the run died without running its `finally`, and the grace
      // period only guards against the marker being a moment behind.
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

  // A dead stream will never deliver a terminal marker, so waiting out the
  // grace period for one is pointless — hand the run record the decision the
  // moment it arrives (or immediately, if it already has).
  useEffect(() => {
    if (activityError) {
      didGraceElapseRef.current = true
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

  return <AiRunActivity turn={{ ...turn, activity }} status={status} />
}
