# Implementation plan: canvas without Liveblocks

Executes `2026-09-21-canvas-without-liveblocks-design.md`, with one addition the
design did not cover: human invitation is removed outright, not just human
presence. `ProjectCollaborator` and everything that reads it goes, and a project
becomes owner-only.

Two rules bound every phase.

**The UI does not change.** Every control that exists today exists afterwards
and behaves the same way, except the ones that belong to the invitation flow.
That is a harder constraint than the design doc assumed, and three places pay
for it: undo/redo is Liveblocks room history today, the chat sidebar gets the
reader's own identity from Liveblocks, and the canvas' "Connecting…" state is
the suspense fallback of a room that will no longer exist.

**Every phase leaves the app working.** The phases land in order, each one
committable on its own.

## What goes with the invitation flow

Deleted: `components/editor/share-dialog.tsx`, `hooks/use-project-members.ts`,
`app/api/projects/[projectId]/members/route.ts`,
`app/api/projects/[projectId]/members/[memberId]/route.ts`,
`lib/clerk-users.ts`, the `ProjectCollaborator` model, the `Share` button in
`components/editor/editor-navbar.tsx` and the "Shared" tab in
`components/editor/project-sidebar.tsx`.

Kept: `components/editor/access-denied.tsx`, which is what a non-owner opening a
project URL still sees.

## Phase 0: prerequisite

`canvas.tsx` is rewritten in phase 3. The working tree this branch was cut from
has uncommitted work on `canvas.tsx`, `canvas-node.tsx`, `canvas-edge.tsx` and
the readable-diagrams layout modules. Commit and merge it before phase 3, or
that work is rebuilt against the wrong base.

Phases 1 and 2 touch none of those files and can start immediately.

## Phase 1: remove the invitation flow

No Liveblocks in this phase. It is pure subtraction and lands first because
every later phase gets simpler once a project has exactly one human.

**Schema.** Drop `ProjectCollaborator` and `Project.collaborators` from
`prisma/models/project.prisma`. One migration, cascade already handles the rows.

**Access.** `lib/project-access.ts` loses its collaborator branch in both
functions. `getAccessibleProject` becomes a plain `ownerId` match, so
`Identity.email` has no readers left and `resolveIdentityEmail` may go with it
if nothing else calls it. `authorizeProject` loses the `requireOwner` option
entirely: owner or 403, no third answer. Every call site drops the argument,
including the two `requireOwner: false` canvas handlers, which were false only
so a collaborator could save.

**Reads.** `getSharedProjects` goes from `lib/projects.ts`. `app/editor/page.tsx`
and `app/editor/[roomId]/page.tsx` stop fetching and passing `sharedProjects`.

**Types.** `ProjectRole` and `ProjectMember` go from `types/project.ts`.
`ProjectAccess.isOwner` goes too: it is always true now, and the one thing it
gated was the read-only share dialog.

**Chrome.** `EditorShell` drops `sharedProjects`, `isShareOpen` and the
`ShareDialog` mount. `EditorNavbar` drops its `onShare` prop and the `Share2`
button. `ProjectSidebar` drops its tabs and renders the owned list directly,
keeping the same empty state and row markup.

**Verification.** `scripts/verify-project-api.ts` and
`scripts/verify-project-data.ts` lose their collaborator cases and gain one
asserting a non-owner is refused. `scripts/verify-spec-api.ts` references
members and needs the same treatment.

## Phase 2: chat transcript to Postgres

Independent of the canvas. Lands second because it is the largest Liveblocks
consumer that has nothing to do with drawing.

**Schema.** A `ChatMessage` model: `id` (the existing deterministic message ID,
so the run upsert keeps its key), `projectId` with a cascading relation,
`payload` as `Json`, `createdAt`. Index on `[projectId, createdAt]`, which is
the only way it is read.

