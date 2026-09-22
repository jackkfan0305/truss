# A canvas without Liveblocks

Truss uses a small fraction of what Liveblocks provides. The user decided on
September 21 to remove the dependency, drop human multiplayer as a gimmick, and
keep the one collaborative behaviour that earns its place: the design agent
drawing onto an open canvas, node by node, with its cursor moving ahead of the
work.

React Flow stays. The canvas the user sees is `@xyflow/react`, and every node,
edge, handle and route renderer already speaks its types. Removing Liveblocks
changes where state lives, not how it looks.

## What Liveblocks does today

Five jobs, not one. Node and edge state through `useLiveblocksFlow`, which is a
CRDT synchronised between every client in a room. Presence, which draws other
people's cursors and the navbar avatar stack. A server-side write path, which is
how the design agent, the orchestrator and the two agent-token API routes place
nodes without a browser. Room authentication and lifecycle. And the AI chat
transcript, which lives on a durable room feed rather than in Postgres.

Durable canvas storage is already ours. The autosave hook serialises the canvas
to Vercel Blob and stores the URL on `Project.canvasJsonPath`. That path stops
being the slow second copy behind Liveblocks and becomes the only one.

## Canvas state

`useNodesState` and `useEdgesState` replace `useLiveblocksFlow` inside
`components/canvas/canvas.tsx`. Drag, drop, connect, delete, template import and
snapshot restore keep their current call shapes, because they already go through
React Flow change arrays. `CanvasRoom` loses its provider stack and becomes a
pass-through; `CanvasSurface` loses its suspense boundary and connection guard,
since there is no longer a socket that can fail to connect.

Loading comes from `use-canvas-restore`, saving from `use-canvas-autosave`. The
restore hook's duplicate-import race, marked `ponytail` in the current code,
disappears with the room: there is no cold shared room for two clients to
restore into at once.

## Concurrent writers

Two people can still open the same project, and the two agent-token routes can
write while nobody is watching. Silent last-write-wins would lose work, so
`Project.updatedAt` becomes an optimistic version.

Every canvas write sends the version it read. The save route compares it against
the row and rejects a stale one with `409`, and the canvas surfaces a message
telling the user the project changed elsewhere and to reload. The client keeps
the version it last successfully wrote, so the check costs no new column and no
new state. `updatedAt` moves on any project write, including a rename, so the
check is conservative: it can ask for a reload after a change that did not touch
the canvas. That is the right failure direction, and a dedicated `canvasVersion`
counter is the upgrade if the false positives ever annoy anyone.

A canvas that is idle, meaning no unsaved local edits and no run in flight,
polls `Project.updatedAt` and reloads the snapshot when it moves. That covers
the second person and the MCP server writing through `agent-graph-edit` without
reintroducing a socket. A canvas with local edits does not poll, so nothing can
overwrite work in progress.

## The design agent drawing

`lib/design-plan.ts` already produces the right wire format. `DesignAction` is a
serialisable discriminated union over `addNode`, `moveNode`, `resizeNode`,
`updateNodeData`, `deleteNode`, `addEdge` and `deleteEdge`, each paired with the
cursor position the AI should occupy when it lands. Today `applyDesignAction`
writes one into a Liveblocks `MutableFlow`.

The agent instead streams those same actions down its own Trigger.dev run
stream. `components/editor/design-run-observer.tsx` already subscribes to the
run with `useRealtimeRun` and `useRealtimeStream`, so this adds a consumer to an
open channel rather than a second realtime system. A new client-side applier
translates each action into React Flow changes, and the AI cursor keeps sweeping
because its position rides in the action.

While a run is live the agent is the only durable writer. The client pauses
autosave, applies streamed actions for the live feel, and adopts the version the
agent wrote when the run settles. The agent writes the final snapshot to Blob
itself, so closing the tab mid-run still lands the work. One writer at a time,
no reconciliation.

Reading is the mirror image. `lib/canvas-read.ts` currently reads live Storage
through a no-op `mutateFlow`. It reads the Blob snapshot instead, which means a
run must start from a current one: the client flushes its autosave and waits for
it before posting a prompt, and the orchestrate route reads the snapshot the
flush produced.

## Writers outside a run

`agent-graph-edit` and `agent-launch-import` are authenticated by agent token
and run with no browser attached. Both replace `mutateFlow` with a read, modify
and write of the Blob snapshot under the same version check, which is also what
lets the MCP server's existing stale-edit conflict behaviour keep working. The
graph edit semantics in `lib/agent-graph-edit-server.ts` are unchanged; only its
`mutateFlow` dependency is swapped for a snapshot mutator.

Project deletion drops its `deleteRoom` call.

## The chat transcript

The AI chat history lives on the `ai-chat-feed` room feed. It is written by
`lib/ai-chat-server.ts`, read by `hooks/use-ai-chat.ts` for the sidebar, and
read again by `lib/canvas-read.ts` so a run can see the turns before it. Postgres
has no home for it today.

A `ChatMessage` model gains that home: project, message id, role, payload and
creation time, with the project relation cascading on delete. The deterministic
run-message upsert that `ai-chat-server.ts` performs becomes an upsert on that
id. The sidebar fetches through a route instead of `useFeedMessages`, and the
run reads history through Prisma instead of `getFeedMessages`. Validation keeps
going through `selectAiChatMessages`, so a malformed row renders as nothing the
same way a malformed feed message does now.

`hooks/use-ai-status.ts` gets smaller. Run state already carries what the AI is
doing and whether it is still going, so both the status feed and the
`isThinking` presence flag are removed rather than replaced. `lib/ai-activity.ts`
goes with them.

## What is deleted

Five npm packages. `lib/liveblocks.ts`, `app/api/liveblocks-auth/route.ts`,
`lib/ai-activity.ts`, `hooks/use-collaborators.ts`,
`components/canvas/presence-avatars.tsx` and
`scripts/verify-liveblocks.ts`. `components/canvas/live-cursors.tsx` shrinks to
the AI cursor alone, keeping the three-layer transform that lets it animate
between positions.

Room identifiers stay. `lib/room-id.ts` names the project ID, the route segment
and the blob path, and only its comments change.

## Non-goals

Human co-editing is removed on purpose and is not coming back in this work. Own
tabs do not sync beyond the idle poll. No CRDT, no Yjs, no websocket server.

## Verification

The repo's `tsx scripts/verify-*.ts` assertion scripts are the test surface. New
scripts cover the design action applier, translating each action variant into
React Flow changes and rejecting malformed ones, and the version check, covering
a fresh write, a stale write and a write racing an agent run. `verify-canvas.ts`
and `verify-editor-controls.tsx` are updated for the state change, and
`verify-liveblocks.ts` is deleted along with its `verify:integration` entry.

## Sequencing

The chat transcript move is independent of the canvas work and can land first,
since it touches no canvas state. Canvas state and the version check come next,
which is the point at which the canvas runs without Liveblocks storage for a
human. The agent stream follows, replacing the server write path. Presence and
the package removal come last, when nothing reads them.

One prerequisite: this branch is cut from `main`, and the working tree it came
from has uncommitted work on `canvas.tsx`, `canvas-node.tsx`, `canvas-edge.tsx`
and the readable-diagrams layout modules. `canvas.tsx` is rewritten here, so that
work must be committed and merged in before implementation starts or it will be
rebuilt against the wrong base.
