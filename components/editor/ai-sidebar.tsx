"use client"

import { useState } from "react"
import { useRoom } from "@liveblocks/react"
import { ArrowUp, Bot, CircleAlert, Loader2, Sparkles } from "lucide-react"

import { AiChatTranscript } from "@/components/editor/ai-chat-transcript"
import { SpecPanel } from "@/components/editor/spec-panel"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAiChat } from "@/hooks/use-ai-chat"
import { useAiStatus } from "@/hooks/use-ai-status"
import { useDesignRun } from "@/hooks/use-design-run"
import { cn } from "@/lib/utils"
import {
  AI_DESIGN_MODELS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  MAX_CHAT_CONTENT_LENGTH,
  type AiDesignModelId,
} from "@/types/tasks"

interface AiSidebarProps {
  isOpen: boolean
}

const STARTER_PROMPTS = [
  "Design an e-commerce backend",
  "Create a chat app architecture",
  "Build a CI/CD pipeline",
]

/** Monochrome AI workspace with room chat and run-scoped activity streams. */
export function AiSidebar({ isOpen }: AiSidebarProps) {
  const [draft, setDraft] = useState("")
  const [modelId, setModelId] = useState<AiDesignModelId>(
    DEFAULT_AI_DESIGN_MODEL_ID
  )
  const roomId = useRoom().id
  const { message: status, isGenerating } = useAiStatus()
  const {
    messages,
    send,
    error,
    isSending,
    canSend,
    selfId,
    hasOlderMessages,
    isFetchingOlder,
    fetchOlderMessages,
  } = useAiChat()
  const { start, isRunning, turns, subscription, settle } =
    useDesignRun(roomId)
  const isComposerDisabled = !canSend || isSending || isRunning

  const submit = async (text: string) => {
    if (isComposerDisabled) return

    const promptMessageId = await send(text)

    if (!promptMessageId) return

    setDraft("")
    await start(text, promptMessageId, modelId)
  }

  return (
    <aside
      id="ai-sidebar"
      aria-label="AI assistant"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-0 right-0 z-40 flex w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden border-l border-surface-border bg-surface shadow-2xl shadow-page/80 transition-transform duration-200 ease-out motion-reduce:transition-none",
        isOpen ? "translate-x-0" : "translate-x-[calc(100%+2rem)]"
      )}
    >
      {/* No title bar. The tabs already say what the panel is, and the floating
          control is its only close affordance. `aria-label` names the region. */}
      <Tabs defaultValue="architect" className="min-h-0 flex-1 gap-0">
        <div className="flex items-center gap-2 border-b border-surface-border pr-4 pl-16 xl:pl-14">
          <TabsList
            variant="line"
            className="h-11 min-w-0 flex-1 justify-start gap-5 border-0 px-0"
          >
            <TabsTrigger
              value="architect"
              className="h-11 flex-none px-0 text-xs text-copy-muted data-active:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
            >
              Chat
            </TabsTrigger>
            <TabsTrigger
              value="specs"
              className="h-11 flex-none px-0 text-xs text-copy-muted data-active:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
            >
              Specs
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="architect"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="min-h-0 flex-1 px-4 pt-4 max-xl:pt-14">
            <AiChatTranscript
              messages={messages}
              selfId={selfId}
              turns={turns}
              status={status}
              isRoomActive={isGenerating}
              subscription={subscription}
              onRunSettled={settle}
              hasOlderMessages={hasOlderMessages}
              isFetchingOlder={isFetchingOlder}
              onFetchOlder={fetchOlderMessages}
              emptyState={
                <EmptyChat
                  onPick={submit}
                  isDisabled={isComposerDisabled}
                />
              }
            />
          </div>

          {/* No bar behind the composer: no top border, no fill. The box hangs
              on the panel and the transcript scrolls up to meet it. */}
          <div className="p-3">
            {error ? (
              <p
                role="alert"
                className="mb-2 flex items-center gap-2 text-xs text-copy-primary"
              >
                <CircleAlert aria-hidden className="size-3.5" />
                {error}
              </p>
            ) : null}

            <form
              className="rounded-2xl border border-surface-border px-3 py-2.5 focus-within:border-copy-primary focus-within:ring-1 focus-within:ring-copy-primary/20"
              onSubmit={(event) => {
                event.preventDefault()
                void submit(draft)
              }}
            >
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submit(draft)
                  }
                }}
                maxLength={MAX_CHAT_CONTENT_LENGTH}
                disabled={isComposerDisabled}
                placeholder={
                  isRunning
                    ? "Working on the canvas…"
                    : canSend
                      ? "Ask Truss to design or edit the system…"
                      : "Connecting to the room…"
                }
                aria-label="Ask Truss to design or edit the system"
                /*
                 * The four background resets are all load-bearing. The textarea
                 * primitive fills itself with `dark:bg-input/30`, and swaps to
                 * `dark:disabled:bg-input/80` while disabled — which is exactly
                 * when a run is in flight — so a plain `bg-transparent` loses to
                 * both variants and the grey comes back the moment you send.
                 */
                className="max-h-40 min-h-12 resize-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <ModelPicker
                  value={modelId}
                  onChange={setModelId}
                  disabled={isRunning}
                />
                <Button
                  type="submit"
                  size="icon-sm"
                  disabled={isComposerDisabled}
                  aria-busy={isSending || isRunning}
                  aria-label={
                    isSending
                      ? "Sending"
                      : isRunning
                        ? "Agent is working"
                        : "Send message"
                  }
                  className="size-7 shrink-0 rounded-full bg-copy-primary text-page hover:bg-copy-secondary focus-visible:border-copy-primary focus-visible:ring-copy-primary/30"
                >
                  {isSending || isRunning ? (
                    <Loader2
                      aria-hidden
                      className="size-3.5 motion-safe:animate-spin"
                    />
                  ) : (
                    <ArrowUp aria-hidden className="size-3.5" />
                  )}
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>

        {/* Grid rows rather than a flex column: the spec list scrolls in a
            ScrollArea, whose viewport needs a definite height to size against. */}
        <TabsContent
          value="specs"
          className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 p-4 max-xl:pt-14"
        >
          {/* Still inert: `29` wires viewing, and triggering a run from here
              needs the canvas graph, which this panel does not hold. */}
          <Button className="min-h-11 w-full bg-copy-primary text-page hover:bg-copy-secondary focus-visible:border-copy-primary focus-visible:ring-copy-primary/30">
            <Sparkles aria-hidden className="size-4" />
            Generate Spec
          </Button>

          {/* A room ID *is* its project ID — lib/room-id.ts. */}
          <SpecPanel projectId={roomId} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}

