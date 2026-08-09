import Image from "next/image"

import { getInitials } from "@/lib/presence"
import type { ChatMessage } from "@/lib/ai-chat"
import { MARKDOWN_STYLES, renderChatMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"

interface ChatEntryProps {
  message: ChatMessage
  isOwn: boolean
  activity?: React.ReactNode
  liveAvatar?: string
}

/** One transcript entry with the identity cues a shared project worklog needs. */
export function ChatEntry({
  message,
  isOwn,
  activity,
  liveAvatar,
}: ChatEntryProps) {
  const isAssistant = message.role === "assistant"
  const timestamp = new Date(message.sentAt).toISOString()

  if (isAssistant) {
    return (
      <li className="flex flex-col gap-2">
        <span className="sr-only">Truss</span>
        <time className="sr-only" dateTime={timestamp}>
          Sent at {timestamp}
        </time>
        {activity}
        {message.content ? (
          <div
            className={cn(
              "wrap-anywhere text-sm leading-relaxed text-copy-primary",
              MARKDOWN_STYLES
            )}
            dangerouslySetInnerHTML={{
              __html: renderChatMarkdown(message.content),
            }}
          />
        ) : null}
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
          <p className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-elevated px-3 py-2.5 text-sm leading-relaxed text-copy-primary">
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
      <p className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-elevated px-3 py-2.5 text-sm leading-relaxed text-copy-primary">
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
