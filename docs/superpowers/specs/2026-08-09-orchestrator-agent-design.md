# Orchestrator Agent Design

## Goal

Replace the single hard-wired design agent with an orchestrator that reads every
message and decides what the message actually asks for. The orchestrator answers
general questions itself from the current canvas and the conversation, and
delegates to a specialist subagent when the user wants work done.

Two subagents exist, both already built: `design-agent` edits the canvas, and
`generate-spec` writes a Markdown technical specification. Spec generation
becomes reachable from chat for the first time, and a generated spec is
previewable and downloadable directly from the chat transcript.

Routing is driven by what the user wrote and how they wrote it, not by a fixed
pipeline. A message is not assumed to want a canvas edit.

## Current Behavior

Every chat message triggers exactly one thing. `AiSidebar.submit` posts the
user's message through `POST /api/ai/chat`, then calls `useDesignRun.start`,
which posts to `POST /api/ai/design` and triggers `design-agent`. There is no
routing and no general-answer path: a question like "why is this a bottleneck?"
produces a canvas edit, because a canvas edit is the only thing the system can
do.

`generate-spec` is complete and unreachable. The task, `POST /api/ai/spec`, the
Vercel Blob write, the `ProjectSpec` row, the project-scoped list route, the
download route, and the Specs tab list/preview/download UI all exist and work.
Only the entry point is missing: the `Generate Spec` button in `ai-sidebar.tsx`
is inert, because triggering a run needs the canvas graph and the sidebar does
not hold it.

The durable transcript is a shared Liveblocks room feed. A design run writes one
assistant message with the deterministic ID `chat-${runId}`, anchored to the
server-authored human prompt by `promptMessageId`, updated in place from the
worker through `createAiRunChatPublisher`. The initiating browser holds a
run-scoped Trigger.dev token used only to settle its own composer state.

## Chosen Architecture

A new Trigger.dev task, `orchestrator`, becomes the only task the API triggers.
It runs a tool-calling loop with `design-agent` and `generate-spec` exposed as
tools, and it owns the durable chat row for the turn.

### Why a manual loop rather than automatic tool execution

`triggerAndWait` checkpoints the parent run: the run transitions to `WAITING`,
releases its concurrency slot, and resumes afterwards, potentially on a
different machine. An open `streamText` HTTP connection to the model provider
cannot survive that. So the obvious shape does not work:

```ts
// Does not work. The stream dies at the checkpoint.
streamText({
  tools: { designCanvas: { execute: () => designAgent.triggerAndWait(...) } },
});
```

Tools are therefore declared **without `execute`**. Each model call runs to
completion and returns either final text or a tool call. The task performs the
wait outside the model call and feeds the result back as a tool-result message
on the next iteration. Nothing is in flight when the run checkpoints.

### Why not `chat.agent`

Trigger.dev ships a first-class chat primitive (`chat.agent`) with sessions, a
React transport, compaction, and a documented sub-agent pattern
(`ai.toolExecute(task)` and `AgentChat` inside an AI SDK `tool()`). That pattern
does allow tools to execute inside `streamText` without checkpointing, because
it holds a connection rather than waiting on a child run.

It is rejected because this project's transcript is a **shared, multiplayer room
feed**, not a per-user chat. `chat.agent` would introduce a second chat system
with its own persistence and identity model, duplicating the server-authored
Clerk identity, the room-scoped feed permissions, and the durable
`chat-${runId}` row that unit 34 just delivered. The cost is a rewrite of
working multiplayer behavior in exchange for a primitive whose main benefit —
per-user session management — this product does not need.

### Why sequential rather than parallel

`batchTriggerAndWait` is the supported fan-out primitive, and the cost guidance
names sequential `triggerAndWait` calls that could be batched as a defect. It is
deliberately not used here.

A user essentially never wants a spec written *while* asking for canvas
modifications, so there is no real workload to parallelize. Beyond that, both
combinations are unsafe: two concurrent `design-agent` runs each read the same
pre-state, so `createLayout`'s overlap avoidance places their nodes on top of
each other; and a `generate-spec` run concurrent with a design run documents a
diagram that is still being drawn.

The orchestrator therefore runs one tool at a time, and the system prompt
instructs the model to use one tool per step. A request that genuinely needs
both — design something, then document it — resolves naturally across two loop
iterations, with the design result visible before the spec decision is made.

## The Orchestrator Task

`trigger/orchestrator.ts`, a `schemaTask` over a Zod payload:

```
{ prompt, promptMessageId, roomId, modelId?, thinkingLevel? }
```

