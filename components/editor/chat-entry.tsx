import { Response } from "@/components/chat/response"
import { Message, MessageContent } from "@/components/ai-elements/message-frame"
import { AiRunTasks, RunOutcomeLine } from "@/components/editor/ai-run-tasks"
import type { AssistantTurn } from "@/lib/assistant-turn"

/** One side chat line. Lives in component state, so a reload starts fresh. */
export type ChatMessage =
  | { id: string; role: "user"; content: string; sentAt: number }
  | { id: string; role: "assistant"; turn: AssistantTurn; sentAt: number }

/** One transcript entry: your prompt, or the assistant's work log and reply. */
export function ChatEntry({ message }: { message: ChatMessage }) {
  const timestamp = new Date(message.sentAt).toISOString()

  if (message.role === "assistant") {
    const { turn } = message
    const isStreaming = turn.phase === "running"

    return (
      <li data-chat-message-id={message.id} className="flex flex-col gap-2">
        <span className="sr-only">Assistant</span>
        <time className="sr-only" dateTime={timestamp}>
          Sent at {timestamp}
        </time>
        <Message from="assistant" className="max-w-full gap-2">
          <MessageContent className="w-full max-w-full gap-2 overflow-visible">
            <AiRunTasks turn={turn} />
            {/* Mounted before the first word so the reveal starts promptly. */}
            {turn.text || isStreaming ? (
              <Response
                className={turn.text ? "text-sm leading-relaxed text-copy-primary" : "hidden"}
                isStreaming={isStreaming}
              >
                {turn.text}
              </Response>
            ) : null}
            <RunOutcomeLine turn={turn} />
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
