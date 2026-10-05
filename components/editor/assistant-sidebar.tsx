"use client"

import { useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react"
import Link from "next/link"
import { Square, Send } from "lucide-react"
import type { ModelMessage } from "ai"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { runAssistantTurn, type AssistantEvent } from "@/lib/assistant-chat"
import {
  ASSISTANT_MODEL_CHANGE_EVENT,
  ASSISTANT_MODELS,
  DEFAULT_ASSISTANT_MODEL_ID,
  readAssistantModel,
  writeAssistantModel,
} from "@/lib/assistant-models"
import { createAssistantActions } from "@/lib/assistant-tools"
import {
  disconnect,
  getKey,
  OPENROUTER_KEY_CHANGE_EVENT,
  startConnect,
} from "@/lib/openrouter-auth"
import { cn } from "@/lib/utils"

export type FeedEntry =
  | { kind: "user" | "assistant" | "notice"; text: string }
  | { kind: "tool"; text: string; href?: string }

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

export function AssistantSidebar({
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
  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [draft, setDraft] = useState("")
  const [isRunning, setIsRunning] = useState(false)
  // The feed is hidden once the key is gone, so a 401 notice lives here.
  const [disconnectNotice, setDisconnectNotice] = useState<string | null>(null)
  const history = useRef<ModelMessage[]>([])
  const controller = useRef<AbortController | null>(null)

  function appendEvent(event: AssistantEvent) {
    setEntries((current) => {
      if (event.type === "tool") {
        return [...current, { kind: "tool", text: event.label, href: event.href }]
      }
      const last = current.at(-1)
      // Token by token: deltas extend the reply they belong to.
      return last?.kind === "assistant"
        ? [...current.slice(0, -1), { kind: "assistant", text: last.text + event.text }]
        : [...current, { kind: "assistant", text: event.text }]
    })
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    const userText = draft.trim()
    if (!userText || !apiKey || isRunning) return

    setDraft("")
    setEntries((current) => [...current, { kind: "user", text: userText }])
    setIsRunning(true)
    controller.current = new AbortController()

    const result = await runAssistantTurn({
      apiKey,
      modelId,
      diagramId,
      history: history.current,
      userText,
      actions,
      signal: controller.current.signal,
      onEvent: appendEvent,
    })

    history.current = result.history
    if (result.error) {
      const { message, clearKey } = result.error
      setEntries((current) => [...current, { kind: "notice", text: message }])
      if (clearKey) {
        setDisconnectNotice(message)
        disconnect()
        window.dispatchEvent(new Event(OPENROUTER_KEY_CHANGE_EVENT))
      }
    }
    controller.current = null
    setIsRunning(false)
  }

  function pickModel(id: string) {
    writeAssistantModel(window.localStorage, id)
    window.dispatchEvent(new Event(ASSISTANT_MODEL_CHANGE_EVENT))
  }

  function disconnectOpenRouter() {
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
        "absolute inset-y-0 right-0 z-40 flex w-96 max-w-[calc(100%-1.5rem)] flex-col gap-3 border-l border-surface-border bg-elevated px-4 pt-16 pb-4 shadow-2xl shadow-page/80 transition-transform ease-smooth-out motion-reduce:transition-none",
        isOpen ? "translate-x-0 duration-400" : "translate-x-[calc(100%+2rem)] duration-350"
      )}
    >
      <h2 className="text-sm font-medium text-copy-primary">Assistant</h2>

      {apiKey ? (
        <>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="assistant-model">
              Model
            </label>
            <select
              id="assistant-model"
              value={modelId}
              onChange={(event) => pickModel(event.target.value)}
              disabled={isRunning}
              className="h-8 min-w-0 flex-1 rounded-md border border-surface-border bg-page px-2 text-sm text-copy-primary"
            >
              <optgroup label="Paid">
                {ASSISTANT_MODELS.filter((model) => model.tier === "paid").map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Free">
                {ASSISTANT_MODELS.filter((model) => model.tier === "free").map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <Button variant="ghost" size="sm" onClick={disconnectOpenRouter}>
              Disconnect
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
            <AssistantFeed entries={entries} />
          </div>

          <form onSubmit={send} className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="assistant-input">
              Message the assistant
            </label>
            <Textarea
              id="assistant-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Ask about this diagram, or describe one to create"
              rows={3}
            />
            {isRunning ? (
              <Button type="button" variant="secondary" onClick={() => controller.current?.abort()}>
                <Square className="size-4" />
                Stop
              </Button>
            ) : (
              <Button type="submit" disabled={!draft.trim()}>
                <Send className="size-4" />
                Send
              </Button>
            )}
          </form>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-start gap-3">
          {disconnectNotice ? (
            <p role="alert" className="text-xs text-state-error">
              {disconnectNotice}
            </p>
          ) : null}
          <p className="text-sm text-copy-muted">
            Connect your OpenRouter account to create and discuss diagrams here. Your
            key stays in this browser and your OpenRouter account pays for the calls.
          </p>
          <Button onClick={() => void startConnect(window.location.pathname)}>
            Connect OpenRouter
          </Button>
        </div>
      )}
    </aside>
  )
}

/** Plain text only: model output never becomes markup. */
export function AssistantFeed({ entries }: { entries: FeedEntry[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <li
          key={index}
          className={cn(
            "text-sm whitespace-pre-wrap",
            entry.kind === "user" && "self-end rounded-lg bg-page px-3 py-2 text-copy-primary",
            entry.kind === "assistant" && "text-copy-primary",
            entry.kind === "tool" && "text-xs text-copy-muted",
            entry.kind === "notice" && "text-xs text-state-error"
          )}
        >
          {entry.kind === "tool" && entry.href ? (
            <Link href={entry.href} className="underline">
              {entry.text}
            </Link>
          ) : (
            entry.text
          )}
        </li>
      ))}
    </ol>
  )
}
