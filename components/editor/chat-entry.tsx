import Image from "next/image"

import { getInitials } from "@/lib/presence"
import type { ChatMessage } from "@/lib/ai-chat"
import { Response } from "@/components/chat/response"

interface ChatEntryProps {
  message: ChatMessage
  isOwn: boolean
  activity?: React.ReactNode
  /**
   * Documents this turn produced, rendered *after* the closing message and
   * outside the work-log disclosure: a spec is the result of the turn, not a
   * step within it.
   */
  attachments?: React.ReactNode
  liveAvatar?: string
}

/** One transcript entry with the identity cues a shared project worklog needs. */
export function ChatEntry({
  message,
  isOwn,
  activity,
  attachments,
  liveAvatar,
}: ChatEntryProps) {
  const isAssistant = message.role === "assistant"
  const timestamp = new Date(message.sentAt).toISOString()
  // Deltas are still landing while the run's own row reports "running" — see
  // `appendContent` in `lib/ai-run-chat.ts`, which only flips the phase at
  // `finish()`, alongside the final content. That is the one signal this
  // message carries for whether more text is still arriving.
  const isStreaming = message.run?.phase === "running"

  if (isAssistant) {
    return (
      <li className="flex flex-col gap-2">
        <span className="sr-only">Truss</span>
        <time className="sr-only" dateTime={timestamp}>
          Sent at {timestamp}
        </time>
        {activity}
        {message.content ? (
          <Response
            className="text-sm leading-relaxed text-copy-primary"
            isStreaming={isStreaming}
          >
            {message.content}
          </Response>
        ) : null}
        {attachments}
      </li>
    )
  }

  if (!isOwn) {
    return (
      <li className="flex items-start gap-2.5">
        <ChatAvatar
          name={message.senderName}
          avatar={message.senderAvatar ?? liveAvatar}
        />
        <div className="min-w-0 flex-1">
          <span className="mb-1.5 block text-xs font-medium text-copy-secondary">
            {message.senderName}
          </span>
          <time className="sr-only" dateTime={timestamp}>
            Sent at {timestamp}
          </time>
          <p className="whitespace-pre-wrap wrap-anywhere rounded-2xl bg-elevated px-3 py-2.5 text-sm leading-relaxed text-copy-primary">
            {message.content}
          </p>
        </div>
      </li>
    )
  }

  return (
    <li className="ml-6 flex flex-col gap-1.5">
      <span className="sr-only">You</span>
      <time className="sr-only" dateTime={timestamp}>
        Sent at {timestamp}
      </time>
      <p className="whitespace-pre-wrap wrap-anywhere rounded-2xl bg-elevated px-3 py-2 text-sm leading-relaxed text-copy-primary">
        {message.content}
      </p>
    </li>
  )
}

function ChatAvatar({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-subtle text-xs font-medium text-copy-secondary">
      {avatar ? (
        <Image
          src={avatar}
          alt={name}
          width={28}
          height={28}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden>{getInitials(name)}</span>
      )}
    </span>
  )
}
