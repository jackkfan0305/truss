"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown } from "lucide-react"

import { ChatEntry, type ChatMessage } from "@/components/editor/chat-entry"
import { Button } from "@/components/ui/button"

interface AiChatTranscriptProps {
  messages: ChatMessage[]
  emptyState: ReactNode
}

const FOLLOW_THRESHOLD_PX = 48
/** Fraction of the remaining distance closed per frame, plus a floor so the
 * tail of the ease still lands instead of crawling sub-pixel. */
const FOLLOW_EASE = 0.2
const FOLLOW_MIN_STEP_PX = 1

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The conversation, following the newest line until the reader scrolls away. */
export function AiChatTranscript({ messages, emptyState }: AiChatTranscriptProps) {
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
   * Rides the bottom while a turn streams, on its own rAF ease rather than CSS
   * `scroll-smooth`. A streaming turn grows the content every few frames, and
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

  useEffect(followToBottom, [followToBottom, messages])

  /*
   * The smooth reveal grows the reply after the messages prop has settled, so
   * the content's own size is the signal that keeps the follow going.
   */
  const hasMessages = messages.length > 0

  useEffect(() => {
    const viewport = scrollRef.current
    const content = viewport?.firstElementChild

    if (!viewport || !content) return

    const observer = new ResizeObserver(followToBottom)

    observer.observe(content)
    return () => observer.disconnect()
  }, [followToBottom, hasMessages])

  /*
   * Follow is driven by what the reader *did*, not by where the viewport is.
   * The follow loop fires `scroll` for every frame on the way down, and those
   * frames read as "not at the bottom" — deciding from them would drop follow
   * mid-turn and strobe the jump button for the whole animation. So scrolling
   * up releases the follow, and arriving at the bottom takes it back.
   *
   * ponytail: covers wheel, trackpad, touch and paging keys. Dragging the
   * scrollbar keeps following, so the next chunk pulls the reader back down.
   * Add a `scrollend`-based guard if that ever actually bites.
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
        role="log"
        aria-label="Assistant conversation"
        tabIndex={0}
        onWheel={(event) => {
          if (event.deltaY < 0) releaseFollow()
        }}
        onTouchMove={releaseFollow}
        onPointerDown={releaseFollow}
        onKeyDown={(event) => {
          if (
            event.key === "PageUp" ||
            event.key === "ArrowUp" ||
            event.key === "Home" ||
            (event.key === " " && event.shiftKey)
          ) {
            releaseFollow()
          }
        }}
        onScroll={resumeFollowAtBottom}
        className="h-full overflow-y-auto overscroll-contain pr-1"
      >
        {hasMessages ? (
          <ol className="flex flex-col gap-5 pb-3">
            {messages.map((message) => (
              <ChatEntry key={message.id} message={message} />
            ))}
          </ol>
        ) : (
          emptyState
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