`retry: { maxAttempts: 1 }` — the same reasoning as `design-agent`. The loop can
cause canvas writes, and a second attempt would regenerate and duplicate them.

`maxDuration: 180`. `maxDuration` is compared against **CPU time**, and
explicitly excludes time spent in `triggerAndWait`, `batchTriggerAndWait`, and
`wait.for`. The ceiling therefore only has to cover the orchestrator's own model
calls, not the subagents' 300s each.

Run shape:

```
read canvas ∥ read ai-chat history        one read, three consumers
publisher.start()                          owns chat-${runId}

loop, at most MAX_ORCHESTRATOR_STEPS (4):
  streamText(system, messages, tools: { designCanvas, writeSpec })   // no execute
    reasoning deltas -> activity parts (existing `reasoning` type)
    text deltas      -> the assistant message's own content, updated in place
  if no tool call: break
  for each tool call, in order:
    designCanvas({ instruction }) -> designAgent.triggerAndWait({ …, chatRunId })
    writeSpec({ focus? })         -> generateSpec.triggerAndWait({ …, chatRunId })
    append the Result to messages
publisher.finish("complete", finalText)
```

The two delta kinds land in different places, and the distinction is
load-bearing. Reasoning deltas become `reasoning` activity parts, the same type
`design-agent` already emits, so they render inside the collapsed work-log
disclosure. Text deltas are the answer the user is waiting on, so they update
the assistant message's `content` in place through the publisher's existing
upsert — no new part type, and no risk of the final answer appearing twice
(once as activity, once as the closing summary).

`triggerAndWait` returns a `Result` object, not the child's output. Every call
site checks `result.ok` before reading `result.output`; `.unwrap()` is not used,
because a failed subagent must reach the model as a tool result rather than
throwing and failing the turn.

Both subagents are triggered by ID with type-only imports, matching the existing
convention, so the worker bundles stay separate.

### Tool contracts

`designCanvas({ instruction: string })` — the instruction is a self-contained
design brief the orchestrator writes, not the raw user message. The orchestrator
holds the canvas and the conversation, so it is the component that can resolve
"add that too" into something `design-agent` can act on alone.

`writeSpec({ focus?: string })` — an optional emphasis for the document. The
canvas and history come from the orchestrator's own read, not from the model.

Both payloads are re-validated at the subagent boundary. A task payload is not
only ever written by the orchestrator.

## Routing

Routing lives in the orchestrator's system prompt. The distinction it draws is
between a question and an imperative aimed at the canvas.

```
Answer yourself, calling no tool, when the user is:
  - asking what something on the canvas is, does, or why it's there
  - asking for advice, comparison, or critique ("is this a bottleneck?",
    "should this be a queue?", "what am I missing?")
  - asking about the conversation, or making small talk
Critique freely in words. Suggesting a change is not making one.

Call designCanvas when the user wants the diagram itself to change: add,
remove, rename, connect, rearrange, recolour, or build something new. The
giveaway is an imperative aimed at the canvas — "add a cache", "wire the queue
to the worker", "design an e-commerce backend", "get rid of the auth box". A
question that merely mentions a component is not a request to change it.

Call writeSpec when the user wants the system written up as a document: a spec,
a technical spec, a design doc, a write-up, "document this", "put this in
writing", "export this". Do not call it to answer a question about the system —
that is what your own answer is for.

When you are genuinely unsure which the user meant, ask them. A wrong canvas
edit costs them more than one clarifying sentence.

Use one tool at a time. If a request needs both — design something and then
document it — do the design first, read what came back, then decide.

After a tool runs, write the closing message yourself: what changed, in one or
two sentences, in the user's own vocabulary. Do not repeat the tool's report
back at them verbatim.
```

The prompt lives in `lib/orchestrator-prompt.ts`, not in the task file, for the
same reason the design prompt does: pure string building with no Trigger.dev
runtime, so a verify script can assert on what the model is actually shown. A
prompt regression is invisible in review and costs a whole run to notice.

The "ask when unsure" instruction is the guard against a misrouted destructive
edit. Asking is a normal turn outcome, not a failure.

## Canvas Context

The orchestrator reads the canvas once per turn through `mutateFlow`'s
`toJSON()` — the same read `design-agent` performs today — and reads the room's
`ai-chat` feed for prior turns. Both reads run in parallel and neither is fatal:
a run that cannot fetch history is a run with less context, not a failed one.

`describeCanvas` and `formatChatHistory` move from `lib/design-prompt.ts` into
`lib/canvas-context.ts`, shared by all three prompts.

### Design agent: unchanged

`buildDesignPrompt` already gives the design agent everything it needs, and this
design preserves it exactly:

