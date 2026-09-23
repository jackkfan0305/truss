# AI Elements Chat Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Truss's live AI sidebar to AI Elements web components while preserving shared chat, durable run activity, Markdown safety, and the existing Border Beam and Thinking Orbs.

**Architecture:** `AiSidebar` and `AiChatTranscript` keep the Liveblocks and Trigger.dev data flow. App-owned adapters compose the installed `components/ai-elements/` files around the validated Truss message and run types. The existing Markdown renderer and scroll behavior remain until the replacements pass their behavior checks.

**Tech Stack:** Next.js 16.2.12, React 19.2.4, TypeScript, Tailwind 4, shadcn Base UI, AI Elements registry source, AI SDK 7, Liveblocks, Trigger.dev.

**Spec:** `docs/superpowers/specs/2026-09-22-ai-elements-chat-migration-design.md`

## Global Constraints

- Read `AGENTS.md`, the six `context/*.md` files in their required order, the spec, and the relevant `node_modules/next/dist/docs/` guide before coding. Read the local Trigger.dev skill only if a task changes Trigger.dev code; this plan does not.
- The CLI-installed `components/ai-elements/` and new `components/ui/` files are present but uncommitted at plan time. Preserve the pre-existing `package.json` change that pins `trigger.dev@4.5.10`; stage only intended hunks when committing.
- Do not add `useChat`, another chat route, another transcript store, or a new run subscription. Keep `useAiPromptSubmission`, Liveblocks `ai-chat`, `DesignRunObserver`, the 315-second stale-run display rule, and the model allowlist.
- The sidebar remains neutral except for the existing Border Beam and Thinking Orbs. Keep status visible through text or an icon, and honor `prefers-reduced-motion`.
- Keep raw provider chain of thought hidden. Only validated curated `reasoning` parts may appear. Do not invent tool events, token usage, context limits, or a stop action.
- Keep generated shadcn files reusable. Put Truss styling and business rules in app-owned components. Make narrow registry compatibility fixes only when a test or current type requires them.
- Keep each task independently reviewable. Update `context/progress-tracker.md` after each task. Run its targeted verification, `npm run typecheck`, `npm run lint`, and `npm run build` before calling it done. Run `npm run verify:unit` at the final gate.

## Review Focus

These conditions need explicit coverage in the owning tasks:

1. A failed send keeps the draft and never issues a second request from a form reset or Enter repeat. Task 1 tests it.
2. Enter during IME composition inserts text rather than submitting. Task 1 tests it.
3. Loading older messages preserves the reader's position while new tokens arrive. Task 2 tests it.
4. A stale running row shows “Work stopped before completion” after reload, not a live spinner or a false failure. Task 3 tests it.
5. Malformed Markdown and unsafe links remain plain or blocked in both answers and curated reasoning. Task 4 tests it.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `components/editor/ai-sidebar.tsx` | Owns draft, model, thinking level, run state, and AI Elements composer composition. |
| `components/chat/ai-input-settings.tsx` | Adapts AI Elements Model Selector to `AI_DESIGN_MODELS` and keeps the thinking-level choice. |
| `components/editor/ai-chat-transcript.tsx` | Joins shared chat, run turns, attachments, paging, and conversation scroll behavior. |
| `components/editor/chat-entry.tsx` | Adapts a validated `ChatMessage` to AI Elements Message framing without losing identity. |
| `components/editor/ai-run-tasks.tsx` | Adapts saved activity groups to AI Elements Task, Shimmer, and Reasoning. |
| `components/chat/ai-markdown.tsx` | If the safety gate passes, one app-owned wrapper for AI Elements MessageResponse settings and link rules. Otherwise omit this file. |
| `scripts/verify-chat-composer.tsx` | Composer submission, model selection, and controls. |
| `scripts/verify-ai-chat-ui.tsx` | Message identity, task outcomes, and transcript structure. |
| `scripts/verify-chat-response.tsx` | Markdown trust boundary and partial streaming cases. |
| `context/progress-tracker.md` | Records completed slices, measured checks, and data-gated components. |

The registry files and new shadcn files were installed before this plan. Do not add a second copy. The September 21 plan is historical and must not be edited into an account of this migration.

### Task 1: Composer and model selection

