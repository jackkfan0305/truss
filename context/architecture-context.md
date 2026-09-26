# Architecture Context

## Stack

| Layer            | Technology              | Role                                                           |
| ---------------- | ----------------------- | -------------------------------------------------------------- |
| Framework        | Next.js 16 + TypeScript | Full-stack app with server/client boundaries                   |
| UI               | Tailwind + shadcn/ui    | Component composition and styling                              |
| Auth             | Clerk                   | User identity and route protection                             |
| Database         | Prisma + PostgreSQL     | Relational metadata: storyboards, diagrams, agent tokens |
| Canvas           | React Flow + Vercel Blob | Versioned canvas snapshots, local undo/redo, agent replay     |
| Artifact storage | Vercel Blob             | Canvas snapshots                                               |

## System Boundaries

- `app/api` — Authenticated request handlers: input validation, ownership checks, canvas writes, and persistence.
- `lib` — Shared infrastructure: Prisma client, access control helpers, and utilities.
- `components` — UI composition: canvas surfaces, sidebars, dialogs, and interactive elements.
- `prisma` — Database schema and generated client output.
- `data` — Legacy local directory. Not used for new artifacts.

## Storage Model

- **Database**: metadata, ownership, relationships, and agent tokens.
- **Vercel Blob**: canvas snapshots at `canvas/{diagramId}.json`, private access only.
- Storyboard and diagram records belong in PostgreSQL.
- Canvas content is stored in and retrieved from Vercel Blob as versioned snapshots.
- The blob URL is stored in the database (`canvasJsonPath`) as the reference to the artifact.
- The Blob store is configured for **private** access. Every `@vercel/blob` call
  must pass `access: "private"` and a stored blob URL is not fetchable directly
  (403). Reads go through `get(url, { access: "private", useCache: false })`,
  which attaches the token. `useCache: false` is required because every save
  overwrites the same path, so the CDN copy would be exactly the stale artifact
  a read must not return.
- Every write is a compare-and-swap on `Diagram.canvasVersion`. The editor's
  autosave and agent-token routes both check the version: if the stored version
  does not match, the write fails with `409` and nothing changes. An idle editor
  polls `GET /api/diagrams/:id/canvas?since=N` every 4 seconds. When the version
  increases, the new canvas is fetched and replayed node by node behind the
  agent cursor; a remote apply clears the undo stack.
- Diagram IDs are never reused. Deletion stamps `deletingAt` and `deletedAt`
  together in a single tombstone write. Either stamp makes the diagram
  inaccessible and excludes it from diagram lists. Timestamps rather than a
  lifecycle enum record *when* as well as whether, which is what a stalled
  cleanup needs.
- A cleanup failure leaves the tombstone for retry. Keeping the row reserved
  prevents old tokens or stale authorization from crossing generations.
- `canvasJsonPath` is retained as a cleanup pointer until Blob deletion is
  implemented; never clear an artifact reference without deleting the
  referenced blob first.

## Auth and Collaboration Model

- A **storyboard** is the top-level artifact owned by one user. A **diagram** is
  its own model with a nullable `storyboardId`, so a diagram that belongs to no
  plan is still a valid diagram; this is the shape every agent-created one starts in.
- A signed-out user may work in a temporary storyboard in the current tab. It
  has no owner, is not persisted. All storyboard features remain available,
  including panel and diagram work and terminal-agent operations. Signing in
  through the in-page modal preserves the temporary storyboard and creates a
  new authenticated user's storyboard from the complete current work. Each tab
  owns an independent in-memory temporary storyboard. A failed save leaves the
  temporary storyboard available for retry; after a successful save, the page
  enters the normal owned state.
- Storyboards and diagrams each have a single owner (Clerk user ID). Only the
  owner may access or modify them.
- Only authenticated users can access protected routes.
- Only the **owner** may open, rename, or delete a diagram. Enforced server-side
  in every handler via `authorizeDiagram(request, diagramId, { requireOwner })`.
  It lives behind the shared `Identity`/`Authorization` primitives in
  `lib/access.ts`.

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
  launch UUID plus a strict compact graph, then writes it immediately to the
  stored canvas through `mutateStoredCanvas` with a version check. Exact full
  replays and exact canonical partial subsets write nothing; divergent changes
  return 409. After any successful write it persists the canonical requested
  snapshot Blob-first then Prisma pointer-second. A persistence failure is
  retryable through exact replay. The browser polls for new versions and
  replays the imported graph node by node behind the agent cursor through the
  native AI-drawing loop (540ms cursor-arrival wait then `getBuildStepMs`
  between items). The import route declares `maxDuration = 120`, leaving
  execution headroom for authorization and persistence.
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