/**
 * The model the next prompt runs on.
 *
 * The trigger is stripped to plain text and a chevron — no border, no filled
 * background — because it sits *inside* the composer's own border and a second
 * bordered control there reads as a nested box rather than as a setting on the
 * thing it belongs to. The popup keeps the shadcn styling as generated.
 */
function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value: AiDesignModelId
  onChange: (modelId: AiDesignModelId) => void
  disabled: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as AiDesignModelId)}
      disabled={disabled}
      items={MODEL_ITEMS}
    >
      <SelectTrigger
        size="sm"
        aria-label="Design model"
        className="h-7 gap-1 border-0 bg-transparent px-1.5 text-xs text-copy-secondary shadow-none hover:bg-elevated focus-visible:ring-1 focus-visible:ring-copy-primary/30 dark:bg-transparent dark:hover:bg-elevated [&_svg]:size-3 [&_svg]:text-copy-faint"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-56">
        {AI_DESIGN_MODELS.map((model) => (
          <SelectItem key={model.id} value={model.id} className="text-xs">
            <span className="flex w-full items-center justify-between gap-3">
              <span className="truncate">{model.label}</span>
              <span className="shrink-0 text-copy-faint">{model.hint}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Base UI renders the closed trigger from this list rather than from the
 * selected `<SelectItem>`, so the label has to be given here too — without it
 * the trigger shows the raw model id.
 */
const MODEL_ITEMS = AI_DESIGN_MODELS.map((model) => ({
  value: model.id,
  label: model.label,
}))

function EmptyChat({
  onPick,
  isDisabled,
}: {
  onPick: (prompt: string) => void
  isDisabled: boolean
}) {
  return (
    <div className="flex h-full min-h-80 flex-col justify-center py-8">
      <span className="grid size-10 place-items-center rounded-xl border border-surface-border bg-page">
        <Bot aria-hidden className="size-5 text-copy-primary" />
      </span>
      <h3 className="mt-4 text-base font-medium text-copy-primary">
        What should we design?
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-copy-muted">
        Describe a system or ask for an edit. Truss streams its work here while
        the shared canvas updates.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <Button
            key={prompt}
            type="button"
            variant="outline"
            onClick={() => onPick(prompt)}
            disabled={isDisabled}
            className="min-h-11 justify-start border-surface-border bg-page px-3 text-left text-xs text-copy-secondary hover:bg-elevated hover:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
          >
            {prompt}
          </Button>
        ))}
      </div>
    </div>
  )
}
