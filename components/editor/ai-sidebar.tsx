"use client"

import { useState } from "react"
import { useRoom } from "@liveblocks/react"
import { CircleAlert, X } from "lucide-react"

import { AiChatComposer } from "@/components/chat/ai-chat-composer"
import { ThinkingOrb } from "@/components/chat/thinking-orb"
import { AiChatTranscript } from "@/components/editor/ai-chat-transcript"
import { Button } from "@/components/ui/button"
import { useAiPromptSubmission } from "@/hooks/use-ai-prompt-submission"
import { useAiStatus } from "@/hooks/use-ai-status"
import { useCollaborators } from "@/hooks/use-collaborators"
import { submitAiSidebarPrompt } from "@/lib/ai-sidebar-submission"
import { cn } from "@/lib/utils"
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  type AiDesignModelId,
  type AiThinkingLevel,
} from "@/types/tasks"

interface AiSidebarProps {
  isOpen: boolean
  onClose?: () => void
  useCollaboratorsSource?: typeof useCollaborators
}

/**
 * Starters for an empty room. Two ask for a diagram and one asks a question,
 * because the panel answers as well as draws — three build prompts would teach
 * the opposite.
 */
const STARTER_PROMPTS = [
  "Design an e-commerce backend",
  "Create a chat app architecture",
  "What would you add to this system?",
]

/** Monochrome AI workspace with room chat and run-scoped activity streams. */
export function AiSidebar({
  isOpen,
  onClose,
  useCollaboratorsSource,
}: AiSidebarProps) {
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
      {onClose ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close AI sidebar"
          className="absolute left-3 top-3 z-10 min-h-11 min-w-11 text-copy-secondary hover:bg-elevated hover:text-copy-primary focus-visible:border-copy-primary focus-visible:ring-copy-primary/20"
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}

      {/*
        Must stay a flex column: the transcript sizes itself as a flex item and
        its scroll viewport is `h-full`, so a block parent leaves both heights
        indefinite — the viewport grows to fit the run instead of scrolling it,
        and the activity spills over the composer.
      */}
      <div className={cn("flex min-h-0 flex-1 flex-col px-4", onClose && "pt-14")}>
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

      {/* No bar behind the composer: no top border, no fill. The box hangs on
          the panel and the transcript scrolls up to meet it. */}
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

        <AiChatComposer
          draft={draft}
          isDisabled={isComposerDisabled}
          isWorking={isRunning || isSending}
          modelId={modelId}
          thinkingLevel={thinkingLevel}
          onDraftChange={setDraft}
          onModelChange={setModelId}
          onThinkingLevelChange={setThinkingLevel}
          onSubmit={submit}
        />
      </div>
    </aside>
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
        the canvas. Ask for a spec and the document lands here in the thread.
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
              className="flex min-h-11 w-full items-center rounded-xl bg-elevated px-3 text-left text-xs text-copy-secondary outline-none hover:bg-subtle hover:text-copy-primary focus-visible:ring-2 focus-visible:ring-copy-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
