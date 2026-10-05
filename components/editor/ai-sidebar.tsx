"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { ModelMessage } from "ai"
import { CircleAlert } from "lucide-react"

import { AiChatComposer } from "@/components/chat/ai-chat-composer"
import { OpenRouterLogo } from "@/components/chat/openrouter-logo"
import { ThinkingOrb } from "@/components/chat/thinking-orb"
import { AiChatTranscript } from "@/components/editor/ai-chat-transcript"
import type { ChatMessage } from "@/components/editor/chat-entry"
import { Button } from "@/components/ui/button"
import { runAssistantTurn, type AssistantEvent } from "@/lib/assistant-chat"
import {
  ASSISTANT_MODEL_CHANGE_EVENT,
  DEFAULT_ASSISTANT_MODEL_ID,
  readAssistantModel,
  writeAssistantModel,
} from "@/lib/assistant-models"
import { createAssistantActions } from "@/lib/assistant-tools"
import {
  applyAssistantEvent,
  settleAssistantTurn,
  startAssistantTurn,
  type AssistantTurn,
} from "@/lib/assistant-turn"
import {
  disconnect,
  getKey,
  OPENROUTER_KEY_CHANGE_EVENT,
  startConnect,
} from "@/lib/openrouter-auth"
import { cn } from "@/lib/utils"

function subscribeTo(eventName: string) {
  return (onChange: () => void) => {
    window.addEventListener(eventName, onChange)
    window.addEventListener("storage", onChange)
    return () => {
      window.removeEventListener(eventName, onChange)
      window.removeEventListener("storage", onChange)
    }
  }
}

const subscribeToKey = subscribeTo(OPENROUTER_KEY_CHANGE_EVENT)
const subscribeToModel = subscribeTo(ASSISTANT_MODEL_CHANGE_EVENT)

function pickModel(id: string) {
  writeAssistantModel(window.localStorage, id)
  window.dispatchEvent(new Event(ASSISTANT_MODEL_CHANGE_EVENT))
}

/**
 * Starters for an empty conversation. Two ask for a diagram and one asks a
 * question, because the panel answers as well as draws.
 */
const STARTER_PROMPTS = [
  "Design an e-commerce backend",
  "Create a chat app architecture",
  "What would you add to this system?",
]

/** The editor's side chat, backed by the browser OpenRouter assistant. */
export function AiSidebar({
  isOpen,
  diagramId,
}: {
  isOpen: boolean
  diagramId: string
}) {
  // External stores, so the server render (no key, default model) and the
  // first client render agree and nothing hydrates differently.
  const apiKey = useSyncExternalStore(subscribeToKey, () => getKey(), () => null)
  const modelId = useSyncExternalStore(
    subscribeToModel,
    () => readAssistantModel(window.localStorage),
    () => DEFAULT_ASSISTANT_MODEL_ID
  )
  const actions = useMemo(() => createAssistantActions(), [])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  // The transcript is hidden once the key is gone, so a 401 notice lives here.
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null)
  const history = useRef<ModelMessage[]>([])
  const controller = useRef<AbortController | null>(null)
  const isMounted = useRef(false)

  // Leaving the editor (a "Created" link, another diagram) stops the turn so it
  // spends no more credits and writes nothing more to the canvas.
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      controller.current?.abort()
    }
  }, [])

  function updateTurn(turnId: string, update: (turn: AssistantTurn) => AssistantTurn) {
    setMessages((current) =>
      current.map((message) =>
        message.id === turnId && message.role === "assistant"
          ? { ...message, turn: update(message.turn) }
          : message
      )
    )
  }

  async function send(text: string) {
    const userText = text.trim()
    if (!userText || !apiKey || isRunning) return

    const sentAt = Date.now()
    const turnId = `assistant-${sentAt}`
    setDraft("")
    setMessages((current) => [
      ...current,
      { id: `user-${sentAt}`, role: "user", content: userText, sentAt },
      { id: turnId, role: "assistant", turn: startAssistantTurn(), sentAt },
    ])
    setIsRunning(true)
    const turnController = new AbortController()
    controller.current = turnController

    const result = await runAssistantTurn({
      apiKey,
      modelId,
      diagramId,
      history: history.current,
      userText,
      actions,
      signal: turnController.signal,
      onEvent: (event: AssistantEvent) => updateTurn(turnId, (turn) => applyAssistantEvent(turn, event)),
    })
    if (!isMounted.current) return

    history.current = result.history
    updateTurn(turnId, (turn) =>
      settleAssistantTurn(turn, {
        error: result.error?.message ?? null,
        aborted: turnController.signal.aborted,
      })
    )
    if (result.error?.clearKey) {
      setDisconnectNotice(result.error.message)
      disconnect()
      window.dispatchEvent(new Event(OPENROUTER_KEY_CHANGE_EVENT))
    }
    controller.current = null
    setIsRunning(false)
  }

  function disconnectOpenRouter() {
    controller.current?.abort()
    setDisconnectNotice(null)
    disconnect()
    window.dispatchEvent(new Event(OPENROUTER_KEY_CHANGE_EVENT))
  }

  return (
    // Mirrors DiagramSidebar on the right edge; an overlay, so the canvas never reflows.
    <aside
      id="assistant-sidebar"
      aria-label="Assistant"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-0 right-0 z-40 flex w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden border-l border-surface-border bg-elevated pt-16 shadow-2xl shadow-page/80 transition-transform ease-smooth-out motion-reduce:transition-none",
        isOpen ? "translate-x-0 duration-400" : "translate-x-[calc(100%+2rem)] duration-350"
      )}
    >
      <div className="flex min-h-9 items-center justify-between gap-2 px-4">
        <h2 className="text-sm font-medium text-copy-primary">Assistant</h2>
        {apiKey ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={disconnectOpenRouter}
            className="-mr-2.5 text-copy-muted hover:text-copy-primary"
          >
            Disconnect
          </Button>
        ) : null}
      </div>

      {apiKey ? (
        <>
          {/*
            Must stay a flex column: the transcript sizes itself as a flex item
            and its scroll viewport is `h-full`, so a block parent leaves both
            heights indefinite and the reply spills over the composer.
          */}
          <div className="flex min-h-0 flex-1 flex-col px-4 pt-2">
            <AiChatTranscript
              messages={messages}
              emptyState={<EmptyChat onPick={(prompt) => void send(prompt)} isDisabled={isRunning} />}
            />
          </div>

          {/* No bar behind the composer: the box hangs on the panel and the
              transcript scrolls up to meet it. */}
          <div className="px-4 py-3">
            <AiChatComposer
              draft={draft}
              isWorking={isRunning}
              modelId={modelId}
              onDraftChange={setDraft}
              onModelChange={pickModel}
              onSubmit={(text) => void send(text)}
              onStop={() => controller.current?.abort()}
            />
          </div>
        </>
      ) : (
        <ConnectOpenRouter notice={disconnectNotice} />
      )}
    </aside>
  )
}

