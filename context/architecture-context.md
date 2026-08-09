# Architecture Context

## Stack

| Layer            | Technology              | Role                                                           |
| ---------------- | ----------------------- | -------------------------------------------------------------- |
| Framework        | Next.js 16 + TypeScript | Full-stack app with server/client boundaries                   |
| UI               | Tailwind + shadcn/ui    | Component composition and styling                              |
| Auth             | Clerk                   | User identity and route protection                             |
| Database         | Prisma + PostgreSQL     | Relational metadata: projects, collaborators, specs, task runs |
| Canvas           | Liveblocks + React Flow | Real-time collaborative canvas, presence, and cursors          |
| Background tasks | Trigger.dev             | Durable AI generation workflows                                |
| Artifact storage | Vercel Blob             | Canvas snapshots and generated Markdown specs                  |

## System Boundaries

- `app/api` — Authenticated request handlers: input validation, ownership checks, task triggering, and persistence.
- `trigger` — Long-running background jobs: AI design generation and spec generation.
- `lib` — Shared infrastructure: Prisma client, access control helpers, and utilities.
- `components` — UI composition: canvas surfaces, sidebars, dialogs, and interactive elements.
- `prisma` — Database schema and generated client output.
- `data` — Legacy local directory. Not used for new artifacts.

## Storage Model

- **Database**: metadata, ownership, relationships, and task run records.
- **Vercel Blob**: generated artifacts — canvas snapshots at `canvas/{projectId}.json` and specs at `specs/{projectId}/{specId}.md`.
- Project records, spec records, and task run records belong in PostgreSQL.
- Canvas content and Markdown output are stored in and retrieved from Vercel Blob.
- The blob URL is stored in the database (`canvasJsonPath`, `filePath`) as the reference to the artifact.
- The Blob store is configured for **private** access. Every `@vercel/blob` call
  must pass `access: "private"` — `"public"` is rejected outright, not
  downgraded — and a stored blob URL is not fetchable on its own (`403`). Reads
  go through `get(url, { access: "private", useCache: false })`, which attaches
  the token; `useCache: false` is required because every save overwrites the
  same pathname, so the CDN copy is exactly the stale artifact a read must not
  return. Artifact URLs are therefore pointers, never something to hand to a
  browser directly.
- Project IDs are never reused. Deletion first changes the project to a durable
  `DELETING` tombstone, then deletes its Liveblocks room, then finalizes the row
  as `DELETED`. Both states are inaccessible and excluded from project lists.
- A cleanup failure leaves the tombstone available to the owner-only delete
  endpoint for retry. Keeping the row permanently reserved prevents old room
  tokens, delayed cleanup, or stale authorization from crossing generations.
- Liveblocks auth rechecks access after token preparation. If deletion won the
  race, it withholds the token and removes any room the request recreated.
- Entering `DELETING` immediately scrubs the project name, description, and
  collaborator emails. The owner ID stays for authorized cleanup retries.
- `canvasJsonPath` is retained as a cleanup pointer until Vercel Blob deletion
  is implemented; never clear an artifact reference without deleting the
  referenced blob first.

## Auth and Collaboration Model

- Every project has a single owner (Clerk user ID).
- Projects can include additional collaborators, stored by email. There is no local user table; names and avatars are read from the Clerk Backend API at render time.
- Only authenticated users can access protected routes.
- Owner or collaborator may **open** a project and read its contents, including the member list. That list covers everyone with access — the owner plus collaborators — each carrying a derived `owner` / `collaborator` role. Roles are not stored: owner is `Project.ownerId`, collaborator is the existence of a `ProjectCollaborator` row.
- Only the **owner** may rename or delete a project, or invite and remove collaborators. Enforced server-side in every handler via `authorizeProject(projectId, { requireOwner })`.
- Liveblocks room tokens are issued only after verifying project membership.
  Humans receive room/storage write access but feeds read-only. User chat goes
  through an authenticated server route that derives Clerk identity, while AI
  summaries and status are worker-authored; room clients cannot forge roles or
  delete durable feed entries.

## Starter System Designs

- Prebuilt templates are static canvas snapshots stored in the codebase.
- Templates are loaded into the active Liveblocks room when a user imports one.
- Import can occur on canvas creation or from within the editor at any time.
- Template data follows the same node/edge schema as user-created canvas content.
- Templates do not require a separate database record; they are resolved by template ID at import time.

## AI Generation Model

### Design Generation

- Input: user prompt, project context, and current canvas state.
- Execution: durable background task via Trigger.dev.
- Output: structured node and edge updates written into the shared Liveblocks room.
- Every trigger is recorded as a `TaskRun` (`runId`, `projectId`, `userId`). That
  record — not project membership — is what authorizes a run-scoped Trigger.dev
  public token, so a collaborator cannot subscribe to another member's run.
