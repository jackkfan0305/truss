# Shared AI Run Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each AI run's curated reasoning and canvas actions in shared Liveblocks chat so every collaborator sees them live and after reload, while visibly identifying collaborator-authored prompts with their server-derived avatar and name.

**Architecture:** One deterministic assistant message (`chat-${runId}`) is created in the existing `ai-chat` feed and updated in place with a bounded run snapshot. The Trigger.dev worker tees every validated activity part to both its existing run-scoped stream and a throttled durable publisher; clients render the Liveblocks message as the source of truth while retaining the run subscription only for initiator settlement. Human avatar/name snapshots are authored by the authenticated chat route, never by browsers.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript strict mode, Liveblocks 3.23 feeds, Trigger.dev tasks/realtime streams, Clerk, shadcn/ui, Tailwind CSS v4, Node `assert` verification scripts.

## Global Constraints

- Persist only Gemini's supported thought summaries and app-authored progress descriptions; never persist or expose raw provider chain-of-thought.
- Every room collaborator can read live and historical run activity through the existing `ai-chat` feed.
- Human room tokens remain `feeds:read`; only authenticated server code and workers author chat identity or assistant activity.
- Use one feed message per run and update it in place; do not create one permanent feed message per activity event.
- Coalesce adjacent reasoning deltas, cap the timeline at 200 parts, cap one incoming activity text field at 2,000 characters, and cap one coalesced reasoning entry at 16,000 characters.
- Throttle intermediate durable snapshots with a named 400ms cadence and flush terminal state immediately.
- Treat a `running` message as incomplete when its server-authored `updatedAt` is older than the 300-second task duration plus a 15-second grace period.
- New avatar snapshots must be HTTPS URLs on `img.clerk.com`; malformed or missing avatars fall back to initials.
- Preserve historical chat entries that have no avatar or run metadata.
- Preserve the user's existing uncommitted thinking-level, prompt-layout, and canvas-layout changes in overlapping files; stage only task-owned paths for each commit.
- Use existing semantic tokens such as `bg-elevated`; do not introduce raw Tailwind palette colors or hardcoded UI hex values.
- Update `context/architecture-context.md`, `context/ui-context.md`, and `context/progress-tracker.md` when implementation is complete.

---

### Task 1: Extend and validate the durable chat contract

**Files:**
- Modify: `types/tasks.ts`
- Modify: `lib/ai-timeline.ts`
- Modify: `lib/ai-chat.ts`
- Test: `scripts/verify-ai-chat.ts`

**Interfaces:**
- Produces: `AiChatRunPhase`, `AiChatRun`, and the optional `senderAvatar` / `run` fields on `AiChatMessage`.
- Produces: `ChatMessage.updatedAt: number` from Liveblocks' server timestamp.
- Produces: `toPersistedAiActivity(timeline: readonly AiTimelinePart[]): AiActivityPart[]` and the existing timeline selector with shared bounds.
- Consumes: the existing `AiActivityPart`, `parseAiActivityPart`, and `AI_CHAT_FEED_ID` contracts.

- [ ] **Step 1: Add failing contract tests**

Extend `scripts/verify-ai-chat.ts` with fixtures and assertions equivalent to:

```ts
const RUN_MESSAGE = {
  role: "assistant",
  senderId: AI_USER_ID,
  senderName: AI_USER_NAME,
  content: "",
  sentAt: 1_700_000_000_000,
  run: {
    runId: "run_123",
    promptMessageId: "chat-prompt",
    phase: "running",
    activity: [
      { type: "reasoning", text: "Inspecting the graph" },
      { type: "action", text: "addNode", detail: "API" },
    ],
  },
} satisfies AiChatMessage

assert.deepEqual(parseAiChatMessage(RUN_MESSAGE), RUN_MESSAGE)
assert.equal(parseAiChatMessage({ ...VALID, content: "", run: RUN_MESSAGE.run }), null)
assert.deepEqual(
  parseAiChatMessage({ ...VALID, senderAvatar: "https://img.clerk.com/user.jpg" }),
  { ...VALID, senderAvatar: "https://img.clerk.com/user.jpg" },
)
assert.deepEqual(
  parseAiChatMessage({ ...VALID, senderAvatar: "https://example.com/user.jpg" }),
  VALID,
)
```

Also assert that run metadata on a human message is dropped, invalid phase/IDs/activity are dropped without losing valid non-empty assistant content, activity is capped at 200 parts, and `selectAiChatMessages` copies both `createdAt` ordering and `updatedAt` into the selected message.

