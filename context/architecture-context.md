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

### Spec Generation

- Input: current canvas graph and project context.
- Execution: durable background task via Trigger.dev.
- Output: Markdown technical spec saved to the filesystem and linked to the project in the database.

## Invariants

1. Request handlers do not run long-lived AI work — that belongs in background tasks.
2. Metadata and large generated artifacts are stored in separate layers.
3. Auth and ownership are enforced at every mutation boundary.
4. Client components are used only where browser interactivity or real-time state requires them.
5. The canvas schema must remain consistent between user-created content and imported templates.