**Server writes.** `lib/ai-chat-server.ts` keeps both exported functions and
their signatures. `createServerAiChatMessage` becomes a `create`.
`upsertServerAiChatMessage` becomes a Prisma `upsert` on the message ID, and the
five-rung recovery ladder is deleted with the API that needed it. The
`AiChatFeedClient` interface and `upsertAiChatMessageWithClient` go; anything
injecting them in the verify scripts injects a Prisma stub instead.

**Server reads.** `readChatHistory` in `lib/canvas-read.ts` queries Prisma
instead of `getFeedMessages`, still passing the rows through
`selectAiChatMessages` and `selectDesignChatHistory`. It still never throws.

**Client reads.** A `GET /api/projects/[projectId]/chat` route returns the
project's messages oldest-first with a cursor for older pages, owner-gated by
`authorizeProject`. `hooks/use-ai-chat.ts` fetches it instead of calling
`useFeedMessages`, keeping `messages`, `hasOlderMessages`, `isFetchingOlder` and
`fetchOlderMessages` as they are so `ai-chat-transcript.tsx` does not change.

Two of its inputs lose their source and need replacing:

- `roomId` comes from `useRoom().id`. It becomes a required `projectId`
  argument, passed by `components/editor/ai-sidebar.tsx`, which itself takes it
  as a prop from `EditorShell` where `activeProject.id` already lives.
- `selfId` and `canSend` come from `useSelf()`. They become the Clerk user ID
  from `useUser()`, which is what `AI_USER_ID` was always being compared
  against. `canSend` stays false until Clerk has loaded, matching today.

The sidebar's "Connecting to the room…" placeholder becomes a loading state on
the transcript fetch, so the same text appears in the same place for the same
reason.

**Refresh.** The sidebar refetches when a run settles, which
`DesignRunObserver`'s `onSettled` already announces. No polling.

**Status feed.** `hooks/use-ai-status.ts` and `lib/ai-activity.ts` are both
removed here rather than in a later phase, because both are feed consumers.
`AiStatus.message` is already duplicated by the run activity stream, and
`isGenerating` is already known from run state in `hooks/use-agent-run.ts`. The
composer reads run state for both. `lib/ai-status.ts`, `AI_STATUS_FEED_ID` and
the `publishAiStatus` calls in `trigger/design-agent.ts` and
`lib/orchestrator-loop.ts` go with them.

`setAiPresence` and `clearAiPresence` in `lib/ai-activity.ts` are still called
by `lib/canvas-drawing.ts` at this point. They become no-op stubs for one phase
and are deleted in phase 4, which is when the drawing loop moves to the client.

## Phase 3: canvas state without a room

This is the phase that removes Liveblocks from the human canvas. Needs phase 0
merged first.

**Flow state.** `useLiveblocksFlow` becomes `useNodesState` and `useEdgesState`
in `components/canvas/canvas.tsx`. `onConnect` becomes `addEdge` from
`@xyflow/react`; `onDelete` becomes a `setNodes`/`setEdges` filter. The drop,
template import, restore and shape-panel paths keep their current call shapes,
because they already speak React Flow change arrays. One behaviour note: the
template import's clear currently routes through `onDelete` to work around
`@liveblocks/react-flow` no-opping on `"remove"` changes. With local state a
plain `setNodes([])`/`setEdges([])` is correct and the comment explaining the
workaround goes.

The presence handlers on the wrapper, `handleMouseMove` and `handleMouseLeave`,
are deleted. They fed nothing else.

**Undo and redo.** `components/canvas/canvas-controls.tsx` uses `useUndo`,
`useRedo`, `useCanUndo` and `useCanRedo` from Liveblocks, and React Flow has no
replacement. A new `hooks/use-canvas-history.ts` keeps a capped stack of
`{ nodes, edges }` snapshots, pushing on committed change types only, so a drag
is one entry rather than one per frame. It returns the same four values, the
toolbar is unchanged, and `useKeyboardShortcuts` keeps its `undo`/`redo`
arguments. A snapshot stack is O(diagram) per entry; the cap is what bounds it,
and a change-based stack is the upgrade if a large diagram makes it felt.