**Files:** Modify `components/editor/ai-sidebar.tsx`, `components/chat/ai-input-settings.tsx`, `scripts/verify-chat-composer.tsx`, `package.json`, and `context/progress-tracker.md`. Keep the installed `components/ai-elements/prompt-input.tsx` and `model-selector.tsx` as registry code.

**Interfaces:** Consume `submitAiSidebarPrompt({ text, isComposerDisabled, modelId, thinkingLevel, submitPrompt, clearDraft }): Promise<void>`, `AI_DESIGN_MODELS`, and `AI_THINKING_LEVELS`. Preserve `AiInputSettingsProps` so the sidebar's model and thinking state remain typed. Produce a text-only `PromptInput` composition and an allowlisted `ModelSelector`.

- [ ] **Step 1: Add failing composer checks.** Extend `scripts/verify-chat-composer.tsx` with a jsdom form fixture and assertions equivalent to:

```tsx
const readyHtml = composer({ value: "Build a queue", status: "ready", isDisabled: false })
const workingHtml = composer({ value: "Build a queue", status: "working", isDisabled: true })
assert.match(readyHtml, /aria-label="Send message"/)
assert.match(workingHtml, /aria-label="Agent is working"/)
assert.doesNotMatch(workingHtml, /aria-label="Stop"/)
assert.match(submitTag(workingHtml, "Agent is working"), /disabled=""/)
```

Open the model dialog with a keyboard event and compare its visible option labels with `AI_DESIGN_MODELS.map((model) => model.label)`; assert an unknown model never appears. Use `submitAiSidebarPrompt` with a `message-error` result to assert the draft stays intact, then a successful result to assert it clears. Dispatch Enter, Shift+Enter, and an IME composition Enter event against the mounted textarea and assert one, zero, and zero submits respectively. Reject whitespace-only text before `submitPrompt`.

- [ ] **Step 2: Confirm red.** Run `npx tsx scripts/verify-chat-composer.tsx`. The AI Elements markup and picker assertions should fail against the current custom composer.

- [ ] **Step 3: Compose the new controls.** Replace the custom `AiInput` tree in `AiSidebar` with `PromptInput`, `PromptInputTextarea`, `PromptInputFooter`, `PromptInputTools`, and `PromptInputSubmit`. Keep `<ComposerBeam isActive={isRunning}>` around the form and keep the existing `ThinkingOrb` empty state. Pass controlled `value={draft}` and `onChange={(event) => setDraft(event.currentTarget.value)}`. Use this submit boundary:

```tsx
<PromptInput
  aria-busy={isRunning || isSending}
  maxFiles={0}
  onSubmit={({ text }) =>
    submitAiSidebarPrompt({
      text,
      isComposerDisabled,
      modelId,
      thinkingLevel,
      submitPrompt,
      clearDraft: () => setDraft(""),
    })
  }
>
  <PromptInputTextarea
    value={draft}
    onChange={(event) => setDraft(event.currentTarget.value)}
    disabled={isComposerDisabled}
    maxLength={MAX_CHAT_CONTENT_LENGTH}
    aria-label="Ask about the system, request a change, or ask for a spec"
  />
  <PromptInputFooter>
    <PromptInputTools>
      <AiInputSettings
        modelId={modelId}
        thinkingLevel={thinkingLevel}
        onModelChange={setModelId}
        onThinkingLevelChange={setThinkingLevel}
        disabled={isComposerDisabled}
      />
    </PromptInputTools>
    <PromptInputSubmit
      status={isRunning || isSending ? "submitted" : "ready"}
      aria-label={isRunning || isSending ? "Agent is working" : "Send message"}
      disabled={isComposerDisabled || !draft.trim()}
    />
  </PromptInputFooter>
</PromptInput>
```

Do not create a new settings store. Do not render attachment, screenshot, microphone, or stop controls. Set `maxFiles={0}` on `PromptInput` and assert that pasting a file never reaches `submitPrompt`; text-only paste still works. Set the field's maximum height to the existing five-row limit with app-level classes. Preserve `MAX_CHAT_CONTENT_LENGTH` on the textarea.