- every node's ID, shape, color, label, position, and rendered `width`x`height`
- per-shape default sizes, so an unsized node is still placeable
- `MIN_NODE_GAP` clearance between node rectangles
- edge-label clearance arithmetic in both axes
- shape semantics and the closed color palette
- existing node IDs, with an instruction to edit rather than rebuild
- explicit truncation notice when the canvas exceeds `MAX_CONTEXT_ITEMS` (400)

`scripts/verify-design-agent.ts` asserts on this content. No change to the
design agent's prompt is in scope.

### Spec agent: upgraded

`generate-spec`'s `describeNode` currently emits `- name (shape)` and
`describeEdge` emits `- source -> target — label`. Positions, sizes, colors, and
IDs are all dropped. The spec writer therefore cannot see that a left-to-right
layout *is* the data flow, or that the teal nodes are the datastores — exactly
the structure the diagram encodes.

The spec agent gets the full `describeCanvas` output instead, and its system
prompt moves from the task file into `lib/spec-prompt.ts`. The prompt gains
guidance to read layout as flow direction and color as semantic grouping,
alongside the existing shape-semantics table. The instruction not to invent
components, technologies, or requirements — and to record gaps under Open
Questions instead — is retained verbatim; it is the rule that keeps the document
honest.

`generate-spec` also stops taking `nodes`, `edges`, and `chatHistory` from the
client. The orchestrator already holds them.

## Durable Chat Row Ownership

The orchestrator owns the turn's chat row. One user prompt produces exactly one
assistant message, with subagent work nested inside it.

Both subagents gain an optional `chatRunId` payload field.
`createAiRunChatPublisher` is constructed with `chatRunId ?? ctx.run.id`, so a
subagent triggered by the orchestrator publishes into `chat-${orchestratorRunId}`
and a subagent run directly (a dashboard replay) still publishes its own row.

Nothing else about `design-agent` changes: AI presence, the `ai-status-feed`
announcements, the paced `mutateFlow` build, cursor sweeps, ID resolution, and
partial-failure reporting are all untouched.

A subagent's own run-scoped Trigger.dev activity stream becomes unobservable by
the browser, because the client holds a token for the orchestrator run. This is
already the intended architecture: the shared work log is the durable Liveblocks
row, and the Trigger stream exists only to settle the initiator's composer. The
orchestrator opens its own stream for that purpose.

## Spec Attachment In Chat

A new activity part carries the artifact reference:

```ts
{ type: "artifact", kind: "spec", specId: string, fileName: string }
```

It is validated by `parseAiActivityPart` like every other part, and rides the
existing bounded 200-part immutable snapshot into the durable row. There is no
new persistence: the Markdown is already in Vercel Blob, the pointer is already
a `ProjectSpec` row, and the document is already served by
`GET /api/projects/[projectId]/specs/[specId]/download`.

`fileName` is computed by the same `specFileName` helper the download route puts
in `Content-Disposition`, so the name in chat is the name the file saves under.

Rendering: artifact parts render **outside** the collapsed work-log accordion,
as a card beneath the assistant's closing message — a document is the result of
the turn, not a step within it. The card shows the file name, its timestamp, a
Preview action, and a Download action.

`SpecPreviewDialog`, `SpecPreviewBody`, `DownloadAction`, and `SpecTimestamp`
move from `components/editor/spec-panel.tsx` into
`components/editor/spec-attachment.tsx`, imported by both the Specs tab and the
chat transcript. The preview reads through `useSpecContent`, which fetches the
download route; the private Blob store is never addressed from the browser.
Markdown renders through `renderChatMarkdown`, whose markdown-it boundary has
`html: false` — that file remains the only sanitizer.

## Routes

| Action | Path |
| --- | --- |
| Delete | `app/api/ai/design/route.ts` |
| Delete | `app/api/ai/design/token/route.ts` |
| Delete | `app/api/ai/spec/route.ts` |
| Delete | `app/api/ai/spec/token/route.ts` |
| Add | `app/api/ai/orchestrate/route.ts` |
| Add | `app/api/ai/orchestrate/token/route.ts` |

`POST /api/ai/orchestrate` keeps the existing design route's order and rules:
parse the body (pure, before authorizing, because the project to authorize
against is in the body), authorize with `requireOwner: false`, verify the
`promptMessageId` anchor resolves to a user message in the authorized room
belonging to the caller and matching the normalized prompt, trigger, record the
`TaskRun`, and answer `202 { runId }`.

`POST /api/ai/orchestrate/token` is `export const POST = issueRunToken`.
`lib/run-tokens.ts` is unchanged and now has one caller instead of two.