- [ ] **Step 2: Run the chat verification and confirm RED**

Run:

```bash
npx tsx scripts/verify-ai-chat.ts
```

Expected: TypeScript or assertion failure because `senderAvatar`, `run`, and `updatedAt` are not part of the chat contract.

- [ ] **Step 3: Implement the minimal shared contract**

In `types/tasks.ts`, add the exact public shapes:

```ts
export const AI_CHAT_RUN_PHASES = ["running", "complete", "error"] as const
export type AiChatRunPhase = (typeof AI_CHAT_RUN_PHASES)[number]

export type AiChatRun = {
  runId: string
  promptMessageId: string
  phase: AiChatRunPhase
  activity: AiActivityPart[]
}

export type AiChatMessage = {
  role: AiChatRole
  senderId: string
  senderName: string
  senderAvatar?: string
  content: string
  sentAt: number
  run?: AiChatRun
}
```

Keep parsing backward-compatible. Accept empty `content` only when a valid assistant `run.phase === "running"` exists. Parse `senderAvatar` only for a bounded `https://img.clerk.com/**` URL. Parse at most 200 activity entries with `parseAiActivityPart`; malformed run metadata becomes `undefined` rather than invalidating valid legacy content.

In `lib/ai-timeline.ts`, export the existing limits and add:

```ts
export function toPersistedAiActivity(
  timeline: readonly AiTimelinePart[],
): AiActivityPart[] {
  return timeline.map(({ id: _id, ...part }) => part)
}
```

In `lib/ai-chat.ts`, require `ChatFeedEntry.updatedAt`, add it to `ChatMessage`, and continue ordering exclusively by `createdAt`.

- [ ] **Step 4: Run the chat verification and confirm GREEN**

Run:

```bash
npx tsx scripts/verify-ai-chat.ts
```

Expected: `✅ ai-chat feed checks passed` with the new durable-run and avatar assertions included.

- [ ] **Step 5: Commit the contract increment**

```bash
git add types/tasks.ts lib/ai-timeline.ts lib/ai-chat.ts scripts/verify-ai-chat.ts
git commit -m "feat: define durable AI chat activity"
```

---

### Task 2: Build the coalescing Liveblocks run publisher

**Files:**
- Create: `lib/ai-run-chat.ts`
- Modify: `lib/ai-chat-server.ts`
- Create: `scripts/verify-ai-run-chat.ts`

**Interfaces:**
- Consumes: `AiActivityPart`, `AiChatRunPhase`, `AiTimelinePart`, `appendAiActivityTimelinePart`, and `toPersistedAiActivity` from Task 1.
- Produces: `createAiRunChatPublisher(options): AiRunChatPublisher` with `start()`, `emit(part)`, and `finish(phase, content)`.
- Produces: `upsertServerAiChatMessage(roomId, messageId, message): Promise<void>` for deterministic assistant-message updates.

- [ ] **Step 1: Write a failing deterministic publisher verification**

Create `scripts/verify-ai-run-chat.ts` using a fake write function and fake scheduler. Cover these behaviors with real publisher state rather than mocks of its internals:

```ts
const writes: AiChatMessage[] = []
let scheduled: (() => Promise<void>) | null = null

const publisher = createAiRunChatPublisher({
  roomId: "project-1",
  runId: "run-1",
  promptMessageId: "chat-prompt",
  write: async (_roomId, messageId, message) => {
    assert.equal(messageId, "chat-run-1")
    writes.push(structuredClone(message))
  },
  schedule: (callback, delayMs) => {
    assert.equal(delayMs, AI_RUN_CHAT_FLUSH_MS)
    scheduled = callback
    return 1
  },
  cancel: () => undefined,
})

await publisher.start()
publisher.emit({ type: "reasoning", text: "First " })
publisher.emit({ type: "reasoning", text: "second" })
assert.equal(writes.length, 1)
await scheduled?.()
assert.equal(writes.at(-1)?.run?.activity[0]?.text, "First second")
await publisher.finish("complete", "Canvas updated.")
assert.equal(writes.at(-1)?.run?.phase, "complete")
```

Add cases for one scheduled flush across a burst, chronological reasoning/action ordering, the 200-part bound, an immediate terminal flush, partial activity on error, and a failed intermediate write followed by a successful full-snapshot repair.

- [ ] **Step 2: Run the publisher verification and confirm RED**

