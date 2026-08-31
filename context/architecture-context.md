# Architecture Context

## Stack

| Layer            | Technology              | Role                                                           |
| ---------------- | ----------------------- | -------------------------------------------------------------- |
| Framework        | Next.js 16 + TypeScript | Full-stack app with server/client boundaries                   |
| UI               | Tailwind + shadcn/ui    | Component composition and styling                              |
| Auth             | Clerk                   | User identity and route protection                             |
| Database         | Prisma + PostgreSQL     | Relational metadata: storyboards, diagrams, collaborators, agent tokens |
| Canvas           | Liveblocks + React Flow | Real-time collaborative canvas, presence, and cursors          |
| Artifact storage | Vercel Blob             | Canvas snapshots                                               |

## System Boundaries

- `app/api` — Authenticated request handlers: input validation, ownership checks, canvas writes, and persistence.
- `lib` — Shared infrastructure: Prisma client, access control helpers, and utilities.
- `lib/markdown.ts` — The panel trust boundary. Panel content is agent-authored
  HTML rendered into collaborators' browsers, so markdown-it runs with
  `html: true` and every render is sanitized on the way out under allowlists
  owned in that one module. Nothing else may render panel content, and no other
  module may hold the unsanitized string: `renderPanelHtml` renders and scrubs
  in one step. See ADR 0002.
- `components` — UI composition: canvas surfaces, sidebars, dialogs, and interactive elements.
- `prisma` — Database schema and generated client output.
- `data` — Legacy local directory. Not used for new artifacts.

## Storage Model

- **Database**: metadata, ownership, relationships, and agent tokens.
- **Vercel Blob**: canvas snapshots at `canvas/{diagramId}.json`.
- Storyboard, diagram, and collaborator records belong in PostgreSQL.
- Canvas content is stored in and retrieved from Vercel Blob.
- The blob URL is stored in the database (`canvasJsonPath`) as the reference to the artifact.
- The Blob store is configured for **private** access. Every `@vercel/blob` call
  must pass `access: "private"` — `"public"` is rejected outright, not
  downgraded — and a stored blob URL is not fetchable on its own (`403`). Reads
  go through `get(url, { access: "private", useCache: false })`, which attaches
  the token; `useCache: false` is required because every save overwrites the
  same pathname, so the CDN copy is exactly the stale artifact a read must not
  return. Artifact URLs are therefore pointers, never something to hand to a
  browser directly. Panel images are the one place a Blob URL is meant to reach
  a browser, and no such store exists yet: `lib/markdown.ts` accepts an `img`
  source only from the exact host named by `NEXT_PUBLIC_BLOB_HOSTNAME`, and
  refuses every remote source while that is unset. Serving panel images needs a
  second, public store — the private one cannot answer a browser's `GET`.
- Diagram IDs are never reused. Deletion first stamps `deletingAt`, a durable
  tombstone, then deletes its Liveblocks room, then finalizes the row by
  stamping `deletedAt`. Either stamp makes the diagram inaccessible and excludes
  it from diagram lists. Timestamps rather than a lifecycle enum: they record
  *when* as well as whether, which is what a stalled cleanup needs.
- A cleanup failure leaves the tombstone available to the owner-only delete
  endpoint for retry. Keeping the row permanently reserved prevents old room
  tokens, delayed cleanup, or stale authorization from crossing generations.
- Liveblocks auth rechecks access after token preparation. If deletion won the
  race, it withholds the token and removes any room the request recreated.
- Stamping `deletingAt` immediately scrubs the diagram name and detaches it
  from any parent storyboard, so a board stops rendering a panel for something
  being deleted. The owner ID stays for authorized cleanup retries. Collaborator
  emails belong to the storyboard and are untouched: deleting one diagram must
  not strip its board of the people invited to the plan.
- `canvasJsonPath` is retained as a cleanup pointer until Vercel Blob deletion
  is implemented; never clear an artifact reference without deleting the
  referenced blob first.

## Auth and Collaboration Model

- A **storyboard** is the top-level artifact and the only thing collaborators are invited to (see `CONTEXT.md`). A **diagram** is its own model with a nullable `storyboardId`, so a diagram that belongs to no plan is still a valid diagram — the shape every agent-created one starts in.
- A signed-out user may work in a temporary storyboard in the current tab. It
  has no owner, is not persisted, and cannot invite collaborators. All other
  storyboard features remain available, including panel and diagram work and
  terminal-agent operations. Signing in through the in-page modal preserves the
  temporary storyboard and creates a new authenticated user's storyboard from
  the complete current work. Each tab owns an independent in-memory temporary
  storyboard. A failed save leaves the temporary storyboard available for
  retry; after a successful save, the page enters the normal owned state and
  exposes collaboration.