**Loading.** `CanvasSurface` loses `ClientSideSuspense` and `ConnectionGuard`,
and `CanvasRoom` becomes a pass-through that can be deleted outright with its
provider stack. Today the suspense fallback covers the room connect and the
restore fetch runs behind it, so the canvas never renders empty. To keep that,
`useCanvasRestore` reports whether its first fetch has settled and the canvas
renders the existing `CanvasStatus` element until it has. Same element, same
copy, different trigger.

`components/canvas/canvas-motion-context.tsx` has an initial-load delay tuned to
Liveblocks Storage resolving. Retune it against the restore fetch.

**The restore race.** The `ponytail` comment about two clients restoring into
one cold room goes with the room.

**Version check.** `Project.updatedAt` becomes an optimistic version.
`GET /api/projects/[projectId]/canvas` returns `{ canvas, version }`. `PUT`
takes a `version` field and compares it against the row inside a transaction,
answering `409` when it has moved and returning the new version when it has not.
`useCanvasRestore` hands the version it loaded to `useCanvasAutosave`, which
sends it on every save and keeps the one each success returns. A `409` puts the
navbar save indicator into its existing error state with copy saying the project
changed elsewhere and to reload.

`updatedAt` moves on any project write, a rename included, so the check is
conservative and can ask for a reload after a change that did not touch the
canvas. That is the right failure direction. A dedicated `canvasVersion` column
is the upgrade if false positives become annoying.

**Idle poll.** A canvas with no unsaved edits and no run in flight polls
`updatedAt` and reloads the snapshot when it moves. This is what keeps an
`agent-graph-edit` write from the MCP server visible in an open tab, which is
the behaviour phase 5 would otherwise regress. A canvas with local edits does
not poll, so nothing overwrites work in progress.

**Verification.** `scripts/verify-canvas.ts` and
`scripts/verify-editor-controls.tsx` drop their room wrappers. A new
`scripts/verify-canvas-history.ts` covers push, undo, redo, the cap and the
can-undo/can-redo edges. A new `scripts/verify-canvas-version.ts` covers a fresh
write, a stale write and a write racing a run.

## Phase 4: the agent draws through its run stream

**Server.** `lib/design-plan.ts` stops importing `MutableFlow`.
`applyDesignPlan` and `applyDesignAction` are deleted from it; `DesignAction`,
`parseDesignPlan`, `createCursorTargets`, `getPlanFocus` and
`describeDesignAction` stay, and they are already free of Liveblocks.

`buildCanvas` in `trigger/design-agent.ts` drops `mutateFlow`. It walks the plan
at the same pace `drawPacedCanvasActions` sets, emitting each action and its
cursor target onto the existing activity stream, applying it to an in-memory
`CanvasSnapshot`, and writing that snapshot to Blob when the plan ends. The
agent is the durable writer; closing the tab mid-run still lands the work.

`lib/canvas-drawing.ts` loses its `setAiPresence`/`clearAiPresence` dependencies
and keeps the pacing. `lib/ai-activity.ts` is deleted here, its stubs from
phase 2 having no callers left.

`readCanvas` in `lib/canvas-read.ts` reads the Blob snapshot instead of
`mutateFlow`. A run must therefore start from a current one: the client flushes
its autosave and waits for it before posting a prompt, and
`app/api/ai/orchestrate/route.ts` reads what the flush produced. `saveNow` is
already exposed through `CanvasSaveProvider` for the navbar Save button, so the
composer has a handle to call.

**Client.** A new `lib/canvas-apply-action.ts` turns one `DesignAction` into
React Flow changes, the mirror of what `applyDesignAction` did to a
`MutableFlow`. It validates rather than trusts: the actions arrive over a
stream, and a malformed one is ignored, not applied.