Run:

```bash
npx tsx scripts/verify-ai-run-chat.ts
```

Expected: module-not-found failure for `lib/ai-run-chat.ts`.

- [ ] **Step 3: Implement the publisher and server upsert**

Create `lib/ai-run-chat.ts` as a node-only module. Use these public definitions:

```ts
export const AI_RUN_CHAT_FLUSH_MS = 400

export interface AiRunChatPublisher {
  start: () => Promise<void>
  emit: (part: AiActivityPart) => void
  finish: (phase: Exclude<AiChatRunPhase, "running">, content: string) => Promise<void>
}
```

`emit` must append through `appendAiActivityTimelinePart`, retain one scheduled callback at a time, and queue writes serially. Every write sends the full immutable snapshot, so a later success repairs a missed update. `finish` cancels the timer, waits for queued work, and sends terminal phase/content immediately. Publishing errors are logged once per failed write and do not escape to the canvas task.

In `lib/ai-chat-server.ts`, add an upsert path that first updates
`chat-${runId}` and creates it when Liveblocks reports it missing. Handle the
feed-not-found case with the existing create-feed-on-demand behavior and handle
an already-created deterministic ID by retrying the update. Do not broaden
browser permissions.

- [ ] **Step 4: Run the publisher verification and confirm GREEN**

Run:

```bash
npx tsx scripts/verify-ai-run-chat.ts
```

Expected: all coalescing, repair, ordering, and terminal assertions pass.

- [ ] **Step 5: Commit the publisher increment**

```bash
git add lib/ai-run-chat.ts lib/ai-chat-server.ts scripts/verify-ai-run-chat.ts
git commit -m "feat: publish shared AI run activity"
```

---

### Task 3: Thread the prompt anchor and trusted avatar through server boundaries

**Files:**
- Modify: `lib/design-requests.ts`
- Modify: `hooks/use-design-run.ts`
- Modify: `app/api/ai/design/route.ts`
- Modify: `app/api/ai/chat/route.ts`
- Modify: `trigger/design-agent.ts` (payload interface only in this task)
- Modify: `scripts/verify-design-api.ts`
- Modify: `scripts/verify-ai-chat.ts`

**Interfaces:**
- Consumes: the message ID returned by `useAiChat().send()` and the `senderAvatar` field from Task 1.
- Produces: required `DesignRequest.promptMessageId: string` and `DesignAgentPayload.promptMessageId: string`.
- Produces: new user messages with server-derived `senderAvatar: currentUser().imageUrl`.

- [ ] **Step 1: Add failing request-boundary tests**

Update the valid request fixture in `scripts/verify-design-api.ts`:

```ts
const valid = {
  prompt: "Design a checkout flow",
  promptMessageId: "chat-00000000-0000-4000-8000-000000000000",
  projectId: "checkout-flow-a1b2",
  roomId: "checkout-flow-a1b2",
}
```

Assert missing, blank, non-string, and over-256-character prompt message IDs return `null`. In `scripts/verify-ai-chat.ts`, assert the authenticated message shape can carry a Clerk avatar while the request parser still ignores any browser-supplied identity fields.

- [ ] **Step 2: Run the API verifications and confirm RED**

Run:

```bash
npx tsx scripts/verify-design-api.ts
npx tsx scripts/verify-ai-chat.ts
```

Expected: design parsing omits `promptMessageId`, and the new avatar assertion fails.

- [ ] **Step 3: Implement prompt-ID and avatar plumbing**

Add `promptMessageId` to `DesignRequest`, validate it with a 256-character cap, and include it in the parsed result. In `hooks/use-design-run.ts`, add it to the `/api/ai/design` body:

```ts
{
  prompt,
  promptMessageId,
  roomId,
  projectId: roomId,
  modelId: options.modelId,
  thinkingLevel: options.thinkingLevel,
}
```

Pass the parsed ID from `app/api/ai/design/route.ts` into the task payload and declare it on `DesignAgentPayload` without changing the current model/thinking-level fields.

In `app/api/ai/chat/route.ts`, add `senderAvatar: user.imageUrl` to the server-authored user message. Do not accept avatar/name/sender ID from `parseAiChatRequest`.

- [ ] **Step 4: Run the boundary verifications and confirm GREEN**

Run:

```bash
npx tsx scripts/verify-design-api.ts
npx tsx scripts/verify-ai-chat.ts
```

