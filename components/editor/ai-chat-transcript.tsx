"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, Loader2 } from "lucide-react"

import { AiRunActivity } from "@/components/editor/ai-run-activity"
import { DesignRunObserver } from "@/components/editor/design-run-observer"
import { Button } from "@/components/ui/button"
import type {
  DesignRunSettlement,
  RunSubscription,
} from "@/hooks/use-design-run"
import type { AiRunTurn } from "@/lib/ai-run-turns"
import type { ChatMessage } from "@/lib/ai-chat"
import { renderChatMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"
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

  /** Rides the bottom while a run streams. Smoothness is CSS, see `scroll-smooth`. */
  const followToBottom = useCallback(() => {
    const element = scrollRef.current

    if (element && shouldFollow.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [])
  const turnsByPrompt = useMemo(
    () => new Map(turns.map((turn) => [turn.promptMessageId, turn])),
    [turns]
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
   * With `scroll-smooth` the browser fires `scroll` for every frame on the way
   * down, and those frames read as "not at the bottom" — deciding from them
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
    element.scrollTop = element.scrollHeight
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
        className="h-full overflow-y-auto overscroll-contain scroll-smooth pr-1 motion-reduce:scroll-auto"
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

              return (
                <MessageWithRun
                  key={message.id}
                  message={message}
                  isOwn={message.senderId === selfId}
                  turn={turn}
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
  turn,
  status,
  subscription,
  onRunSettled,
}: {
  message: ChatMessage
  isOwn: boolean
  turn?: AiRunTurn
  status: AiStatusMessage | null
  subscription: RunSubscription | null
  onRunSettled: (settlement: DesignRunSettlement) => void
}) {
  const isObservedRun =
    Boolean(turn?.runId) && turn?.runId === subscription?.runId

  return (
    <>
      <ChatEntry message={message} isOwn={isOwn} />
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
 * No avatars: a human message is the one on the raised surface, the assistant
 * writes straight onto the panel. That is the whole distinction, and it costs
 * nothing to read.
 *
 * The name survives only where it carries information — another collaborator in
 * a shared room. "You" and "Truss" are still announced, but to screen readers
 * only, since a background colour is not something a reader can hear.
 */
function ChatEntry({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  const isAi = message.role === "assistant"
  const author = isOwn ? "You" : isAi ? "Truss" : message.senderName

  return (
    <li className={isAi ? "flex flex-col" : "ml-6 flex flex-col gap-1.5"}>
      <span
        className={cn(
          "text-xs font-medium text-copy-secondary",
          isOwn || isAi ? "sr-only" : undefined
        )}
      >
        {author}
      </span>
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
 * Markdown output is plain tags with no classes on them, so it is styled from
 * the container. Arbitrary variants rather than a typography plugin: this is a
 * short chat message, and a prose preset would have to be half-overridden to
 * stop fighting the panel's palette.
 *
 * Exported because the spec preview renders the same `lib/markdown.ts` output
 * into the same panel palette. It overrides the heading steps for a document —
 * `cn` merges those, since a spec has real hierarchy and a chat message does not.
 */
export const MARKDOWN_STYLES = [
  "[&_p]:my-0 [&_p+p]:mt-2",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-4",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-4",
  "[&_li]:my-0.5 [&_li::marker]:text-copy-faint",
  "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:text-sm [&_h1]:font-medium",
  "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-medium",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium",
  "[&_strong]:font-medium [&_strong]:text-copy-primary",
  "[&_em]:italic",
  "[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-copy-faint hover:[&_a]:decoration-copy-primary",
  "[&_code]:rounded [&_code]:bg-elevated [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-elevated [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l [&_blockquote]:border-surface-border [&_blockquote]:pl-3 [&_blockquote]:text-copy-muted",
  "[&_hr]:my-3 [&_hr]:border-surface-border",
  "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto",
  "[&_th]:border [&_th]:border-surface-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-surface-border [&_td]:px-2 [&_td]:py-1",
].join(" ")

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
