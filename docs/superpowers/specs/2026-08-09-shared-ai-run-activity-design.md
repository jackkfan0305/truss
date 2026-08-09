# Shared AI Run Activity Design

## Goal

Make an AI design run one shared, durable chat turn. Every project collaborator
sees the same curated reasoning summaries and canvas actions while they happen,
and reopening the project reconstructs that work log from chat history.

Human messages also identify collaborators visually: another person's prompt is
left-aligned with their profile image, visible name, and the existing neutral
dark-grey message surface.

Raw provider chain-of-thought remains out of scope. The reasoning shown and
stored is limited to Gemini's supported thought summaries plus the app's own
validated progress descriptions.

## Current Behavior

The room's `ai-chat` Liveblocks feed persists user prompts and the AI's final
summary. Detailed work travels separately on the initiating run's scoped
Trigger.dev stream:

- only the person who started the run has the run token;
- the browser accumulates activity in component state;
- completed activity survives only for that mounted session;
- collaborators see a coarse room status while the run is active;
- a reload discards the detailed work log.

Human feed messages snapshot the sender's name but not their profile image.
`ChatEntry` deliberately hides the current user's name and renders no avatar,
while another collaborator's name appears above a raised neutral message.

## Chosen Architecture

Use one assistant message in the existing `ai-chat` feed as the durable record
for each AI run. The worker creates it at the start of the run and updates that
same message as activity arrives.

The message ID remains deterministic: `chat-${runId}`. One run therefore owns
one transcript row across live updates, completion, task errors, reconnections,
and any safe replay of the publishing path.

This is preferable to the alternatives:

- One feed message per activity part would turn a single run into dozens or
  hundreds of permanent transcript rows and complicate ordering and pagination.
- PostgreSQL or Blob storage plus a separate realtime transport would duplicate
  access control and introduce a new persistence boundary for data Liveblocks
  feeds already model directly.

## Durable Message Contract

`AiChatMessage` gains optional server-authored fields so existing user and
assistant messages remain valid:

- `senderAvatar`: a profile-image URL snapshot, present on new human messages
  and absent on historical messages or users without an image;
- `run`: assistant-only metadata containing `runId`, `promptMessageId`,
  `phase`, and `activity`;
- `run.phase`: `running`, `complete`, or `error`;
- `run.activity`: the normalized chronological `AiActivityPart[]` already used
  by the activity UI.

`content` may be empty only for an assistant message whose run is still
`running`; the work log is its visible content at that point. A terminal
assistant message and every human message still require non-empty content.

The originating `promptMessageId` is sent through the authenticated design
route into the Trigger.dev payload. The worker never guesses the prompt from
"latest chat message", which would attach the wrong work when collaborators
start runs close together.

Readers continue to validate every feed entry. New validation rules enforce:

- run metadata is accepted only on assistant messages;
- IDs and text are length-bounded;
- phases and activity types come from fixed allowlists;
- activity is capped by both part count and text length;
- malformed optional run metadata is dropped without hiding an otherwise valid
  legacy chat message;
- historical messages with no avatar or run metadata render normally;
- avatar snapshots are bounded HTTPS URLs on the Clerk image host already
  allowed by `next.config.ts`; anything else falls back to initials.

## Worker Data Flow

1. The browser posts the already-created user message ID with the prompt and
   model settings.
2. The design route validates that ID, authorizes the project, and passes it to
   the task payload.
3. The worker creates `chat-${runId}` with `phase: running`, an empty activity
   list, and the prompt ID before model generation begins.
4. Every activity emission still enters the Trigger.dev stream for the
   initiating client's run-settlement transport.
5. The same emission is normalized into the worker's durable activity
   accumulator.
6. A coalescing publisher updates the one Liveblocks chat message at most once
   per short interval. Adjacent reasoning deltas merge into one reasoning part;
   canvas actions retain their chronological order.
7. Completion or handled failure performs an immediate final update with the
   complete bounded activity list, terminal phase, and final summary or error
   text.

Liveblocks `updateFeedMessage` is the realtime and persistence path. Because
room clients already subscribe to `ai-chat`, every collaborator sees each
coalesced snapshot without receiving a Trigger.dev run token.

The worker remains the only writer of assistant identity and run metadata.
Human room tokens retain `feeds:read`, and browsers cannot forge an AI work log.

## Update Frequency and Bounds

Reasoning can arrive token-by-token, so a network write per delta is not
acceptable. The durable publisher coalesces rapid changes and sends a bounded
snapshot on a short cadence, then flushes immediately for terminal state.