`components/editor/design-run-observer.tsx` already subscribes to the run with
`useRealtimeStream`, so this is a second consumer of an open channel. Canvas
actions reach the canvas through `CanvasSaveProvider`, which already spans the
navbar and the canvas, or a sibling context if that one is the wrong shape.

While a run is live the client pauses autosave, applies streamed actions for the
live feel, and adopts the version the agent wrote when the run settles. One
writer at a time, no reconciliation.

**The AI cursor.** `components/canvas/live-cursors.tsx` keeps its three-layer
transform and its sweep and takes a single nullable position plus a thinking
flag as props, both from the run stream. `hooks/use-collaborators.ts` and
`components/canvas/presence-avatars.tsx` are deleted, `EditorShell` drops the
navbar `presence` slot, and `EditorNavbar` drops the prop. `dedupeByUser` goes
from `lib/presence.ts`; `getInitials` stays, because `chat-entry.tsx` uses it.

**Verification.** A new `scripts/verify-canvas-apply-action.ts` covers each
action variant and rejects malformed input. `scripts/verify-design-agent.ts` and
`scripts/verify-canvas-drawing.ts` are updated for the snapshot write path, and
`scripts/verify-canvas.ts` drops its `dedupeByUser` cases.

## Phase 5: writers outside a run

`app/api/projects/[projectId]/agent-graph-edit/route.ts` and
`app/api/projects/[projectId]/agent-launch-import/route.ts` are authenticated by
agent token and run with no browser attached. Both replace `mutateFlow` with a
read, modify and write of the Blob snapshot under the phase 3 version check.

`AgentCanvasWriteDependencies` in `lib/agent-canvas-write.ts` swaps its
`mutateFlow` member for a snapshot mutator with the same callback shape, so
`AgentCanvasFlow` stays the interface both handlers program against and the
graph-edit semantics in `lib/agent-graph-edit-server.ts` do not change. The MCP
server's stale-edit conflict behaviour keeps working because the version check
is what it was already relying on.

`authorizeProject` in the dependency type drops its `{ requireOwner: true }`
argument, removed in phase 1.

An open tab sees these writes through the phase 3 idle poll.

`scripts/verify-agent-graph-edit.ts` and `scripts/verify-agent-graph-import.ts`
swap their flow stubs for snapshot stubs; their assertions about write counts
and ordering carry over unchanged.

## Phase 6: delete the dependency

Nothing reads Liveblocks by this point.

Removed: the five `@liveblocks/*` packages, `liveblocks.config.ts`,
`lib/liveblocks.ts`, `app/api/liveblocks-auth/route.ts`,
`scripts/verify-liveblocks.ts` and its `verify:integration` entry. The
`LIVEBLOCKS_SECRET_KEY` cases go from `scripts/verify-env-keys.ts`, and the key
is removed from `.env`, Vercel and the `trigger.config.ts` sync list.
`next.config.ts` loses its Liveblocks image-proxy comment if the remote pattern
it explains has no other reason to exist.

`lib/room-id.ts` and `lib/project-id.ts` stay. The project ID is still the route
segment and the blob path; only the comments calling it a room ID change. The
same rewrite applies to the Liveblocks references left in comments across
`canvas-node.tsx`, `canvas-edge.tsx`, `node-color-toolbar.tsx`,
`canvas-motion-context.tsx`, `lib/ai-chat.ts` and `lib/ai-status.ts`.

Update `context/architecture-context.md` and `context/progress-tracker.md`,
including the note about local and prod sharing a database but using different
Liveblocks projects, which stops being true.

## Open question

The design doc's `409` plus idle poll was sized for two humans in a room. With
invitations gone the only concurrent writers are the owner's second tab and the
agent-token routes. Both are real, so the plan keeps the check and the poll, but
neither is load-bearing for a single person in a single tab. If the poll proves
to be noise, dropping it costs only the liveness of an MCP write into an open
canvas.