### Reading the canvas

- `GET /api/diagrams/:id/agent-graph` is owner-only and reads the stored
  canvas snapshot from Vercel Blob.
- The response splits what the compact contract can express (`graph`) from
  what it cannot (`opaqueNodeIds`, `opaqueEdgeIds`). Nodes with
  arbitrary IDs, over-length labels, or off-enum colors land in the opaque
  sets rather than being silently dropped. `fingerprint` is a hash of the
  full stored canvas state, opaque items included, used for optimistic
  concurrency on apply.

### Applying the edit

- `POST /api/diagrams/:id/agent-graph-edit` writes to the stored canvas
  through `mutateStoredCanvas`, which compares the fingerprint against the
  current stored snapshot. If the fingerprint does not match, the write is
  refused (`409`) and nothing changes. This prevents a race between the agent
  reading the canvas and writing its edit.
- An edit that reuses an ID from `opaqueNodeIds`/`opaqueEdgeIds` is refused
  outright (`collidesWithOpaque`, `409`), rather than applied.
- The write is immediate, not paced. The idle editor polls for new versions
  and replays the changes node by node behind the agent cursor.
- **Edges anchored to a removed node are swept with it, opaque ones included.**
  An opaque edge touching a removed node would otherwise survive pointing at
  a node that no longer exists, permanently, because opaque items are
  invisible to every future diff and nothing could ever reach it again. This
  does not weaken the removal invariant: an edge is not independent of its
  endpoints, so deleting the node is what deletes it.

### Undo and remote changes

Undo is per-tab and per-session: each editor tab holds its own stack of
canvas snapshots (capped at 100, coalesced over 500ms). When a remote
canvas change is replayed (detected through polling), the undo stack is
cleared. This prevents undo from resurrecting nodes the agent removed or
deleting nodes the agent added. Two tabs on the same diagram keep separate
stacks; the one that saves second gets a conflict and is told to reload.

## Starter System Designs

- Prebuilt templates are static canvas snapshots stored in the codebase.
- Templates are loaded into the canvas through the agent-launch-import route.
- Import can occur on canvas creation or from within the editor at any time.
- Template data follows the same node/edge schema as user-created canvas content.
- Templates do not require a separate database record; they are resolved by template ID at import time.

## Agent Canvas Writes

Truss runs no model of its own — see `docs/adr/0001-no-server-side-ai.md`. The
terminal agent is the only model in the system, and every canvas write arrives
through the graph import and edit routes it calls.

- A diagram ID belongs to exactly one owner. Authorization is checked against
  the diagram's owner before any write.
- The write goes through `mutateStoredCanvas`, which validates the supplied
  graph into canvas objects before writing, so nothing unvalidated can reach
  the Blob and the canvas remains untouched on validation failure.
- The write is **immediate, not paced**. All requested changes write at once to
  the Blob and increment `canvasVersion`. A mid-write failure leaves a
  **partial diagram**. This is accepted rather than rolled back because a
  rollback would lose concurrent editor edits. The error path reports how many
  of the requested changes landed.
- An idle editor polls `GET /api/diagrams/:id/canvas?since=N` every 4 seconds.
  When the version increases, the new canvas is fetched and replayed node by
  node behind the agent cursor. The cursor sweep duration lives in
  `types/tasks.ts` because the browser animates it during replay.
- Progress is visible only to the owner: the agent takes an ephemeral cursor
  and avatar on the canvas during replay. It is cosmetic; if the replay stalls,
  the next poll will replay from the stored canvas again.


## Invariants

1. Truss holds no model key and never interprets a user's intent — the calling agent does.
2. Metadata and large generated artifacts are stored in separate layers.
3. Auth and ownership are enforced at every mutation boundary.
4. Client components are used only where browser interactivity or real-time state requires them.
5. The canvas schema must remain consistent between user-created content and imported templates.
6. An agent edit may only remove canvas items it was able to read. Items outside the compact contract are invisible to the diff and survive every edit — except edges anchored to a node being removed, which are swept with it because nothing else could ever reach them.