- Storyboards and diagrams each have a single owner (Clerk user ID) and their own Liveblocks room. A storyboard owner can read every diagram on that storyboard, even when a diagram has a different owner; diagram mutations remain restricted to the diagram owner.
- Storyboards can include additional collaborators, stored by email. There is no local user table; names and avatars are read from the Clerk Backend API at render time.
- Only authenticated users can access protected routes.
- Owner or collaborator may **open** a storyboard and read its member list. That list covers everyone with access — the owner plus collaborators — each carrying a derived `owner` / `collaborator` role. Roles are not stored: owner is `Storyboard.ownerId`, collaborator is the existence of a `StoryboardCollaborator` row.
- A diagram is reachable by its owner, or by a collaborator on its **parent storyboard**. A standalone diagram has no collaborator list to consult and so is owner-only; the editor hides its Share control rather than offering an invite that has nowhere to land.
- Only the **owner** may rename or delete a diagram, or invite and remove collaborators. Enforced server-side in every handler via `authorizeDiagram(request, diagramId, { requireOwner })` and `authorizeStoryboard(request, storyboardId, { requireOwner })`. Both live behind the shared `Identity`/`Authorization` primitives in `lib/access.ts`.
- Liveblocks room tokens are issued only after verifying diagram membership.
  Humans receive room/storage write access but feeds read-only. User chat goes
  through an authenticated server route that derives Clerk identity, while AI
  summaries and status are worker-authored; room clients cannot forge roles or
  delete durable feed entries.

## Agent Skill Operations (Create, Edit, Delete)

The `truss:diagram` skill dispatches to three operations from one skill
directory. Create is a write-only fragment launch (unchanged from the
original single-purpose skill). Edit and delete both need to read the user's
diagram list and, for edit, the live canvas — a write-only channel cannot
answer "which diagram?" or "what is on it now?" — so both open `/agent/pick`,
a second public entry path that talks back to the skill script over a
one-shot local HTTP listener.

### Create

- `/agent/new` is the sole public capture page for an agent skill launch.
- The page parses a versioned launch payload from the URL fragment, scrubs that
  fragment, and keeps the captured launch only in tab-scoped `sessionStorage`.
- The editor query state receives only the opaque launch UUID, never the launch
  title, graph, or encoded fragment.
- Launch payload version 1 contains a canonical lowercase UUID v4, a bounded
  title, and a strict compact graph. The graph boundary rejects the entire
  document for any unknown key, malformed value, duplicate ID or endpoint pair,
  dangling edge, self-loop, or cardinality breach; it never repairs caller data.
  Accepted graphs materialize only the canonical canvas fields and per-shape
  default dimensions.
- Graph launches use the `truss.agent-launch.graph.v1:` session-storage prefix,
  so an unpublished description-driven record cannot resume as a graph launch.
- `POST /api/diagrams/:diagramId/agent-launch-import` is owner-only and checks
  authorization before consuming its JSON body. It accepts only a canonical
  launch UUID plus a strict compact graph, then writes through one server-side
  Liveblocks `mutateFlow` callback. Empty rooms draw canonical nodes before
  edges through the same native AI-drawing loop: a 540ms cursor-arrival wait
  then `getBuildStepMs` between items (at most 76 seconds for 100 items), so
  mounted editors receive progressive native canvas updates. Exact full replays
  make no flow writes;
  an exact canonical partial subset resumes only missing items; any extra or
  differing item conflicts without overwrite. After empty, resumed, or exact
  import it persists the canonical requested snapshot Blob-first then Prisma
  pointer-second. A persistence failure is retryable through exact replay.
  The import route declares `maxDuration = 120`, leaving execution headroom for
  that maximum native draw plus authorization and persistence.
- Diagram IDs are persisted before the launch page posts. A `409` first reads
  the same ID through the owner-only diagram route and resumes only when both
  its ID and title match; an inaccessible or mismatched collision gets one new
  suffix and one replacement POST.
- The editor accepts only `?launch=<canonical UUID>` for the already-authorized
  diagram. Its record advances through `captured`, `creating-diagram`,
  `diagram-created`, `importing-graph`, and `graph-imported`; only the first
  four stages may fail. Failed records retain their graph and safe retry error.
  `graph-imported` is terminal. The client hook deduplicates same-tab requests,
  calls only the owner import route after the authorized editor mounts, clears
  storage and the query only after HTTP 200, and leaves network/5xx/409 errors
  in a retryable failed state. This path does not alter the editor sidebar's
  closed initial state.

### Edit and Delete (`/agent/pick`)