- [ ] **Step 4: Switch model selection.** In `ai-input-settings.tsx`, use `ModelSelector` with `ModelSelectorContent`, `ModelSelectorInput`, `ModelSelectorList`, `ModelSelectorGroup`, and `ModelSelectorItem`. Render `AI_DESIGN_MODELS.map` only; call `onModelChange(entry.id)` and close the dialog on selection. Keep the existing popover choice rows for `AI_THINKING_LEVELS` and disable both controls during a run. Keep the header's exact model ID.

- [ ] **Step 5: Confirm green and review.** Run `npx tsx scripts/verify-chat-composer.tsx`, typecheck, lint, and build. Manually verify a send error leaves the typed prompt visible. Record the slice in the tracker. Stage the AI Elements installation and this task's files, using `git add -p package.json` to exclude the pre-existing Trigger script hunk, then commit `feat: use AI Elements in chat composer`.

### Task 2: Conversation viewport and message framing

**Files:** Modify `components/editor/ai-chat-transcript.tsx`, `components/editor/chat-entry.tsx`, `scripts/verify-ai-chat-ui.tsx`, and `context/progress-tracker.md`.

**Interfaces:** Consume validated `ChatMessage[]`, `arrangeAiChatMessages`, existing paging callbacks, and `MessageWithRun`'s activity and attachments. Produce the same ordered `<ol>` and author cues inside AI Elements `Conversation` and `Message` components. Do not change message IDs or the run join.

- [ ] **Step 1: Add failing transcript checks.** Extend `verify-ai-chat-ui.tsx` to assert a collaborator keeps name, avatar or initials, timestamp, and a left identity rail; an own prompt remains visually distinct; the assistant's task precedes its response and its spec attachment follows it. Assert the viewport has a `role="log"` Conversation wrapper, and the older-message button remains reachable by keyboard.

```tsx
assert.match(html, /role="log"/)
assert.match(html, /Grace Hopper/)
assert.match(html, /Load older messages/)
assert.ok(html.indexOf("Applying to the canvas") < html.indexOf("The graph now"))
```

- [ ] **Step 2: Confirm red.** Run `npx tsx scripts/verify-ai-chat-ui.tsx`; the Conversation wrapper check should fail.

- [ ] **Step 3: Compose AI Elements framing.** In `ChatEntry`, wrap each human or assistant turn with `Message from={message.role}` and `MessageContent`, overriding default width, alignment, and surface classes at the call site. Keep the existing avatar, author, `time`, task, and attachment markup. In `AiChatTranscript`, replace the outer scroll viewport with `Conversation` and `ConversationContent`, preserving the existing ordered list and `DesignRunObserver` outside the visible log.

```tsx
<Conversation className="min-h-0" initial="instant" resize="instant">
  <ConversationContent className="gap-0 p-0">
    <ol className="flex flex-col gap-5 pb-3">{entries}</ol>
  </ConversationContent>
  <ConversationScrollButton aria-label="Jump to latest" />
</Conversation>
```

Use the real component props and preserve the existing `<ol>` semantics. In this task's branch, remove the old `scrollRef` follow loop when wiring `Conversation`; do not run two scroll controllers on the same viewport. Keep the old code available in the preceding commit so Step 4 can restore it if needed.

- [ ] **Step 4: Test the scroll contract in a signed-in browser.** At 26rem panel width and a narrow viewport, send a streaming answer while at bottom, scroll up with mouse, touch, keyboard PageUp, and scrollbar drag, then load an older page. In each case, new content must not pull an off-bottom reader down, and the older page must keep the same message at the top of view. The jump control must return to the latest entry. Repeat with reduced motion. If `Conversation` cannot meet any case, retain the existing viewport and custom jump control for this slice; keep the AI Elements `Message` framing and record the exact failed case in the tracker.

- [ ] **Step 5: Verify and commit.** Run `npx tsx scripts/verify-ai-chat-ui.tsx`, typecheck, lint, and build. Record browser results and the selected scroll implementation in the tracker. Commit `feat: use AI Elements message framing` with only this task's files.

### Task 3: Work log, shimmer, and curated reasoning

**Files:** Modify `components/editor/ai-run-tasks.tsx`, `scripts/verify-ai-chat-ui.tsx`, and `context/progress-tracker.md`. Keep `lib/run-task-groups.ts` and `types/tasks.ts` wire values unchanged.