Expected: both scripts pass, including the current uncommitted model/thinking-level cases.

- [ ] **Step 5: Read the installed Next.js route and image references before the UI/server edit continues**

Read completely:

```bash
sed -n '1,260p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
sed -n '1,320p' node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md
```

Confirm the existing Route Handler and `next/image` patterns remain current for Next.js 16.2.

- [ ] **Step 6: Commit the boundary increment**

```bash
git add lib/design-requests.ts hooks/use-design-run.ts app/api/ai/design/route.ts app/api/ai/chat/route.ts trigger/design-agent.ts scripts/verify-design-api.ts scripts/verify-ai-chat.ts
git commit -m "feat: attach AI runs to collaborator prompts"
```

---

### Task 4: Tee worker activity into the durable publisher

**Files:**
- Modify: `trigger/design-agent.ts`
- Modify: `lib/ai-activity.ts`
- Modify: `scripts/verify-design-agent.ts`
- Test: `scripts/verify-ai-run-chat.ts`

**Interfaces:**
- Consumes: `createAiRunChatPublisher` from Task 2 and `DesignAgentPayload.promptMessageId` from Task 3.
- Produces: every validated `AiActivityPart` on both the Trigger.dev stream and deterministic Liveblocks assistant message.
- Retires: final-summary creation as a separate feed message; terminal publisher update owns the same `chat-${runId}` row.

- [ ] **Step 1: Add failing worker-integration assertions**

Extend `scripts/verify-design-agent.ts` to read `trigger/design-agent.ts` and assert these structural invariants:

```ts
assert.match(source, /createAiRunChatPublisher/)
assert.match(source, /promptMessageId/)
assert.doesNotMatch(source, /publishAiChatSummary\(/)
assert.match(source, /finish\("complete"/)
assert.match(source, /finish\("error"/)
```

Keep the behavioral accumulator assertions in `scripts/verify-ai-run-chat.ts`; the source checks only prove that the tested publisher is actually wired into the task.

- [ ] **Step 2: Run focused worker checks and confirm RED**

Run:

```bash
npx tsx scripts/verify-ai-run-chat.ts
npx tsx scripts/verify-design-agent.ts
```

Expected: publisher unit checks pass from Task 2, while worker integration assertions fail because the task still publishes only a final summary.

- [ ] **Step 3: Integrate the durable publisher without changing canvas behavior**

In `trigger/design-agent.ts`:

1. Construct the run publisher from `roomId`, `runId`, and `promptMessageId`.
2. Await `publisher.start()` before the first activity step; publishing remains cosmetic, so its implementation logs and contains failures.
3. Change `openActivityStream` to accept an `onActivity(part)` callback and invoke it only for `AiActivityPart`, never for the internal terminal marker.
4. Pass `publisher.emit` as that callback so the existing `activity.emit(...)` call sites preserve exact chronology.
5. Replace both success calls to `publishAiChatSummary` with `publisher.finish("complete", summary)`.
6. Replace the handled error summary with `publisher.finish("error", failureText)`.
7. Ensure the final stream terminal marker and stream close still run, even when durable publishing fails.

In `lib/ai-activity.ts`, remove `publishAiChatSummary` and now-unused chat imports. Keep presence and status semantics unchanged.

- [ ] **Step 4: Run worker checks and confirm GREEN**

Run:

```bash
npx tsx scripts/verify-ai-run-chat.ts
npx tsx scripts/verify-design-agent.ts
```

Expected: both pass, including existing plan validation, reasoning, pacing, and cursor-target checks.

- [ ] **Step 5: Commit the worker increment**

```bash
git add trigger/design-agent.ts lib/ai-activity.ts scripts/verify-design-agent.ts
git commit -m "feat: persist live AI run timelines"
```

---

### Task 5: Render shared run messages and collaborator identity

**Files:**
- Create: `components/editor/chat-entry.tsx`
- Modify: `components/editor/ai-chat-transcript.tsx`
- Modify: `components/editor/ai-run-activity.tsx`
- Modify: `components/editor/design-run-observer.tsx`
- Modify: `lib/ai-chat.ts`
- Create: `scripts/verify-ai-chat-ui.tsx`
- Modify: `scripts/verify-ai-chat.ts`