- A room ID *is* its project ID, so a request naming both must have them agree.
  Authorization is checked against the project; a mismatch is rejected rather
  than reconciled.
- The canvas write goes through `@liveblocks/react-flow`'s server-side
  `mutateFlow`, the same Storage shape the client edits — there is no separate
  AI write path. Model output is validated into canvas objects *before* the
  write, so nothing unvalidated can reach the room and a failure before the
  build begins leaves the canvas untouched.
- The build is **paced, not atomic**. One `mutateFlow` holds the whole plan, but
  the callback sleeps between actions, and `mutateStorage` flushes buffered ops
  on a 200ms debounce while the callback is still running — so the room receives
  the plan progressively off a single Storage fetch. A call per action would
  re-fetch the whole document each time, which is O(n²) transfer as the diagram
  grows, for the same result on screen.
- The consequence is that a mid-build failure leaves a **partial diagram**. This
  is accepted rather than rolled back: on a shared canvas a rollback either
  clobbers or misses concurrent human edits. The error path reports how many of
  the planned changes landed instead of claiming the canvas is unchanged.
- Pacing is a shared worker/client contract, not a worker detail. The cursor
  sweep duration lives in `types/tasks.ts` because the worker waits it out
  before writing and the browser spends it animating the cursor there; if the
  two drift, nodes appear before the cursor arrives.
- Task progress is visible to the whole room, not just the caller: the AI takes
  ephemeral Liveblocks presence (`setPresence`, self-expiring TTL) and publishes
  to the room-scoped `ai-status-feed`. Both are cosmetic — a failure to announce
  is logged and never aborts a run.
- The two carry different halves of the answer, and clients read them that way.
  The feed says **what** is happening and is durable, so it survives a reload
  and every participant sees the same line; presence says **whether** a run is
  still live and expires on its own. UI that gates on liveness — a disabled
  composer — therefore reads presence, never the feed: a task killed mid-run
  leaves a `processing` message on the feed forever, and gating on that would
  disable the panel permanently for everyone in the room.
- Feed messages are validated on read (`parseAiStatusMessage`), not trusted. An
  entry an older or newer build cannot parse renders as nothing and never
  outranks the newest entry that does parse.
- Detailed phases, curated reasoning summaries, and canvas operations
  travel on the initiating run's scoped Trigger.dev activity stream. The
  initiating client anchors that activity to its prompt and retains completed
  turns in browser state only for the mounted session. The source stream is
  retained by Trigger.dev under its platform stream-retention window (currently
  up to 28 days), so it contains progress summaries rather than raw provider
  chain of thought. Activity is never copied into the durable room chat or
  exposed to collaborators who do not own the run token; they see the coarse
  room status instead.
- Each activity stream ends with an internal terminal marker. The initiating
  client accumulates `onData` chunks itself and settles only after it has both
  that marker and Trigger's terminal run state, so bursty chunks and the final
  transport tail cannot be overwritten or dropped by hook cache timing.
- Final assistant summaries are published by the Trigger worker with a
  deterministic run-derived message ID. They survive initiator navigation or
  disconnection and cannot be impersonated by another room client.

### Spec Generation

- Input: current canvas graph and project context.
- Execution: durable background task via Trigger.dev.
- Output: a Markdown technical spec written to Vercel Blob, with a `ProjectSpec`
  row holding the blob URL. The worker performs both writes — blob first, row
  second — so no pointer ever names a document that does not exist.
- A `ProjectSpec` ID *is* the Trigger.dev run ID that produced it. The blob
  pathname needs an ID before the upload, and reusing the run's own makes the
  pair idempotent: a retried attempt replaces its own blob and row rather than
  leaving an orphan of each behind.
- Specs accumulate; nothing overwrites them. That is the opposite of the canvas,
  which keeps one latest-snapshot pathname per project.
- Persistence lives in the worker rather than behind a route the browser calls
  back into. The spec exists whether or not the initiating tab is still open, and
  a "here is the spec I generated" endpoint would be a way to write arbitrary
  Markdown into someone else's project.
- Because that write happens in the worker, deployed Trigger.dev environments
  need `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` set in the dashboard, not only
  in the local `.env`.
- Reads go through `GET /api/projects/[projectId]/specs/[specId]/download`, which
  authorizes the project, scopes the spec lookup *by* that project, and streams
  the Markdown back as an attachment. Owner or collaborator, matching who may
  generate one. The blob URL is never handed to the browser.

## Invariants

1. Request handlers do not run long-lived AI work — that belongs in background tasks.
2. Metadata and large generated artifacts are stored in separate layers.
3. Auth and ownership are enforced at every mutation boundary.
4. Client components are used only where browser interactivity or real-time state requires them.
5. The canvas schema must remain consistent between user-created content and imported templates.