**Interfaces:** Consume `AiRunTasksState`, `selectRunTaskGroups(activity, phase): RunTaskGroup[]`, and `AiTimelinePart`. Produce AI Elements Task rows with the same status wording and a Reasoning disclosure for each saved curated summary.

- [ ] **Step 1: Add failing work-log checks.** Add fixtures for running, complete, error, incomplete, and a failed run with no step. Render `AiRunTasks` and assert that only the last live task has a live region, the incomplete row says “Work stopped before completion,” an action detail remains a file chip, and a reasoning disclosure starts closed. Add a fixture that simulates the 315-second stale transition through `resolveAiChatRunPhase` and assert the stopped wording after reload.

```tsx
assert.equal((html.match(/aria-live="polite"/g) ?? []).length, 1)
assert.match(incompleteHtml, /Work stopped before completion/)
assert.doesNotMatch(incompleteHtml, /Generation failed/)
assert.match(reasoningHtml, /Thought process/)
```

- [ ] **Step 2: Confirm red.** Run `npx tsx scripts/verify-ai-chat-ui.tsx`; the AI Elements Task structure checks should fail.

- [ ] **Step 3: Replace the work-log presentation.** Use `Task`, `TaskTrigger`, `TaskContent`, `TaskItem`, and `TaskItemFile` from `components/ai-elements/task.tsx`. Supply custom trigger children with the current status icon and text, since the registry trigger has no `status` prop. Put `Shimmer` around the single running title. Keep `role="status" aria-live="polite"` on the title span, not on the clickable trigger. Keep the no-step outcome line.

```tsx
<Task key={group.id} defaultOpen>
  <TaskTrigger title={group.title}>
    <span aria-live={isLive && isLast ? "polite" : undefined} role={isLive && isLast ? "status" : undefined}>
      {isLive && isLast ? <Shimmer as="span">{group.title}</Shimmer> : group.title}
    </span>
    {group.status === "running" ? <Loader2 aria-hidden /> : null}
    {group.status === "complete" ? <Check aria-hidden /> : null}
    {group.status === "error" ? <CircleX aria-hidden /> : null}
  </TaskTrigger>
  <TaskContent>
    {group.parts.map((part) => (
      <TaskItem key={part.id}>
        <TaskPart part={part} isStreaming={part.id === streamingPartId} />
      </TaskItem>
    ))}
  </TaskContent>
</Task>
```

Import the icons from `lucide-react` and keep the phase-specific wording for `incomplete`. Style the icons and task body at this app composition site with Truss tokens.

- [ ] **Step 4: Put curated summaries behind Reasoning.** Use `Reasoning defaultOpen={false} isStreaming={isStreaming}` with a `ReasoningTrigger` named “Thought process.” Render its body with the existing safe `Response` inside the local `CollapsibleContent` primitive. Do not use registry `ReasoningContent` until its Streamdown renderer passes Task 4's trust checks. Feed only validated `part.type === "reasoning"` text; never provider raw thought.

- [ ] **Step 5: Verify and commit.** Run `npx tsx scripts/verify-ai-chat-ui.tsx`, `npx tsx scripts/verify-run-task-groups.ts`, typecheck, lint, and build. Check keyboard disclosure, reduced motion, and a second client's reloaded work log. Update the tracker and commit `feat: render AI run activity with AI Elements`.

### Task 4: Markdown safety gate

**Files:** Modify `scripts/verify-chat-response.tsx`, `components/editor/chat-entry.tsx`, `components/editor/ai-run-tasks.tsx`, `components/editor/spec-attachment.tsx`, and `context/progress-tracker.md` only if the gate passes. Create `components/chat/ai-markdown.tsx` only if AI Elements can preserve the full contract.

**Interfaces:** Compare `MessageResponse` with the current `Response({ children: string, isStreaming?, className? })`. Any replacement must preserve `lib/markdown-tokens.ts` safety behavior and spec-preview heading scale.

- [ ] **Step 1: Add a parity fixture before switching.** Extend `verify-chat-response.tsx` to render the same corpus through `Response` and a direct `MessageResponse`: raw `<script>`, `<img onerror>`, `javascript:` and `data:` links, a valid external link, an open fence, an unfinished `**` span, a table, a long answer, and a malformed link. Assert unsafe markup never becomes an element or actionable URL, safe external links carry `target="_blank"` and `rel="noopener noreferrer nofollow"`, finished code and table blocks render, and already visible words do not disappear across a streaming prefix pair.

