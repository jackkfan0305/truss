"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, Loader2 } from "lucide-react"

import {
  AiRunActivity,
  type AiRunActivityState,
} from "@/components/editor/ai-run-activity"
import { ChatEntry } from "@/components/editor/chat-entry"
import { DesignRunObserver } from "@/components/editor/design-run-observer"
import { Button } from "@/components/ui/button"
import type {
  DesignRunSettlement,
  RunSubscription,
} from "@/hooks/use-design-run"
import type { AiRunTurn } from "@/lib/ai-run-turns"
import {
  armAiChatRunStaleTimer,
  arrangeAiChatMessages,
  resolveAiChatRunPhase,
  shouldShowLocalAiRunActivity,
  type ChatMessage,
} from "@/lib/ai-chat"
import { selectAiActivityTimeline } from "@/lib/ai-timeline"
import type { AiStatusMessage } from "@/types/tasks"

interface AiChatTranscriptProps {
  messages: ChatMessage[]
  selfId: string | null
  turns: AiRunTurn[]
  status: AiStatusMessage | null
  isRoomActive: boolean
  emptyState: React.ReactNode
  subscription: RunSubscription | null
  onRunSettled: (settlement: DesignRunSettlement) => void
  hasOlderMessages: boolean
  isFetchingOlder: boolean
  onFetchOlder: () => void
}

const FOLLOW_THRESHOLD_PX = 48
/** Fraction of the remaining distance closed per frame, plus a floor so the
 * tail of the ease still lands instead of crawling sub-pixel. */
const FOLLOW_EASE = 0.2
const FOLLOW_MIN_STEP_PX = 1

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** Shared messages with caller-only run activity inserted after its prompt. */
export function AiChatTranscript({
  messages,
  selfId,
  turns,
  status,
  isRoomActive,
  emptyState,
  subscription,
  onRunSettled,
  hasOlderMessages,
  isFetchingOlder,
  onFetchOlder,
}: AiChatTranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldFollow = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const isNearBottom = useCallback(() => {
    const element = scrollRef.current

    if (!element) return true

    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      FOLLOW_THRESHOLD_PX
    )
  }, [])

  /*
   * Rides the bottom while a run streams, on its own rAF ease rather than CSS
   * `scroll-smooth`. A streaming run grows the content every few frames, and
   * every growth re-issues the scroll — with `scroll-smooth` each of those
   * restarts the browser's ease from a standstill, which reads as a stutter
   * that never catches up and then snaps. One continuous loop that always
   * chases the *current* bottom is smooth no matter how the content arrives.
   */
  const frameRef = useRef<number | null>(null)

  const followToBottom = useCallback(() => {
    if (!shouldFollow.current || frameRef.current !== null) return

    const step = () => {
      const element = scrollRef.current
      frameRef.current = null

      if (!element || !shouldFollow.current) return

      const remaining =
        element.scrollHeight - element.clientHeight - element.scrollTop

      if (remaining < FOLLOW_MIN_STEP_PX) {
        element.scrollTop = element.scrollHeight
        return
      }

      element.scrollTop += Math.max(remaining * FOLLOW_EASE, FOLLOW_MIN_STEP_PX)
      frameRef.current = requestAnimationFrame(step)
    }

    if (prefersReducedMotion()) {
      const element = scrollRef.current

      if (element) element.scrollTop = element.scrollHeight
      return
    }

    frameRef.current = requestAnimationFrame(step)
  }, [])

  /*
   * Clearing the ref matters as much as cancelling the frame: `followToBottom`
   * treats a non-null ref as "a loop is already running", so a cancelled id
   * left behind would block every later call. StrictMode's remount in dev hits
   * this on the very first render and kills follow for the whole session.
   */
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    },
    []
  )
  const arrangedMessages = useMemo(() => arrangeAiChatMessages(messages), [messages])
  const turnsByPrompt = useMemo(
    () => new Map(turns.map((turn) => [turn.promptMessageId, turn])),
    [turns]
  )
  const persistedRunPromptIds = useMemo(
    () =>
      new Set(
        messages.flatMap((message) =>
          message.run ? [message.run.promptMessageId] : []
        )
      ),
    [messages]
  )
  const hasLocalActiveTurn = turns.some(
    (turn) => turn.phase === "starting" || turn.phase === "running"
  )

  useEffect(followToBottom, [followToBottom, messages, turns, isRoomActive])

  /*
   * The observer is what follows a *streaming* run. Activity parts live in the
   * observer component's own state, so they change this subtree's height
   * without changing any prop here — there is no render of this component to
   * hang an effect on, and watching the element is the only signal.
   */
  useEffect(() => {
    const viewport = scrollRef.current
    const content = viewport?.firstElementChild

    if (!viewport || !content) return

    const observer = new ResizeObserver(followToBottom)

    observer.observe(content)
    return () => observer.disconnect()
  }, [followToBottom, messages.length, turns.length])

  /*
   * Follow is driven by what the reader *did*, not by where the viewport is.
   * The follow loop fires `scroll` for every frame on the way down, and those
   * frames read as "not at the bottom" — deciding from them
   * would drop follow mid-run and strobe the jump button for the whole
   * animation. So scrolling up releases the follow, and arriving at the bottom
   * takes it back.
   *
   * ponytail: covers wheel, trackpad and touch. Paging with the keyboard or
   * dragging the scrollbar keeps following, so the next chunk pulls the reader
   * back down. Add a `scrollend`-based guard if that ever actually bites.
   */
  const releaseFollow = useCallback(() => {
    shouldFollow.current = false
    setShowJump(true)
  }, [])

  const resumeFollowAtBottom = useCallback(() => {
    if (!isNearBottom()) return

    shouldFollow.current = true
    setShowJump(false)
  }, [isNearBottom])

  const syncFollowToPosition = useCallback(() => {
    shouldFollow.current = isNearBottom()
    setShowJump(!shouldFollow.current)
  }, [isNearBottom])

  const jumpToLatest = () => {
    const element = scrollRef.current

    if (!element) return

    shouldFollow.current = true
    setShowJump(false)
    // A one-shot jump has nothing re-targeting it, so the browser's own ease
    // is the right tool here — unlike the streaming follow above.
    element.scrollTo({
      top: element.scrollHeight,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    })
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onWheel={(event) => {
          if (event.deltaY < 0) releaseFollow()
        }}
        onTouchMove={syncFollowToPosition}
        onScroll={resumeFollowAtBottom}
        className="h-full overflow-y-auto overscroll-contain pr-1"
      >
        {messages.length === 0 && turns.length === 0 ? (
          emptyState
        ) : (
          <ol className="flex flex-col gap-5 pb-3">
            {hasOlderMessages ? (
              <li className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isFetchingOlder}
                  onClick={onFetchOlder}
                  className="min-h-11 text-xs text-copy-muted hover:bg-elevated hover:text-copy-primary"
                >
                  {isFetchingOlder ? (
                    <Loader2
                      aria-hidden
                      className="size-3.5 motion-safe:animate-spin"
                    />
                  ) : null}
                  {isFetchingOlder ? "Loading history…" : "Load older messages"}
                </Button>
              </li>
            ) : null}
            {arrangedMessages.map((message) => {
              const turn = turnsByPrompt.get(message.id)

              return (
                <MessageWithRun
                  key={message.id}
                  message={message}
                  isOwn={message.senderId === selfId}
                  turn={turn}
                  hasPersistedRun={persistedRunPromptIds.has(message.id)}
                  subscription={subscription}
                  onRunSettled={onRunSettled}
                />
              )
            })}

            {isRoomActive && !hasLocalActiveTurn ? (
              <RemoteRunStatus status={status} />
            ) : null}
          </ol>
        )}
      </div>

      {showJump ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={jumpToLatest}
          className="absolute bottom-2 left-1/2 min-h-11 -translate-x-1/2 bg-page text-copy-primary shadow-lg shadow-page/80 focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
        >
          <ArrowDown aria-hidden className="size-3.5" />
          Jump to latest
        </Button>
      ) : null}
    </div>
  )
}

