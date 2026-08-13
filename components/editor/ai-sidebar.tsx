"use client"

import { useState } from "react"
import { useRoom } from "@liveblocks/react"
import { ArrowUp, Bot, CircleAlert, Loader2 } from "lucide-react"

import { AiChatTranscript } from "@/components/editor/ai-chat-transcript"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useAiPromptSubmission } from "@/hooks/use-ai-prompt-submission"
import { useAiStatus } from "@/hooks/use-ai-status"
import { useCollaborators } from "@/hooks/use-collaborators"
import { selectLiveRunStep } from "@/lib/ai-run-turns"
import { submitAiSidebarPrompt } from "@/lib/ai-sidebar-submission"
import { cn } from "@/lib/utils"
import {
  AI_DESIGN_MODELS,
  AI_THINKING_LEVELS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  MAX_CHAT_CONTENT_LENGTH,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks"

interface AiSidebarProps {
  isOpen: boolean
  useCollaboratorsSource?: typeof useCollaborators
}

/**
 * Starters for an empty room. Two ask for a diagram and one asks a question,
 * because the panel answers as well as draws now — three build prompts would
 * teach the opposite.
 */
const STARTER_PROMPTS = [
  "Design an e-commerce backend",
  "Create a chat app architecture",
  "What would you add to this system?",
]

/** Monochrome AI workspace with room chat and run-scoped activity streams. */
export function AiSidebar({ isOpen, useCollaboratorsSource }: AiSidebarProps) {
  const [draft, setDraft] = useState("")
  const [modelId, setModelId] = useState<AiDesignModelId>(
    DEFAULT_AI_DESIGN_MODEL_ID
  )
  const [thinkingLevel, setThinkingLevel] = useState<AiThinkingLevel>(
    DEFAULT_AI_THINKING_LEVEL
  )
  const roomId = useRoom().id
  const { message: status, isGenerating } = useAiStatus()
  const {
    chat: {
      messages,
      error,
      isSending,
      canSend,
      selfId,
      hasOlderMessages,
      isFetchingOlder,
      fetchOlderMessages,
    },
    run: { isRunning, turns, subscription, settle },
    submit: submitPrompt,
  } = useAiPromptSubmission(roomId)
  const isComposerDisabled = !canSend || isSending || isRunning
  /*
   * This client's own run when there is one, and the room's shared status when
   * the run belongs to somebody else. Local first because it is finer grained
   * and arrives sooner — the feed is one line per phase, the local stream is
   * every step. `isGenerating` is presence, never the feed: a killed run leaves
   * a `processing` message on the feed forever, and a status line driven by
   * that would sweep for the rest of the session.
   */
  const liveStep =
    selectLiveRunStep(turns) ?? (isGenerating ? status?.text ?? "Working" : null)

  const submit = (text: string) =>
    submitAiSidebarPrompt({
      text,
      isComposerDisabled,
      modelId,
      thinkingLevel,
      submitPrompt,
      clearDraft: () => setDraft(""),
    })

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
      {/*
        One surface, no tabs and no title bar. The Specs tab is gone: a spec is
        generated from chat now and attached to the turn that wrote it, so a
        second list beside the transcript was only a separate place to remember
        to look. The floating control is still this panel's one close
        affordance, and `aria-label` names the region.

        Must stay a flex column: the transcript sizes itself as a flex item and
        its scroll viewport is `h-full`, so a block parent leaves both heights
        indefinite — the viewport grows to fit the run instead of scrolling it,
        and the activity spills over the composer. The top padding clears the
        floating close control, which used to be the tab strip's job.
      */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-14">
        <AiChatTranscript
          messages={messages}
          selfId={selfId}
          turns={turns}
          status={status}
          isRoomActive={isGenerating}
          // A room ID *is* its project ID — lib/room-id.ts.
          projectId={roomId}
          subscription={subscription}
          onRunSettled={settle}
          hasOlderMessages={hasOlderMessages}
          isFetchingOlder={isFetchingOlder}
          onFetchOlder={fetchOlderMessages}
          useCollaboratorsSource={useCollaboratorsSource}
          emptyState={
            <EmptyChat onPick={submit} isDisabled={isComposerDisabled} />
          }
        />
      </div>

      {/* No bar behind the composer: no top border, no fill. The box hangs
          on the panel and the transcript scrolls up to meet it. */}
      <div className="p-3">
        <LiveStepLine step={liveStep} />

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
            /*
             * "Working on it", not "Working on the canvas": a turn may be
             * answering a question or writing a spec, and naming the canvas
             * would be wrong two times in three.
             */
            placeholder={
              isRunning
                ? "Working on it…"
                : canSend
                  ? "Ask about the system, request a change, or ask for a spec…"
                  : "Connecting to the room…"
            }
            aria-label="Ask about the system, request a change, or ask for a spec"
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
            {/* `min-w-0` on the group, not the row: both triggers truncate
                their own label rather than pushing the send button out of
                the composer on the narrowest panel width. */}
            <div className="flex min-w-0 items-center gap-0.5">
              <ModelPicker
                value={modelId}
                onChange={setModelId}
                disabled={isRunning}
              />
              <ThinkingPicker
                value={thinkingLevel}
                onChange={setThinkingLevel}
                disabled={isRunning}
              />
            </div>
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
    </aside>
  )
}

/**
 * What the agent is doing, directly above the box you are locked out of.
 *
 * The verbs used to live inside the per-turn work log, which meant the answer
 * to "why can't I type?" was behind a disclosure, several messages up, and
 * scrolled away the moment the transcript grew. Here it sits against the
 * composer's top edge and moves with it.
 *
 * No spinner beside it: the sweep across the text is the liveness cue, and an
 * icon would be a second one saying the same thing. Reserving the row height
 * whether or not there is a step would leave a permanent gap above the
 * composer, so it unmounts — the composer moves 20px, once, at the start and
 * end of a run.
 */
function LiveStepLine({ step }: { step: string | null }) {
  if (!step) return null

  return (
    <p
      role="status"
      aria-live="polite"
      className="mb-2 truncate px-1 text-xs font-medium agent-step-sweep"
    >
      {step}
    </p>
  )
}

/**
 * The model the next prompt runs on.
 *
 * Still labelled for the design work, because that is what it configures: the
 * orchestrator that routes the message runs on the default at low effort, and a
 * second picker for it would be a setting nobody turns.
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

/**
 * How hard the model thinks before answering, for the next prompt.
 *
 * Deliberately the same stripped trigger as `ModelPicker` and sat directly
 * beside it: they are two settings on one send, and giving this one its own
 * chrome would read as a different kind of control. The effort is named on the
 * trigger (`High effort`, not `High`) because next to a model name a bare
 * adjective reads as a property of the model.
 */
function ThinkingPicker({
  value,
  onChange,
  disabled,
}: {
  value: AiThinkingLevel
  onChange: (thinkingLevel: AiThinkingLevel) => void
  disabled: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as AiThinkingLevel)}
      disabled={disabled}
      items={THINKING_ITEMS}
    >
      <SelectTrigger
        size="sm"
        aria-label="Thinking effort"
        className="h-7 gap-1 border-0 bg-transparent px-1.5 text-xs text-copy-secondary shadow-none hover:bg-elevated focus-visible:ring-1 focus-visible:ring-copy-primary/30 dark:bg-transparent dark:hover:bg-elevated [&_svg]:size-3 [&_svg]:text-copy-faint"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-56">
        {AI_THINKING_LEVELS.map((level) => (
          <SelectItem key={level.id} value={level.id} className="text-xs">
            <span className="flex w-full items-center justify-between gap-3">
              <span className="truncate">{level.label}</span>
              <span className="shrink-0 text-copy-faint">{level.hint}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Same reason as `MODEL_ITEMS`: Base UI reads the closed trigger from here. */
const THINKING_ITEMS = AI_THINKING_LEVELS.map((level) => ({
  value: level.id,
  label: level.label,
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
        Describe a system, ask for an edit, or ask a question about what is on
        the canvas. Ask for a spec and the document lands here in the thread.
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