```tsx
assert.doesNotMatch(html, /<script|onerror=|href="javascript:|href="data:/i)
assert.match(html, /rel="[^"]*noopener[^"]*noreferrer[^"]*nofollow/)
assert.match(html, /<table/)
```

- [ ] **Step 2: Run the comparison.** Run `npx tsx scripts/verify-chat-response.tsx`. Record each failing case in the tracker. Include a saved reasoning part rendered through Task 3's disclosure in the unsafe-link checks. Do not replace the current renderer if any safety or content-preservation assertion fails.

- [ ] **Step 3: Apply the result.** If the direct `MessageResponse` output passes every requirement, create `AiMarkdown` as a thin wrapper and use it in assistant messages, curated reasoning, and spec preview, with a document-scale class for the preview. If a requirement fails, keep `Response` in those locations and retain the AI Elements `Message` framing from Task 2. This is the complete fallback, with no partial renderer migration.

```tsx
export interface AiMarkdownProps {
  children: string
  isStreaming?: boolean
  className?: string
}

export function AiMarkdown({ children, isStreaming, className }: AiMarkdownProps) {
  return <MessageResponse className={className} isAnimating={isStreaming}>{children}</MessageResponse>
}
```

The direct registry component must pass the link and partial-Markdown contract before this wrapper is used. Keep the existing renderer and its verification scripts through this task even if `AiMarkdown` passes; Task 5 removes unused code after an import audit.

- [ ] **Step 4: Verify and commit.** Run `npx tsx scripts/verify-chat-response.tsx`, `npx tsx scripts/verify-markdown-tokens.ts`, typecheck, lint, and build. Update the tracker with the measured pass/fail decision. Commit `refactor: render chat markdown with AI Elements` if migrated, or `test: document AI Elements markdown boundary` if the existing renderer stays.

### Task 5: Final integration and deferred-component decision

**Files:** Modify `context/progress-tracker.md` and the smallest app-owned files needed for defects found in the final pass. Do not alter Trigger.dev or Liveblocks schemas just to make a visual component appear.

**Interfaces:** Consume the finished UI from Tasks 1–4. No new runtime contract.

- [ ] **Step 1: Audit available data.** Search `types/tasks.ts`, `lib/ai-run-chat.ts`, and the worker outputs for typed tool input/output events, token usage, context limits, and distinct phase summaries. Record the result in the tracker. With the current schema, leave `Tool` and `Context` unused; canvas actions remain Task items. Use `ChainOfThought` only if a phase has distinct app-authored summary steps beyond the Task titles. Never render duplicated or invented content.

```bash
rg -n 'toolCall|toolResult|inputTokens|outputTokens|contextWindow|reasoning' types/tasks.ts lib/ai-run-chat.ts trigger
```

- [ ] **Step 2: Run the full gates.** Run `npm run verify:unit`, `npm run typecheck`, `npm run lint`, and `npm run build`. Fix only failures caused by this migration. Confirm the unrelated `package.json` Trigger version remains unchanged in the worktree.

- [ ] **Step 3: Review the product flow.** In a signed-in browser, check the panel at desktop and narrow width, starter prompt, send, streaming answer, design run, spec attachment, older history, keyboard navigation, and reduced motion. With two clients in one room, confirm both see the same durable activity and final summary after reload. Record any environment limitation rather than claiming an unrun check passed.

- [ ] **Step 4: Remove unused custom UI only after checking imports.** Use `rg -n 'components/chat/(ai-input|task|response|code-block)' components app scripts` to find remaining consumers. Delete obsolete files only when no runtime or verification consumer remains. Keep `ComposerBeam`, `ThinkingOrb`, and their dependencies. Update the tracker with the final component map and commit `chore: finish AI Elements chat migration` if this step changes files.

## Execution handoff

The plan ends with a working chat UI even if the Markdown renderer remains custom and `Tool`, `Context`, or `ChainOfThought` stay unused because their data contracts are absent. Those outcomes satisfy the spec's safety and data-integrity rules. Review the final diff against this plan and the spec before landing.