`lib/design-requests.ts` becomes `lib/orchestrate-requests.ts`. The load-bearing
`roomId === projectId` rule, the prompt length cap, and the `modelId` /
`thinkingLevel` allowlists are all retained. `hooks/use-design-run.ts` becomes
`hooks/use-agent-run.ts` and points at the two new endpoints.

The inert `Generate Spec` button in the Specs tab submits a canned prompt
through the orchestrator, so the chat path stays the only entry point.

## Model Selection

The composer's model and thinking-effort pickers keep their current meaning:
they configure the design work, and are forwarded to `design-agent` unchanged.
Both are re-validated in the task, which does not trust a payload the route is
not the only writer of.

The orchestrator itself runs on `DEFAULT_AI_DESIGN_MODEL_ID` at `low` thinking
effort. Routing and short prose answers do not need a knob, and a second picker
would be a setting nobody turns.

`generate-spec` keeps its own `medium` effort: a spec is prose reasoned over a
whole diagram.

## Failure Handling

A failed subagent returns `Result { ok: false }`. That failure is appended to
the message list as a tool result so the model can explain it in its closing
message. The orchestrator run does not fail.

`generate-spec` already throws `AbortTaskRunError` when the canvas and the
conversation are both empty; under the orchestrator that becomes an explanation
to the user rather than a crashed run.

Partial canvas builds are reported, never rolled back. `design-agent` already
returns how many of its planned actions landed, and that count reaches the
closing message. Rollback on a shared canvas either clobbers or misses
concurrent human edits.

Hitting `MAX_ORCHESTRATOR_STEPS` ends the turn with whatever text the model has
produced, published as a normal terminal state rather than an error.

Activity publishing stays cosmetic to the work, as it is today: a failed
Liveblocks update is logged and repaired by the next full snapshot, and never
aborts a run.

## Scope Split

`ai-workflow-rules.md` forbids combining UI changes and background-task changes
in one implementation step. This design is two units.

**Unit 35 — orchestrator backend.** The `orchestrator` task and its loop, the
tool contracts, `lib/orchestrator-prompt.ts`, `lib/canvas-context.ts`,
`lib/spec-prompt.ts`, the `generate-spec` payload change, `chatRunId` threading
into both subagents, the four route deletions, the two new routes, and the
request-parser and hook renames. The only UI change is the hook rename.

**Unit 36 — spec attachment in chat.** The `artifact` activity part and its
validation, `components/editor/spec-attachment.tsx`, the Specs tab refactored
onto it, the chat transcript rendering the card, and the `Generate Spec` button
wired through the orchestrator.

Unit 35 is shippable alone: spec generation becomes reachable from chat, and the
resulting document appears in the Specs tab, which already lists, previews, and
downloads it.

## Verification

Contract checks follow the existing pattern — pure modules exercised by `tsx`
scripts, with no React, Liveblocks, or Trigger runtime.

Unit 35:

- `scripts/verify-orchestrator.ts` — the routing prompt names both tools and the
  no-tool case; the loop stops at the step cap; a `Result { ok: false }` becomes
  a tool result rather than a throw; `chatRunId` selects the parent row and its
  absence falls back to the run's own ID.
- `scripts/verify-spec-prompt.ts` — the canvas description reaching the spec
  writer carries positions and colors; the "do not invent" instruction survives.
- `scripts/verify-design-agent.ts` — its assertions on the design prompt are
  unchanged and still passing, which is what proves the prompt was preserved.
  Only its import path moves, following `describeCanvas` into
  `lib/canvas-context.ts`.
- `scripts/verify-orchestrate-api.ts` — the renamed parser keeps the
  `roomId === projectId` rule, the prompt cap, and both allowlists.

Unit 36:

- `scripts/verify-ai-chat.ts` — the `artifact` part validates, a malformed one
  is dropped without dropping the message, and it survives the 200-part bound.

Both units additionally require focused ESLint, `npx tsc --noEmit`, and
`npm run build` to pass.

Live verification requires a real Trigger.dev dev run against a Liveblocks room
with a Google API key. The routing behavior specifically cannot be verified by
contract checks: whether "is this a bottleneck?" answers in words and "add a
cache" edits the canvas is a property of the model plus the prompt, and needs
real prompts against a real room.

## Out Of Scope

- Converting the transcript to Trigger.dev `chat.agent` sessions.
- Parallel subagent execution and `batchTriggerAndWait`.
- Any change to `design-agent`'s prompt, plan parser, layout algorithm, paced
  build, or presence behavior.
- New Blob or database storage. The spec artifacts already have both.
- Streaming the spec document into chat as it is written. The attachment card
  appears when the document is saved.
