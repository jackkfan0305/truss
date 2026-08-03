"use client"

import { useState } from "react"
import { Bot, Download, FileText, Send, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface AiSidebarProps {
  isOpen: boolean
  onClose: () => void
}

interface ChatMessage {
  id: string
  role: "user" | "assistant"
  text: string
}

const STARTER_PROMPTS = [
  "Design an e-commerce backend",
  "Create a chat app architecture",
  "Build a CI/CD pipeline",
]

/**
 * Floating AI panel. UI only — no model calls yet, so sending a prompt echoes a
 * fixed placeholder reply. Open/close stays with EditorShell.
 */
export function AiSidebar({ isOpen, onClose }: AiSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: "user", text: trimmed },
      {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        // ponytail: canned reply until generation lands (spec 20 scope limit).
        text: "Generation isn't wired up yet — this is a preview of the chat layout.",
      },
    ])
    setDraft("")
  }

  return (
    <aside
      aria-label="AI assistant"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-3 right-3 z-40 flex w-80 max-w-[calc(100%-1.5rem)] flex-col gap-3 rounded-2xl border border-surface-border bg-surface/80 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "translate-x-[calc(100%+2rem)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-ai-text" />
          <div>
            <h2 className="text-sm font-medium text-copy-primary">
              AI Workspace
            </h2>
            <p className="text-xs text-copy-muted">Collaborate with Truss</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close AI sidebar"
        >
          <X className="h-4 w-4 text-copy-muted" />
        </Button>
      </div>

      <Tabs defaultValue="architect" className="min-h-0 flex-1">
        <TabsList className="w-full bg-subtle">
          <TabsTrigger
            value="architect"
            className="text-copy-muted data-active:bg-ai data-active:text-copy-primary"
          >
            AI Architect
          </TabsTrigger>
          <TabsTrigger
            value="specs"
            className="text-copy-muted data-active:bg-ai data-active:text-copy-primary"
          >
            Specs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="architect" className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <EmptyChat onPick={send} />
            ) : (
              <ul className="flex flex-col gap-2">
                {messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                      message.role === "user"
                        ? "self-end border-2 border-brand/50 bg-accent-dim text-copy-primary"
                        : "self-start border border-surface-border bg-elevated text-ai-text"
                    )}
                  >
                    {message.text}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              // Enter sends; Shift+Enter keeps the textarea's newline default.
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  send(draft)
                }
              }}
              placeholder="Describe the system you want to design…"
              aria-label="Message the AI architect"
              // `field-sizing-content` on the base component does the growing.
              className="max-h-40 min-h-[72px] resize-none bg-elevated text-sm"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              className="bg-ai text-white hover:bg-ai/80"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="specs" className="flex min-h-0 flex-col gap-3">
          <Button className="w-full bg-ai text-white hover:bg-ai/80">
            <Sparkles className="h-4 w-4" />
            Generate Spec
          </Button>

          <div className="rounded-2xl border border-surface-border bg-elevated p-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-ai-text" />
              <h3 className="text-sm font-medium text-copy-primary">
                Payments Service Spec
              </h3>
            </div>
            <p className="mt-2 text-xs text-copy-muted">
              Checkout flow, webhook retries, and ledger invariants across the
              payment gateway boundary.
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled
              className="mt-2 text-copy-muted"
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function EmptyChat({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <Bot className="h-8 w-8 text-copy-faint" />
      <p className="text-sm text-copy-muted">
        Ask the AI architect to draft a system, or start from a prompt below.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-xl bg-subtle px-2.5 py-1.5 text-xs text-ai-text transition-colors hover:bg-elevated"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  )
}