**Interfaces:**
- Consumes: selected `ChatMessage.run`, `ChatMessage.senderAvatar`, and `ChatMessage.updatedAt` from Task 1.
- Produces: `arrangeAiChatMessages(messages): ChatMessage[]` for prompt-linked run ordering.
- Produces: `resolveAiChatRunPhase(phase, updatedAt, now): "running" | "complete" | "error" | "incomplete"`.
- Produces: `ChatEntry` as the focused renderer for human/assistant identity and content.
- Changes: `DesignRunObserver` remains mounted for initiator settlement but returns `null`; it no longer owns visible activity.

- [ ] **Step 1: Write failing transcript-order, staleness, and markup tests**

In `scripts/verify-ai-chat.ts`, add pure assertions:

```ts
assert.deepEqual(
  arrangeAiChatMessages([promptA, promptB, runA, runB]).map((message) => message.id),
  [promptA.id, runA.id, promptB.id, runB.id],
)
assert.equal(resolveAiChatRunPhase("running", 1_000, 316_001), "incomplete")
assert.equal(resolveAiChatRunPhase("running", 1_000, 316_000), "running")
```

Create `scripts/verify-ai-chat-ui.tsx` with `renderToStaticMarkup`. Render another collaborator's `ChatEntry` and assert the HTML contains their name, avatar alt text/URL, left-side row structure, and `bg-elevated`. Render a legacy message without an avatar and assert initials appear. Render an own message and assert it does not expose another collaborator label.

- [ ] **Step 2: Run the UI verifications and confirm RED**

Run:

```bash
npx tsx scripts/verify-ai-chat.ts
npx tsx scripts/verify-ai-chat-ui.tsx
```

Expected: missing exports/module failures for arrangement, staleness, and `ChatEntry`.

- [ ] **Step 3: Implement pure ordering and staleness helpers**

In `lib/ai-chat.ts`, add:

```ts
export const AI_RUN_STALE_AFTER_MS = 315_000

export function resolveAiChatRunPhase(
  phase: AiChatRunPhase,
  updatedAt: number,
  now: number,
): AiChatRunPhase | "incomplete" {
  return phase === "running" && now - updatedAt > AI_RUN_STALE_AFTER_MS
    ? "incomplete"
    : phase
}
```

Implement `arrangeAiChatMessages` immutably. Assistant run messages whose loaded prompt exists move immediately after that prompt; unmatched run messages and legacy assistant messages retain server feed order. Multiple runs for one prompt remain ordered by `createdAt`.

- [ ] **Step 4: Extract and implement collaborator-aware `ChatEntry`**

Move the existing message renderer into `components/editor/chat-entry.tsx`. For another human collaborator, use this semantic structure:

```tsx
<li className="flex items-start gap-2.5">
  <ChatAvatar name={message.senderName} avatar={message.senderAvatar} />
  <div className="min-w-0 flex-1">
    <span className="mb-1.5 block text-xs font-medium text-copy-secondary">
      {message.senderName}
    </span>
    <p className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-elevated px-3 py-2.5 text-sm leading-relaxed text-copy-primary">
      {message.content}
    </p>
  </div>
</li>
```

Use `next/image` at explicit dimensions for valid avatar snapshots and `getInitials(senderName)` otherwise. Preserve the existing safe Markdown path for assistant content and existing screen-reader timestamps.

- [ ] **Step 5: Make persisted chat activity the visible source of truth**

Change `AiRunActivity` to accept a small view contract rather than `AiRunTurn`:

```ts
export interface AiRunActivityState {
  id: string
  runId: string | null
  phase: "starting" | "running" | "complete" | "error" | "incomplete"
  activity: AiTimelinePart[]
}
```

Keep its current disclosure, Markdown safety, icons, and animation. `incomplete` uses the stopped icon/text and preserves partial steps.

In `ai-chat-transcript.tsx`:

- render `arrangeAiChatMessages(messages)`;
- convert persisted `run.activity` with `selectAiActivityTimeline` and render it inside the assistant message row;
- use a small timer keyed by `updatedAt` so a stale `running` message transitions to `incomplete` at 315 seconds;
- render final assistant Markdown only when `content` is non-empty;
- keep local start failures visible, but never render local running/completed activity over a persisted run;
- mount the active `DesignRunObserver` for settlement only.

Change `DesignRunObserver` to return `null` after it calls `onSettled`; keep its lossless stream accumulator and terminal grace logic unchanged so the composer still unlocks correctly.

- [ ] **Step 6: Run UI checks and confirm GREEN**

Run:

```bash
npx tsx scripts/verify-ai-chat.ts
npx tsx scripts/verify-ai-chat-ui.tsx
npx tsx scripts/verify-design-agent.ts
```