The exact cadence is a named calibration constant. It must feel live while
remaining slower than token arrival and avoiding a burst of Liveblocks REST
requests. Actions use the same publisher rather than a separate write path, so
reasoning and canvas operations preserve one chronology.

The persisted activity uses the same limits as the rendered timeline. When the
limit is reached, additional activity is ignored consistently by both the live
and reloaded views rather than producing a history that one client can render
and another cannot.

## Client Rendering

The `ai-chat` feed becomes the source of truth for activity UI:

- an assistant message with `run` renders `AiRunActivity` directly from its
  persisted activity;
- `running` shows live progress;
- `complete` shows the completed disclosure and final summary;
- `error` preserves partial reasoning/actions and shows the failure state;
- `promptMessageId` places the assistant work turn immediately after the
  correct human prompt even when multiple collaborators start runs close
  together; an assistant message whose referenced prompt is not in the loaded
  page stays in server feed order until older history supplies that prompt;
- pagination and reload use the same rendering path as realtime updates.

The initiating client keeps its Trigger.dev run subscription to settle its
composer lock reliably. It no longer owns the visible activity history, so its
local stream cannot diverge from what collaborators and later sessions see.

A `running` durable message is not itself proof that a task is still alive.
Each selected feed entry carries Liveblocks' server-authored `updatedAt`. A
running message whose last update is older than the task's maximum duration plus
a named grace period renders as an incomplete run rather than spinning forever.
The client schedules that transition from the server timestamp; it does not
rewrite durable history or trust a browser-authored clock. Presence remains the
room-wide signal used to gate current liveness elsewhere.

## Collaborator Identity

The authenticated chat route adds `currentUser().imageUrl` to new human feed
messages alongside the existing server-derived name. The browser never submits
or chooses either value.

For a message authored by another collaborator:

- render a small circular avatar on the left;
- render the collaborator's name visibly beside the message column;
- render the prompt in the existing `bg-elevated` dark-grey surface;
- fall back to initials derived from `senderName` when the avatar is absent;
- keep meaningful alternative text and a visible timestamp only for assistive
  technology, matching the current transcript behavior.

Historical messages without `senderAvatar` use the initials fallback. AI
messages keep their current minimal treatment and do not imitate a human
profile.

## Failure Behavior

Durable activity is commentary on the canvas write. A Liveblocks feed failure
is logged but must not fail, retry, or roll back canvas generation.

If initial assistant-message creation fails, later updates may retry creation
with the deterministic ID. If an intermediate update fails, the next snapshot
contains the full accumulated timeline and repairs the missing interval. The
terminal flush attempts one final complete snapshot.

A normal task error publishes the partial activity and `phase: error`. A hard
kill may leave `phase: running`; the server `updatedAt` staleness rule prevents
the UI from treating that stored value as permanent liveness.

## Context Documentation Changes

Implementation updates two existing contracts:

- `context/architecture-context.md`: detailed activity moves from initiator-only
  session state to the shared durable chat feed, while Trigger.dev subscriptions
  remain responsible for the initiator's run settlement.
- `context/ui-context.md`: AI work logs are shared and reloadable, and human
  collaborator prompts expose avatar/name identity on a neutral dark-grey
  surface.

`context/progress-tracker.md` records the completed unit and its verification.

## Verification

The implementation follows test-first development. Focused checks cover:

1. Legacy chat messages still parse without avatar or run metadata.
2. Human messages accept a bounded server-authored avatar URL and reject run
   metadata.
3. Assistant run messages validate IDs, phase, and bounded activity.
4. Malformed optional run data does not break unrelated valid history.
5. Prompt IDs cross browser, route parser, task payload, and durable message.
6. Rapid reasoning deltas coalesce into one ordered reasoning entry.
7. Canvas actions remain in chronological order with reasoning and phases.
8. Repeated updates target `chat-${runId}` instead of creating duplicate rows.
9. Completion and failure flush terminal snapshots with partial activity intact.
10. Reloaded feed data renders the same work log as realtime feed updates.
11. Another collaborator's message renders avatar, visible name, left alignment,
    and the semantic dark-grey surface; missing avatars render initials.
12. Existing chat pagination, autoscroll, run locking, and Markdown safety stay
    intact.

Run the focused verification scripts first, followed by ESLint on changed files,
`npx tsc --noEmit`, the production build, and a live two-client browser check.
The live check starts one run as one collaborator, observes reasoning and canvas
actions from the other session, reloads that session, and confirms the work log
and collaborator identity remain visible.

## Out of Scope

- Persisting or exposing raw chain-of-thought.
- Allowing browser clients to author assistant activity.
- Retrofitting avatars or activity onto historical messages.
- Moving chat history out of Liveblocks.
- Changing canvas generation, pacing, or model behavior.