- `/agent/pick` is the second public entry path, added to `isPublicPath` and
  `isClerkHandshakeBypassPath` in `proxy.ts` alongside `/agent/new`. Both
  predicates read from one `AGENT_ENTRY_PATHS` set rather than a single
  constant, and both bypass the Clerk dev handshake for the same reason
  create does: the pick payload lives only in the URL fragment, which the
  browser never sends, so a redirect before capture would discard it —
  exactly the case for a signed-out user, the usual caller of a freshly
  invoked skill.
- `/agent/pick` reuses the same pre-hydration bootstrap script that copies the
  fragment into tab-scoped `sessionStorage` before Clerk's client bundle can
  mount and redirect. But the two paths write to **different** storage keys
  (`AGENT_LAUNCH_PENDING_FRAGMENT_KEY` vs `AGENT_PICK_PENDING_FRAGMENT_KEY`,
  keyed per path in `lib/agent-launch-bootstrap.ts`), because a launch payload
  and a pick payload are different shapes with different schemas. One shared
  key would let a stale fragment of one type be decoded as the other on
  resume — a create payload's graph parsed as a pick op, or the reverse.
  Separate keys make that structurally impossible instead of merely unlikely.
- The pick payload (`lib/agent-pick.ts`) carries `{ version, pickId, op,
  port, nonce }` — `op` is `"edit"` or `"delete"`, `port` and `nonce` address
  the loopback listener the skill script just opened. It is capped at 2048
  encoded characters, far below the launch graph's bound, because it never
  carries a graph.

### The loopback channel

The script (`.agents/skills/truss-diagram/scripts/loopback.mjs`) binds a
one-shot `node:http` listener that `/agent/pick` calls back into using the
browser's own Clerk session. Four defenses, all independent of each other:

- **Loopback-only bind, verified against the real socket.** The listener
  requests `host: "127.0.0.1"`, then reads the bound address back off
  `server.address()` rather than trusting the literal it asked for, and
  refuses to start (closes and throws) if the OS handed back anything else.
  Echoing the requested value would make "binds loopback only" a tautology —
  it would keep reporting `127.0.0.1` even if the process were actually
  listening on `0.0.0.0` and reachable from the network, which is the one
  failure this check exists to catch.
- **One-shot nonce, `timingSafeEqual`.** The script's UUID v4 nonce travels to
  the page in the pick fragment and must come back on every callback. A
  plain `===` comparison leaks timing information proportional to the
  matching prefix length; `timingSafeEqual` (after an equal-length check)
  does not.
- **Exact-origin CORS.** The callback is cross-origin (Truss origin calling
  into `127.0.0.1:PORT`), so it preflights. The listener answers
  `Access-Control-Allow-Origin` with the single resolved Truss origin, never
  a wildcard.
- **Host header pinned** to `127.0.0.1:<port>`, the standard DNS-rebinding
  defense: a page an attacker got the browser to resolve to `127.0.0.1` would
  still send a `Host` header naming its own domain, not the loopback address.
- A rejected callback (bad nonce, bad origin, bad Host) does **not** consume
  the one-shot — the listener keeps waiting until its own timeout — so a
  stray local probe cannot deny the operation by burning its single exchange.

### Held-open responses, not polling

Each exchange is one outstanding HTTP request that the script holds open
until it has an answer, rather than the page polling a status endpoint. This
is safe because Node's `headersTimeout` and `requestTimeout` bound how long
the server waits to **receive** a request, not how long it takes to
**answer** one already fully received — so an agent that takes a minute to
resolve a diagram name or think through a diff does not trip either timeout.
No backoff loop, no page-side state machine beyond "waiting."

### Reading the live canvas

- `GET /api/diagrams/:id/agent-graph` is owner-only — matching the apply
  route, a read a collaborator could take but not act on would only be an
  information leak — and reads the **live Liveblocks room** through
  `readCanvas`, never the autosaved Vercel Blob snapshot. The blob lags the
  room by up to the autosave debounce; diffing against it would compute a
  delta against a canvas that may no longer exist, silently reintroducing or
  re-deleting whatever changed in between.
- The response splits what the compact contract can express (`graph`) from
  what it cannot (`opaqueNodeIds`, `opaqueEdgeIds`) — human-created nodes with
  arbitrary IDs, over-length labels, or off-enum colors land in the opaque
  sets rather than being silently dropped. `fingerprint` is a hash of the
  full live room state, opaque items included, used for optimistic
  concurrency on apply.

### Applying the edit

- `POST /api/diagrams/:id/agent-graph-edit` recomputes the fingerprint
  **inside** the `mutateFlow` callback, not before it. Checking outside the
  callback would reopen the exact read-then-write race the fingerprint
  exists to close — a collaborator could edit the room in the gap between an
  outside check and the mutation. A mismatch inside the callback aborts with
  no write and reports `409`.
