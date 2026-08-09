"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { ArrowDown, Loader2 } from "lucide-react"

import { AiRunActivity } from "@/components/editor/ai-run-activity"
import { DesignRunObserver } from "@/components/editor/design-run-observer"
import { Button } from "@/components/ui/button"
import type {
  DesignRunSettlement,
  RunSubscription,
} from "@/hooks/use-design-run"
import { useCollaborators } from "@/hooks/use-collaborators"
import type { AiRunTurn } from "@/lib/ai-run-turns"
import { selectAiActivityTimeline } from "@/lib/ai-timeline"
import type { ChatMessage } from "@/lib/ai-chat"
import { MARKDOWN_STYLES, renderChatMarkdown } from "@/lib/markdown"
import { getInitials } from "@/lib/presence"
import { cn } from "@/lib/utils"
import type { AiChatRun, AiStatusMessage } from "@/types/tasks"

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
  const turnsByPrompt = useMemo(
    () => new Map(turns.map((turn) => [turn.promptMessageId, turn])),
    [turns]
  )

  /*
   * Every message written before `senderAvatar` existed carries no picture, and
   * that is most of any existing transcript. Anyone *currently in the room* is
   * already broadcasting theirs through presence, keyed by the same Clerk ID the
   * message is stamped with — so their history gets a face for as long as they
   * are here, and falls back to initials once they leave.
   *
   * ponytail: connected collaborators only. Backfilling a departed sender's
   * avatar would mean fetching Clerk per unknown ID; add that if old
   * conversations turn out to be read cold often.
   */
  const collaborators = useCollaborators()
  const liveAvatars = useMemo(
    () =>
      new Map(
        collaborators.flatMap((collaborator) =>
          collaborator.info?.avatar
            ? [[collaborator.id, collaborator.info.avatar] as const]
            : []
        )
      ),
    [collaborators]
  )
  const hasLocalActiveTurn = turns.some(
    (turn) => turn.phase === "starting" || turn.phase === "running"
  )

  /*
   * A settled run exists twice for whoever started it: once as this session's
   * live turn, once as the log persisted on the assistant's message. The
   * persisted copy is the one everyone in the room can see and the one that
   * survives a reload, so it wins — but only for runs that actually made it onto
   * the feed, which is why this is a set of ids rather than a flag.
   */
  const persistedRunIds = useMemo(
    () =>
      new Set(
        messages.flatMap((message) => (message.run ? [message.run.runId] : []))
      ),
    [messages]
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
            {messages.map((message) => {
              const turn = turnsByPrompt.get(message.id)
              /*
               * Only a *settled* turn defers to its persisted copy. The worker
               * writes the message before it emits the stream's terminal marker,
               * so a live turn whose message has already landed is still the
               * thing holding the observer that settles the run — dropping it
               * there would leave the composer locked for good.
               */
              const isSettled =
                turn?.phase === "complete" || turn?.phase === "error"
              const isPersisted =
                isSettled && Boolean(turn.runId && persistedRunIds.has(turn.runId))

              return (
                <MessageWithRun
                  key={message.id}
                  message={message}
                  isOwn={message.senderId === selfId}
                  liveAvatar={liveAvatars.get(message.senderId)}
                  turn={isPersisted ? undefined : turn}
                  status={status}
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
  liveAvatar,
  turn,
  status,
  subscription,
  onRunSettled,
}: {
  message: ChatMessage
  isOwn: boolean
  liveAvatar?: string
  turn?: AiRunTurn
  status: AiStatusMessage | null
  subscription: RunSubscription | null
  onRunSettled: (settlement: DesignRunSettlement) => void
}) {
  const isObservedRun =
    Boolean(turn?.runId) && turn?.runId === subscription?.runId

  return (
    <>
      {/* The log comes *before* the answer it produced, the way it happened —
          and the way the live stream already reads. */}
      {message.run ? <PersistedRunActivity run={message.run} /> : null}
      <ChatEntry message={message} isOwn={isOwn} liveAvatar={liveAvatar} />
      {turn && subscription && isObservedRun ? (
        <DesignRunObserver
          key={subscription.runId}
          subscription={subscription}
          turn={turn}
          status={status}
          onSettled={onRunSettled}
        />
      ) : turn ? (
        <AiRunActivity turn={turn} status={status} />
      ) : null}
    </>
  )
}

/**
 * A finished run's stored work log, rendered by the same component that draws
 * the live one — the stored shape is the live shape minus its positional ids,
 * so rebuilding a turn around it costs nothing and keeps one renderer.
 *
 * `status` is always null: a status line describes a run in flight, and this one
 * ended before the reader arrived.
 */
function PersistedRunActivity({ run }: { run: AiChatRun }) {
  const activity = useMemo(
    () => selectAiActivityTimeline(run.activity),
    [run.activity]
  )

  return (
    <AiRunActivity
      turn={{
        promptMessageId: `run-${run.runId}`,
        runId: run.runId,
        phase: run.phase,
        activity,
        startedAt: 0,
      }}
      status={null}
    />
  )
}

/**
 * A human message is the one on the raised surface, the assistant writes
 * straight onto the panel. That distinction carries the two cases a reader is
 * always in, and costs nothing to read.
 *
 * Identity is drawn only where it carries information — another collaborator in
 * a shared room, who gets their Clerk picture and their name over the bubble.
 * You already know which messages are yours, and the assistant is the only thing
 * writing straight onto the panel, so "You" and "Truss" are announced to screen
 * readers only: a background colour is not something a reader can hear.
 */
function ChatEntry({
  message,
  isOwn,
  liveAvatar,
}: {
  message: ChatMessage
  isOwn: boolean
  liveAvatar?: string
}) {
  const isAi = message.role === "assistant"
  const isCollaborator = !isAi && !isOwn
  const author = isOwn ? "You" : isAi ? "Truss" : message.senderName

  return (
    <li className="flex flex-col gap-1.5">
      {/* Avatar and name ride *above* the bubble rather than beside it, so every
          message in the panel — yours, theirs, the assistant's — shares one left
          edge and the column reads as a single conversation. */}
      {isCollaborator ? (
        <span className="flex items-center gap-2">
          <ChatAvatar
            name={message.senderName}
            avatar={message.senderAvatar ?? liveAvatar}
          />
          <span className="min-w-0 truncate text-xs font-medium text-copy-secondary">
            {author}
          </span>
        </span>
      ) : (
        <span className="sr-only">{author}</span>
      )}
      <time className="sr-only" dateTime={new Date(message.sentAt).toISOString()}>
        Sent at {new Date(message.sentAt).toISOString()}
      </time>
      {isAi ? (
        /*
         * Markdown, and only on the assistant's side. A prompt is something a
         * person typed, so rendering it would silently eat their asterisks and
         * underscores; the assistant's replies are the ones written as prose
         * with lists and code in them.
         *
         * `dangerouslySetInnerHTML` is safe here for exactly one reason —
         * `lib/markdown.ts` runs markdown-it with `html: false`, so raw HTML in
         * a message is escaped into visible text rather than parsed. That file
         * is the sanitizer; read it before changing anything here.
         */
        <div
          className={cn(
            "wrap-anywhere text-sm leading-relaxed text-copy-primary",
            MARKDOWN_STYLES
          )}
          dangerouslySetInnerHTML={{
            __html: renderChatMarkdown(message.content),
          }}
        />
      ) : (
        <p className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-elevated px-3 py-2.5 text-sm leading-relaxed text-copy-primary">
          {message.content}
        </p>
      )}
    </li>
  )
}

/**
 * A bare circle at the Clerk `UserButton`'s own 1.75rem — no ring, because this
 * one never overlaps a neighbour the way the navbar's presence stack does, and
 * the two should read as the same control in both places.
 *
 * `next/image` only resolves hosts listed in `next.config.ts`;
 * `parseAiChatMessage` has already pinned the URL to the one that is, and
 * anything it dropped lands on initials here.
 */
function ChatAvatar({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated text-[10px] font-medium text-copy-primary">
      {avatar ? (
        <Image
          src={avatar}
          alt={name}
          width={28}
          height={28}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{getInitials(name)}</span>
      )}
    </span>
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
