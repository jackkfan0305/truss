"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { ModelMessage } from "ai"
import { UserButton } from "@clerk/nextjs"
import { CircleAlert, Unplug } from "lucide-react"

import { useCanvasSyncNow } from "@/components/canvas/canvas-save-context"
import { AiChatComposer } from "@/components/chat/ai-chat-composer"
import { OpenRouterLogo } from "@/components/chat/openrouter-logo"
import { ThinkingOrb } from "@/components/chat/thinking-orb"
import { SidebarResizeHandle } from "@/components/editor/sidebar-resize-handle"
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
import { readAssistantChat, writeAssistantChat } from "@/lib/assistant-history"
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

/** The Clerk profile menu, with Disconnect OpenRouter while a key is stored. */
export function ProfileButton() {
  const apiKey = useSyncExternalStore(subscribeToKey, () => getKey(), () => null)
  return (
    <UserButton>
      {apiKey ? (
        <UserButton.MenuItems>
          <UserButton.Action
            label="Disconnect OpenRouter"
            labelIcon={<Unplug className="size-4" />}
            onClick={() => {
              disconnect()
              window.dispatchEvent(new Event(OPENROUTER_KEY_CHANGE_EVENT))
            }}
          />
        </UserButton.MenuItems>
      ) : null}
    </UserButton>
  )
}

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
  const syncNow = useCanvasSyncNow()
  const actions = useMemo(() => {
    const base = createAssistantActions()
    return {
      ...base,
      // Fetch the write now so the canvas replays it while the turn goes on,
      // instead of on the next idle poll up to four seconds later.
      async applyDiagramEdit(input: Parameters<typeof base.applyDiagramEdit>[0]) {
        const result = await base.applyDiagramEdit(input)
        if ("applied" in result && input.diagramId === diagramId) syncNow()
        return result
      },
    }
  }, [diagramId, syncNow])
  // Read once on mount. The transcript only renders once the key resolves,
  // after hydration, so the server's empty chat never has to match it.
  const [saved] = useState(() =>
    typeof window === "undefined"
      ? { messages: [], history: [] }
      : readAssistantChat(window.localStorage, diagramId)
  )
  const [messages, setMessages] = useState<ChatMessage[]>(saved.messages)
  const transcript = useRef<ChatMessage[]>(saved.messages)
  const [draft, setDraft] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  // The transcript is hidden once the key is gone, so a 401 notice lives here.
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null)
  const history = useRef<ModelMessage[]>(saved.history)
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

  function saveChat() {
    writeAssistantChat(window.localStorage, diagramId, {
      messages: transcript.current,
      history: history.current,
    })
  }

  function updateTurn(turnId: string, update: (turn: AssistantTurn) => AssistantTurn) {
    transcript.current = transcript.current.map((message) =>
      message.id === turnId && message.role === "assistant"
        ? { ...message, turn: update(message.turn) }
        : message
    )
    setMessages(transcript.current)
  }

  async function send(text: string) {
    const userText = text.trim()
    if (!userText || !apiKey || isRunning) return

    // Clear this diagram's saved transcript together with model history.
    if (userText === "/clear") {
      setDraft("")
      history.current = []
      transcript.current = []
      setMessages([])
      saveChat()
      return
    }

    const sentAt = Date.now()
    const turnId = `assistant-${sentAt}`
    setDraft("")
    transcript.current = [
      ...transcript.current,
      { id: `user-${sentAt}`, role: "user", content: userText, sentAt },
      { id: turnId, role: "assistant", turn: startAssistantTurn(), sentAt },
    ]
    setMessages(transcript.current)
    saveChat()
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
    saveChat()
    controller.current = null
    setIsRunning(false)
  }

  // Disconnecting from the profile menu stops a running turn too.
  useEffect(() => {
    if (!apiKey) controller.current?.abort()
  }, [apiKey])

  return (
    // Mirrors DiagramSidebar on the right edge; an overlay, so the canvas never reflows.
    <aside
      id="assistant-sidebar"
      aria-label="Assistant"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-0 right-0 z-40 flex w-(--assistant-sidebar-w) max-w-[calc(100%-1.5rem)] flex-col overflow-hidden border-l border-surface-border bg-elevated pt-16 shadow-2xl md:pt-3.5 shadow-page/80 transition-[translate,filter,opacity] ease-smooth-out motion-reduce:transition-none",
        isOpen ? "translate-x-0 duration-400" : "translate-x-[calc(100%+2rem)] duration-350 opacity-0 blur-[14px]"
      )}
    >
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
              emptyState={<EmptyChat />}
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

      <SidebarResizeHandle
        side="right"
        cssVar="--assistant-sidebar-w"
        min={320}
        max={768}
        label="Resize assistant panel"
      />
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

/**
 * Centred, so the orb's glow has room on every side: the transcript scrolls,
 * which clips sideways overflow, and a left-aligned orb lost the left of its halo.
 */
function EmptyChat() {
  return (
    <div className="flex h-full min-h-80 flex-col items-center justify-center px-6 py-8 text-center">
      {/* `breathing` rather than `working`: nothing is running, and an orb
          animating a phase of work would say otherwise. */}
      <ThinkingOrb state="breathing" size={64} label="" gravity />
      <h3 className="mt-5 text-base font-medium text-copy-primary">
        What should we design?
      </h3>
      <p className="mt-1.5 max-w-[30ch] text-sm leading-relaxed text-pretty text-copy-muted">
        Describe a system, ask for an edit, or ask about what is on the canvas.
      </p>
    </div>
  )
}