function MessageWithRun({
  message,
  isOwn,
  turn,
  hasPersistedRun,
  subscription,
  onRunSettled,
}: {
  message: ChatMessage
  isOwn: boolean
  turn?: AiRunTurn
  hasPersistedRun: boolean
  subscription: RunSubscription | null
  onRunSettled: (settlement: DesignRunSettlement) => void
}) {
  const isObservedRun =
    Boolean(turn?.runId) && turn?.runId === subscription?.runId
  const showLocalActivity = Boolean(
    turn && shouldShowLocalAiRunActivity(turn, hasPersistedRun)
  )

  return (
    <>
      <ChatEntry
        message={message}
        isOwn={isOwn}
        activity={message.run ? <PersistedAiRunActivity message={message} /> : undefined}
      />
      {turn && showLocalActivity ? (
        <li>
          <AiRunActivity state={toAiRunActivityState(turn)} />
        </li>
      ) : null}
      {turn && subscription && isObservedRun ? (
        <DesignRunObserver
          key={subscription.runId}
          subscription={subscription}
          onSettled={onRunSettled}
        />
      ) : null}
    </>
  )
}

function toAiRunActivityState(turn: AiRunTurn): AiRunActivityState {
  return {
    id: turn.promptMessageId,
    runId: turn.runId,
    phase: turn.phase,
    activity: turn.activity,
  }
}

/** A persisted run is authoritative and turns incomplete only after its TTL. */
function PersistedAiRunActivity({ message }: { message: ChatMessage }) {
  const run = message.run
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (run?.phase !== "running") return

    return armAiChatRunStaleTimer(
      message.updatedAt,
      {
        now: () => Date.now(),
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (timer) => window.clearTimeout(timer),
      },
      () => setNow(Date.now())
    )
  }, [message.updatedAt, run?.phase])

  if (!run) return null

  return (
    <AiRunActivity
      state={{
        id: message.id,
        runId: run.runId,
        phase: resolveAiChatRunPhase(run.phase, message.updatedAt, now),
        activity: selectAiActivityTimeline(run.activity),
      }}
    />
  )
}



function RemoteRunStatus({ status }: { status: AiStatusMessage | null }) {
  return (
    <li
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-copy-muted"
    >
      <Loader2
        aria-hidden
        className="size-3.5 motion-safe:animate-spin text-copy-primary"
      />
      <span>{status?.text ?? "A collaborator’s agent is working…"}</span>
    </li>
  )
}