/** The panel's sign-in screen while no OpenRouter key is stored. */
function ConnectOpenRouter({ notice }: { notice: string | null }) {
  return (
    <div className="flex flex-1 flex-col justify-center px-6 pb-16">
      <div className="flex items-center gap-2 text-copy-primary">
        <span className="flex size-8 items-center justify-center rounded-lg border border-surface-border bg-subtle">
          <OpenRouterLogo className="size-4" />
        </span>
        <span className="text-sm font-medium">OpenRouter</span>
      </div>
      <h3 className="mt-6 text-lg font-semibold text-copy-primary">
        Connect OpenRouter
      </h3>
      <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-copy-muted">
        Create and discuss diagrams with a model of your choice. Your key stays
        in this browser, and your OpenRouter account pays for model calls.
      </p>
      {notice ? (
        <p
          role="alert"
          className="mt-6 flex items-center gap-2 text-xs text-copy-primary"
        >
          <CircleAlert aria-hidden className="size-3.5 shrink-0 text-state-error" />
          {notice}
        </p>
      ) : null}
      <Button
        size="lg"
        className={cn("self-start focus-visible:ring-2 focus-visible:ring-copy-primary/60", notice ? "mt-3" : "mt-6")}
        onClick={() => void startConnect(window.location.pathname)}
      >
        <OpenRouterLogo className="size-4" />
        Connect with OpenRouter
      </Button>
    </div>
  )
}

function EmptyChat({
  onPick,
  isDisabled,
}: {
  onPick: (prompt: string) => void
  isDisabled: boolean
}) {
  return (
    <div className="flex h-full min-h-80 flex-col justify-center py-8">
      {/* `breathing` rather than `working`: nothing is running, and an orb
          animating a phase of work would say otherwise. */}
      <ThinkingOrb state="breathing" size={64} label="" />
      <h3 className="mt-4 text-base font-medium text-copy-primary">
        What should we design?
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-copy-muted">
        Describe a system, ask for an edit, or ask a question about what is on
        the canvas.
      </p>

      {/*
        Prompts, not a stack of generic outline buttons: no border, a quiet
        surface that lifts on hover, and the text left-aligned so the three
        read as a list of things to say rather than as three equal controls.
      */}
      <ul className="mt-5 flex flex-col gap-1.5">
        {STARTER_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              onClick={() => onPick(prompt)}
              disabled={isDisabled}
              className="flex min-h-11 w-full items-center rounded-xl bg-subtle px-3 text-left text-xs text-copy-secondary outline-none hover:bg-surface-border/60 hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