Expected: ordering, staleness, collaborator markup, legacy fallback, activity, and existing design checks all pass.

- [ ] **Step 7: Commit the client increment**

```bash
git add components/editor/chat-entry.tsx components/editor/ai-chat-transcript.tsx components/editor/ai-run-activity.tsx components/editor/design-run-observer.tsx lib/ai-chat.ts scripts/verify-ai-chat.ts scripts/verify-ai-chat-ui.tsx
git commit -m "feat: show shared AI work in chat"
```

---

### Task 6: Synchronize project context and verify end to end

**Files:**
- Modify: `context/architecture-context.md`
- Modify: `context/ui-context.md`
- Modify: `context/progress-tracker.md`
- Verify: all files changed in Tasks 1–5

**Interfaces:**
- Consumes: the completed shared-feed implementation and verification evidence.
- Produces: context documentation matching actual architecture, UI, failure behavior, and completed progress.

- [ ] **Step 1: Update architecture and UI contracts before final verification**

Replace the initiator-only persistence paragraph in `context/architecture-context.md` with the implemented split: Trigger.dev streams settle the initiating run, while a single updated-in-place `ai-chat` message is the shared live and durable work log. Document deterministic IDs, prompt anchoring, read-only human feed permissions, bounded/throttled updates, and hard-kill staleness behavior.

Update `context/ui-context.md` so AI work logs are shared and reloadable, raw chain-of-thought remains excluded, and another collaborator's prompt shows avatar/name on the left with the neutral elevated surface.

- [ ] **Step 2: Run focused verification**

```bash
npx tsx scripts/verify-ai-chat.ts
npx tsx scripts/verify-ai-chat-ui.tsx
npx tsx scripts/verify-ai-run-chat.ts
npx tsx scripts/verify-design-api.ts
npx tsx scripts/verify-design-agent.ts
```

Expected: every script exits 0 with its success line and no warnings.

- [ ] **Step 3: Run static checks**

```bash
npx eslint types/tasks.ts lib/ai-timeline.ts lib/ai-chat.ts lib/ai-chat-server.ts lib/ai-run-chat.ts lib/design-requests.ts hooks/use-design-run.ts app/api/ai/design/route.ts app/api/ai/chat/route.ts trigger/design-agent.ts lib/ai-activity.ts components/editor/chat-entry.tsx components/editor/ai-chat-transcript.tsx components/editor/ai-run-activity.tsx components/editor/design-run-observer.tsx scripts/verify-ai-chat.ts scripts/verify-ai-chat-ui.tsx scripts/verify-ai-run-chat.ts scripts/verify-design-api.ts scripts/verify-design-agent.ts
npx tsc --noEmit
npm run build
```

Expected: lint, strict type-check, and Next.js production build all exit 0.

- [ ] **Step 4: Run changed-scope React diagnostics**

Use the repo-local React Doctor version so verification does not depend on the external npm cache:

```bash
npx react-doctor . --verbose
```

Expected: no new finding in the changed chat/activity components. Record any unrelated pre-existing findings separately.

- [ ] **Step 5: Verify the collaborative behavior in two browser sessions**

With two authorized users in the same project:

1. Send a prompt as collaborator A.
2. Confirm collaborator B immediately sees A's avatar, name, and dark-grey prompt.
3. Confirm B sees reasoning summaries grow and canvas actions appear in the work disclosure while the canvas builds.
4. Confirm both sessions show the same final summary and terminal action states.
5. Reload collaborator B and confirm the reasoning/actions reconstruct from `ai-chat` without a Trigger.dev run token.
6. Confirm the browser console has no errors and the transcript retains bottom-follow/pagination behavior.

- [ ] **Step 6: Record completion evidence**

Add a new current-goal/completed entry to `context/progress-tracker.md` naming the shared durable activity, collaborator identity UI, RED/GREEN checks, static checks, and whether the live two-client check passed or remains explicitly unverified.

- [ ] **Step 7: Review the complete diff and commit documentation**

```bash
git diff --check
git status --short
git diff -- context/architecture-context.md context/ui-context.md context/progress-tracker.md
git add context/architecture-context.md context/ui-context.md context/progress-tracker.md docs/superpowers/plans/2026-08-09-shared-ai-run-activity.md
git commit -m "docs: record shared AI run history"
```

Confirm no unrelated pre-existing worktree paths were staged.

