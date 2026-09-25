import Image from "next/image"

import { getInitials } from "@/lib/presence"
import type { ChatMessage } from "@/lib/ai-chat"
import { Response } from "@/components/chat/response"
import { Message, MessageContent } from "@/components/ai-elements/message-frame"

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
      <li data-chat-message-id={message.id} className="flex flex-col gap-2">
        <span className="sr-only">Truss</span>
        <time className="sr-only" dateTime={timestamp}>
          Sent at {timestamp}
        </time>
        <Message from="assistant" className="max-w-full gap-2">
          <MessageContent className="w-full max-w-full gap-2 overflow-visible">
            {activity}
            {message.content || isStreaming ? (
              <Response
                className={message.content ? "text-sm leading-relaxed text-copy-primary" : "hidden"}
                isStreaming={isStreaming}
              >
                {message.content}
              </Response>
            ) : null}
          </MessageContent>
        </Message>
        {attachments}
      </li>
    )
  }

  if (!isOwn) {
    return (
      <li data-chat-message-id={message.id} className="flex items-start gap-2.5">
        <ChatAvatar
          name={message.senderName}
          avatar={message.senderAvatar ?? liveAvatar}
        />
        <Message from="user" className="ml-0 min-w-0 max-w-full flex-1">
          <span className="mb-1.5 block text-xs font-medium text-copy-secondary">
            {message.senderName}
          </span>
          <time className="sr-only" dateTime={timestamp}>
            Sent at {timestamp}
          </time>
          <MessageContent className="group-[.is-user]:ml-0 w-fit rounded-2xl bg-subtle px-3 py-2.5 text-copy-primary dark:bg-subtle dark:text-copy-primary">
            <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{message.content}</p>
          </MessageContent>
        </Message>
      </li>
    )
  }

  return (
    <li data-chat-message-id={message.id} className="ml-6 flex flex-col gap-1.5">
      <span className="sr-only">You</span>
      <time className="sr-only" dateTime={timestamp}>
        Sent at {timestamp}
      </time>
      <Message from="user" className="max-w-full">
        <MessageContent className="w-fit rounded-2xl bg-subtle px-3 py-2 text-copy-primary dark:bg-subtle dark:text-copy-primary">
          <p className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed">{message.content}</p>
        </MessageContent>
      </Message>
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