- An edit that reuses an ID from `opaqueNodeIds`/`opaqueEdgeIds` is refused
  outright (`collidesWithOpaque`, `409`), rather than applied. `addNodes`
  replaces on ID collision, so without this check a reply that happened to
  reuse an opaque ID would silently overwrite the very item the
  never-remove-what-you-did-not-see rule exists to protect.
- Removals and updates land first as one batch; additions then draw paced,
  same cursor-animated loop as import. The diagram makes room before it is
  drawn into, so a viewer sees an intentional rearrangement rather than new
  nodes appearing on top of geometry that is about to change.
- **Edges anchored to a removed node are swept with it, opaque ones
  included.** `removeNodes` in `@liveblocks/react-flow` is a per-ID map
  delete — it does not cascade to edges. The diff can only name edges the
  agent could see, so an opaque edge touching a removed node would otherwise
  survive pointing at a node that no longer exists, permanently, because
  opaque items are invisible to every future diff and nothing could ever
  reach it again. This does not weaken the removal invariant: an edge is not
  independent of its endpoints, so deleting the node is what deletes it, the
  same as a human dragging that node to the bin would.

### Undo does not cover a server-side edit

Liveblocks' `history.undo()` (`node_modules/@liveblocks/core/dist/index.d.ts`,
`interface History`) is documented in its own type signature: "Undoes the
last operation executed by **the current client**. It does not impact
operations made by other clients." The room has no concept of "changes this
human made through the UI" versus "changes an agent made through the API" —
it only knows per-connection history, and `mutateFlow` runs through
`@liveblocks/node`'s REST client (`app/api/diagrams/[diagramId]/agent-graph-edit/route.ts`),
a connection entirely separate from the browser tab's room session. From the
browser's history stack, an agent-applied batch is indistinguishable from a
collaborator's edit: invisible to Cmd+Z. This matches `CanvasControls`' own
doc comment (`components/canvas/canvas-controls.tsx`): undo is "per-client —
it takes back *your* last change, not a collaborator's."
Consequence: the terminal's destructive-edit confirmation
(`references/operations.md`) is not a convenience layered on top of a working
undo. It is the only safety net a user has against an agent removing the
wrong nodes, and it must never be skipped.

## Starter System Designs

- Prebuilt templates are static canvas snapshots stored in the codebase.
- Templates are loaded into the active Liveblocks room when a user imports one.
- Import can occur on canvas creation or from within the editor at any time.
- Template data follows the same node/edge schema as user-created canvas content.
- Templates do not require a separate database record; they are resolved by template ID at import time.

## Agent Canvas Writes

Truss runs no model of its own — see `docs/adr/0001-no-server-side-ai.md`. The
terminal agent is the only model in the system, and every canvas write arrives
through the graph import and edit routes it calls.

- A room ID *is* its diagram ID, so a request naming both must have them agree.
  Authorization is checked against the diagram; a mismatch is rejected rather
  than reconciled.
- The write goes through `@liveblocks/react-flow`'s server-side `mutateFlow`,
  the same Storage shape the client edits — there is no separate agent write
  path. The supplied graph is validated into canvas objects *before* the write,
  so nothing unvalidated can reach the room and a failure before the draw begins
  leaves the canvas untouched.
- The draw is **paced, not atomic**. One `mutateFlow` holds the whole graph, but
  the callback sleeps between actions, and `mutateStorage` flushes buffered ops
  on a 200ms debounce while the callback is still running — so the room receives
  the graph progressively off a single Storage fetch. A call per action would
  re-fetch the whole document each time, which is O(n²) transfer as the diagram
  grows, for the same result on screen.
- The consequence is that a mid-draw failure leaves a **partial diagram**. This
  is accepted rather than rolled back: on a shared canvas a rollback either
  clobbers or misses concurrent human edits. The error path reports how many of
  the requested changes landed instead of claiming the canvas is unchanged.
- Pacing is a shared server/client contract, not a server detail. The cursor
  sweep duration lives in `types/tasks.ts` because the server waits it out
  before writing and the browser spends it animating the cursor there; if the
  two drift, nodes appear before the cursor arrives.
- Progress is visible to the whole room, not just the caller: the agent takes
  ephemeral Liveblocks presence (`setPresence`, self-expiring TTL) so its cursor
  and avatar appear alongside the humans'. It is cosmetic — a failure to
  announce is logged and never aborts a write.


## Invariants

1. Truss holds no model key and never interprets a user's intent — the calling agent does.
2. Metadata and large generated artifacts are stored in separate layers.
3. Auth and ownership are enforced at every mutation boundary.
4. Client components are used only where browser interactivity or real-time state requires them.
5. The canvas schema must remain consistent between user-created content and imported templates.
6. An agent edit may only remove canvas items it was able to read. Items outside the compact contract are invisible to the diff and survive every edit — except edges anchored to a node being removed, which are swept with it because nothing else could ever reach them.
