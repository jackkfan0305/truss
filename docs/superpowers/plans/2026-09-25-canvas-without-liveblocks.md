# Canvas without Liveblocks: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Liveblocks and the invitation flow from Truss. Every storyboard and diagram becomes owner-only, the canvas state lives in React Flow and a versioned Vercel Blob snapshot, and every screen looks the same except the controls that belonged to sharing.

**Architecture:** A diagram's canvas is one private Blob snapshot. `Diagram.canvasJsonPath` points at it and a new `Diagram.canvasVersion` counter versions it. Every write goes through a compare-and-swap on that counter, so a stale writer gets `409` instead of silently overwriting. The browser holds nodes and edges in `useNodesState`/`useEdgesState`, keeps its own undo stack, autosaves with the version it read, and polls for newer versions while idle. An agent write that the poll picks up is replayed node by node with the agent cursor, which is how the existing "AI draws on the canvas" behaviour survives without a realtime service.

**Tech Stack:** Next.js 16.2 App Router, React 19.2, `@xyflow/react` 12, Prisma 7 on Postgres, `@vercel/blob` 2, Clerk 7. Tests are `tsx scripts/verify-*.ts` assertion scripts.

**Spec:**
- `docs/superpowers/specs/2026-09-21-canvas-without-liveblocks-design.md` (design, written against a stale base)
- `docs/superpowers/specs/2026-09-21-canvas-without-liveblocks-plan.md` (phase outline, same stale base)

Both documents predate `main`'s #39 (server-side AI removed) and #40 (Project split into Storyboard and Diagram). This plan targets `main` at `968cac5`. Where the two disagree, this plan wins. The owner chose, on 2026-09-25, a full pivot to owner-only: storyboard collaborators go too, and `CONTEXT.md` and ADR 0003 are rewritten to match.

What changed from the phase outline because of `main`:
- Phase 2 (chat transcript to Postgres) and phase 4 (design agent draws through its run stream) are gone. `main` has no chat, no design agent, no Trigger.dev.
- The only non-browser writers left are `POST /api/diagrams/[id]/agent-graph-edit` and `POST /api/diagrams/[id]/agent-launch-import`, both driven by the terminal agent. Their paced server-side draw moves to the browser as a replay.
- Invitations belong to `StoryboardCollaborator`, not `ProjectCollaborator`. Routes live under `/api/diagrams` and `/api/storyboards`.
- The version is a dedicated `canvasVersion` column, not `updatedAt`. Renaming the open diagram from the sidebar bumps `updatedAt`, so the outline's "conservative" check would have put the save button into its error state on an ordinary rename.

## Global Constraints

- Base branch is `main` at `968cac5` or later. Work in a fresh worktree on a new branch `canvas-without-liveblocks`. Do not touch `/Users/jackfan/.herdr/worktrees/truss/canvas-from-scratch`: it sits paused mid-rebase and holds only docs.
- Read the relevant guide in `node_modules/next/dist/docs/` before editing a route handler or page (AGENTS.md: "This is NOT the Next.js you know").
- No new npm dependencies. The only package change is removing the five `@liveblocks/*` packages.
- The test surface is `tsx scripts/verify-*.ts`. Every new script goes into `package.json`: pure ones into `verify:unit`, database-backed ones into `verify:integration`.
- Integration scripts need `DATABASE_URL`. Apply migrations locally with `npx prisma migrate deploy` only when `DATABASE_URL` points at a development database. The `DROP TABLE` migration in Task 3 must reach any database a deployed build still reads only through that build's own `vercel-build` step (`prisma migrate deploy`), never from a laptop.
- UI parity: apart from the Share button, the Share dialog, the sidebar's My Diagrams/Shared tab strip, and human cursors and avatars, every control keeps its markup, classes and copy. Kept verbatim: `Connecting to the canvas…`, `Save`, `Saving…`, `Saved`, `Save failed`, `Importing diagram…`, `No diagrams yet`, `New Diagram`, `Templates`.
- One new copy string is allowed: the save button's conflict label `Changed elsewhere, reload`, plus the canvas load failure `Could not load the canvas. Try reloading the page.`
- Tasks 4 through 9 form one deploy unit. Each commit in it type-checks and passes `npm run verify:unit`, but the app only works end to end once Task 9 lands. Do not deploy a commit inside that range.
- Conventional commit messages (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`). No AI attribution trailer or footer.
- New prose, comments and commit messages follow the unslop rules: no em dashes, no puffery.
- Update `context/progress-tracker.md` after each task that changes behaviour (AGENTS.md).

## Review Focus

1. **Agent write while the owner has unsaved edits.** The idle poll is off while the tab is dirty, so the tab's next autosave sends a stale version. Expected: the save answers `409`, the button shows `Changed elsewhere, reload`, the stored canvas still holds the agent's write, and reloading shows it. Pinned in Task 5 (`checkStaleWriteIsRefused`) and Task 8 (manual step).
2. **A reader racing a writer's Blob cleanup.** A successful write deletes the previous Blob. A reader that fetched the old pointer a moment earlier gets a failed download. Expected: the read retries once against the new pointer instead of answering `502`. Pinned in Task 5 (`checkReadRetriesAfterPointerMoves`).
3. **Opening a diagram must not write.** React Flow decorates nodes with `measured`, `selected` and `dragging`. If those reach the autosave payload, merely opening the editor saves and bumps the version. Expected: the payload is canonical, so an untouched editor never saves. Pinned in Task 4 (`checkCanonicalPayloadIgnoresRuntimeFields`).
4. **One drag, one undo step.** React Flow emits a position change every frame. Expected: a drag records exactly one history entry at drag start, typing a label coalesces into one entry, and measuring a node records nothing. Pinned in Task 7 (`checkCommitClassification`).
5. **Undo after an agent replay.** The agent's nodes arrive through `setNodes`, not through history. Expected: a remote apply clears the undo stack, so undo can never resurrect nodes the agent removed or delete nodes the agent added. Pinned in Task 7 (`checkResetEmptiesBothStacks`) and Task 9 (manual step).

---

## File map

Created:
- `lib/canvas-client.ts`: browser fetch helpers for the canvas route, plus the pure response parser.
- `lib/canvas-history.ts`: pure undo/redo stacks and the change classifier.
- `lib/canvas-replay.ts`: pure diff of a remote snapshot against the local canvas, plus the paced node-then-edge draw.
- `hooks/use-canvas-history.ts`: React binding for the history stacks.
- `hooks/use-stored-canvas.ts`: loads the stored canvas before the editor mounts. Replaces `hooks/use-canvas-restore.ts`.
- `hooks/use-canvas-remote-sync.ts`: idle polling and `syncNow`.
- `components/canvas/canvas-surface.tsx`: loading and error states around the canvas. Replaces `components/canvas/canvas-room.tsx`.
- `components/canvas/agent-presence.tsx`: context holding the agent cursor while a replay runs.
- `prisma/migrations/20260925120000_drop_storyboard_collaborators/migration.sql`
- `prisma/migrations/20260925130000_diagram_canvas_version/migration.sql`
- `scripts/verify-canvas-version.ts` (unit), `scripts/verify-canvas-history.ts` (unit), `scripts/verify-canvas-replay.ts` (unit), `scripts/verify-canvas-store.ts` (integration)
- `docs/adr/0005-owner-only-without-liveblocks.md`

Deleted:
- `components/editor/share-dialog.tsx`, `hooks/use-storyboard-members.ts`, `app/api/storyboards/` (both routes), `lib/storyboard-access.ts`, `lib/clerk-users.ts`, `types/storyboard.ts`
- `components/canvas/canvas-room.tsx`, `hooks/use-canvas-restore.ts`, `hooks/use-collaborators.ts`
- `lib/ai-activity.ts`, `lib/liveblocks.ts`, `liveblocks.config.ts`, `app/api/liveblocks-auth/route.ts`, `lib/agent-graph-import-config.ts`, `scripts/verify-liveblocks.ts`

Modified (main ones): `lib/access.ts`, `lib/agent-identity.ts`, `lib/diagram-access.ts`, `lib/diagrams.ts`, `lib/diagram-lifecycle.ts`, `lib/canvas-snapshot.ts`, `lib/canvas-persistence.ts`, `lib/canvas-read.ts`, `lib/canvas-drawing.ts`, `lib/agent-canvas-write.ts`, `lib/agent-graph-edit-server.ts`, `lib/agent-graph-import-server.ts`, `lib/agent-graph-read-server.ts`, `lib/presence.ts`, `lib/api-requests.ts`, `types/diagram.ts`, `types/tasks.ts`, the four diagram route handlers, both editor pages, `components/canvas/canvas.tsx`, `canvas-controls.tsx`, `live-cursors.tsx`, `presence-avatars.tsx`, `canvas-save-context.tsx`, `canvas-motion-context.tsx`, `components/editor/editor-shell.tsx`, `editor-navbar.tsx`, `diagram-sidebar.tsx`, `save-status-button.tsx`, `agent-launch-import-status.tsx`, `hooks/use-canvas-autosave.ts`, `hooks/use-agent-launch-import.ts`, `prisma/models/*.prisma`, `prisma/seed.ts`, `next.config.ts`, `package.json`, and the docs in Task 11.

---

## Task 0: Branch setup

**Files:** none changed in code.

- [ ] **Step 1: Create the worktree from main**

```bash
cd /Users/jackfan/truss
git fetch origin
git worktree add -b canvas-without-liveblocks ../truss-canvas-without-liveblocks origin/main
cd ../truss-canvas-without-liveblocks
npm ci
npm run generate
```

- [ ] **Step 2: Bring the design documents across**

```bash
git cherry-pick 5b5db28
cp /Users/jackfan/.herdr/worktrees/truss/canvas-from-scratch/docs/superpowers/specs/2026-09-21-canvas-without-liveblocks-plan.md docs/superpowers/specs/
cp /Users/jackfan/.herdr/worktrees/truss/canvas-from-scratch/docs/superpowers/plans/2026-09-25-canvas-without-liveblocks.md docs/superpowers/plans/
git add docs/superpowers
git commit -m "docs: plan for a canvas without Liveblocks"
```

- [ ] **Step 3: Record the green baseline**

Run: `npm run typecheck && npm run lint && npm run verify:unit`
Expected: all pass. If anything fails on a clean `main`, stop and report it before changing code.

---

## Phase 1: Owner-only

## Task 1: Remove the Share dialog and the storyboard member routes

**Files:**
- Delete: `components/editor/share-dialog.tsx`, `hooks/use-storyboard-members.ts`, `app/api/storyboards/[storyboardId]/members/route.ts`, `app/api/storyboards/[storyboardId]/members/[memberId]/route.ts`, `lib/storyboard-access.ts`, `lib/clerk-users.ts`
- Modify: `components/editor/editor-shell.tsx`, `components/editor/editor-navbar.tsx`, `lib/api-requests.ts`
- Test: `scripts/verify-editor-controls.tsx`, `scripts/verify-diagram-api.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EditorNavbarProps` without `onShare`. `lib/api-requests.ts` without `parseCollaboratorEmail`.

- [ ] **Step 1: Make the navbar verifier expect no Share control**

In `scripts/verify-editor-controls.tsx`:
- Replace `assert.match(closedHtml, /Share/)` with `assert.doesNotMatch(closedHtml, /Share/)`.
- Delete the `standaloneHtml` constant, the comment block above it, and its four assertions (`assert.doesNotMatch(standaloneHtml, /Share/)` through `assert.match(standaloneHtml, /Checkout API/)`). With no Share control anywhere, the standalone case is the only case.

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/verify-editor-controls.tsx`
Expected: FAIL on the new `doesNotMatch`, because `baseNavbarProps` still passes `onShare` and the navbar renders `Share`.

- [ ] **Step 3: Remove Share from the navbar**

In `components/editor/editor-navbar.tsx`:
- Remove `Share2` from the `lucide-react` import.
- Remove `onShare?: () => void` from `EditorNavbarProps` and `onShare` from the destructured props.
- Delete the `{onShare ? (<Button …><Share2 …/>…Share…</Button>) : null}` block.

In `scripts/verify-editor-controls.tsx`, delete `onShare: () => undefined,` from `baseNavbarProps`.

- [ ] **Step 4: Remove the Share dialog from the shell**

In `components/editor/editor-shell.tsx`:
- Delete the `ShareDialog` import.
- Delete `const [isShareOpen, setIsShareOpen] = useState(false)`, the comment block after it, and the `shareStoryboardId` constant.
- Delete the `onShare={…}` prop on `EditorNavbar`.
- Delete the trailing `{activeDiagram && shareStoryboardId ? (<ShareDialog …/>) : null}` block.

- [ ] **Step 5: Delete the member surface**

```bash
git rm components/editor/share-dialog.tsx hooks/use-storyboard-members.ts \
  "app/api/storyboards/[storyboardId]/members/route.ts" \
  "app/api/storyboards/[storyboardId]/members/[memberId]/route.ts" \
  lib/storyboard-access.ts lib/clerk-users.ts
```

In `lib/api-requests.ts`, delete `parseCollaboratorEmail`, its doc comment, `EMAIL_PATTERN`, `MAX_EMAIL_LENGTH` and the doc comment above `EMAIL_PATTERN`. Then fix the file's header comment if it still mentions the collaborator table.

In `scripts/verify-diagram-api.ts`, delete `checkCollaboratorEmailParsing`, `checkClerkUserIndexing`, their two calls in `main()`, and the `indexUsersByEmail` and `parseCollaboratorEmail` imports.

- [ ] **Step 6: Run the checks**

Run: `npm run typecheck && npx tsx scripts/verify-editor-controls.tsx && npx tsx scripts/verify-diagram-api.ts`
Expected: PASS. Then `git grep -n "share-dialog\|use-storyboard-members\|clerk-users\|storyboard-access\|parseCollaboratorEmail"` prints nothing outside `docs/` and `context/`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: remove the share dialog and storyboard member routes"
```

## Task 2: Make every diagram owner-only

**Files:**
- Modify: `lib/access.ts`, `lib/agent-identity.ts`, `lib/diagram-access.ts`, `lib/diagrams.ts`, `types/diagram.ts`, `app/editor/page.tsx`, `app/editor/[roomId]/page.tsx`, `components/editor/editor-shell.tsx`, `components/editor/diagram-sidebar.tsx`, `lib/agent-canvas-write.ts`, `lib/agent-graph-edit-server.ts`, `lib/agent-graph-import-server.ts`, `lib/agent-graph-read-server.ts`, `app/api/diagrams/[diagramId]/route.ts`, `app/api/diagrams/[diagramId]/canvas/route.ts`, `app/api/diagrams/[diagramId]/agent-graph/route.ts`, `app/api/diagrams/[diagramId]/agent-graph-edit/route.ts`, `app/api/diagrams/[diagramId]/agent-launch-import/route.ts`, `app/api/liveblocks-auth/route.ts`
- Delete: `types/storyboard.ts`
- Test: `scripts/verify-diagram-data.ts`, `scripts/verify-agent-token.ts`, `scripts/verify-editor-controls.tsx`, `scripts/verify-agent-graph-edit.ts`, `scripts/verify-agent-graph-import.ts`, `scripts/verify-diagram-api.ts`

**Interfaces:**
- Consumes: Task 1's removal of every `authorizeStoryboard` caller.
- Produces:
  - `interface Identity { userId: string }`
  - `type Authorization = { ok: true; userId: string } | { ok: false; response: Response }`
  - `authorizeDiagram(request: Request, diagramId: string, options?: { allowDeletionStates?: boolean }): Promise<Authorization>`
  - `getAccessibleDiagram(diagramId: string, identity: Identity): Promise<DiagramSummary | null>`
  - `AgentCanvasWriteDependencies.authorizeDiagram: (diagramId: string) => Promise<Authorization>` and the same signature on `AgentGraphReadDependencies`.
  - `EditorShellProps` and `DiagramSidebarProps` without `sharedDiagrams`.

- [ ] **Step 1: Rewrite the access checks in the data verifier**

In `scripts/verify-diagram-data.ts`:
- Remove `getSharedDiagrams` from the `../lib/diagrams` import and delete `COLLABORATOR_EMAIL`, `SHARED_BOARD_ID` and `UNRELATED_BOARD_ID`.
- Replace `seed()` with:

```ts
async function seed() {
  await cleanup();

  await prisma.storyboard.create({
    data: {
      id: OWNER_BOARD_ID,
      ownerId: OWNER_ID,
      name: "Owner Board",
      diagrams: {
        create: [
          { id: "verify-owned-one", ownerId: OWNER_ID, name: "Owned One" },
          { id: "verify-owned-two", ownerId: OWNER_ID, name: "Owned Two" },
        ],
      },
    },
  });

  // A diagram with no storyboard at all: the shape every agent-created one
  // starts in.
  await prisma.diagram.create({
    data: { id: "verify-standalone", ownerId: OWNER_ID, name: "Standalone" },
  });

  // Owning the board is not owning the diagram. With collaborators gone, the
  // diagram's own ownerId is the only thing that grants access.
  await prisma.diagram.create({
    data: {
      id: "verify-foreign-on-owner-board",
      ownerId: OTHER_OWNER_ID,
      name: "Foreign",
      storyboardId: OWNER_BOARD_ID,
    },
  });
}
```

- Replace `checkDiagramAccess()` with:

```ts
async function checkDiagramAccess() {
  const owner = { userId: OWNER_ID };
  const stranger = { userId: OTHER_OWNER_ID };

  assert.deepEqual(
    await getAccessibleDiagram("verify-owned-one", owner),
    { id: "verify-owned-one", name: "Owned One" },
    "the owner opens their own diagram",
  );
  assert.deepEqual(
    await getAccessibleDiagram("verify-standalone", owner),
    { id: "verify-standalone", name: "Standalone" },
    "a standalone diagram opens for its owner",
  );
  assert.equal(
    await getAccessibleDiagram("verify-owned-one", stranger),
    null,
    "nobody else opens a diagram, whatever board it sits on",
  );
  assert.equal(
    await getAccessibleDiagram("verify-foreign-on-owner-board", owner),
    null,
    "owning the storyboard does not open a diagram someone else owns",
  );
  assert.equal(
    await getAccessibleDiagram("verify-does-not-exist", owner),
    null,
    "an unknown diagram answers the same null as a foreign one",
  );
}
```

- Delete `checkCollaboratorMutations`, `checkStoryboardKeepsItsCollaborators`, and their calls.
- In `checkStoryboardDeleteDetachesDiagrams`, delete against `OWNER_BOARD_ID` instead of `SHARED_BOARD_ID`, drop the `storyboardCollaborator.count` assertion, and look up `"verify-owned-one"` instead of `"verify-shared"`. Move the call so it runs last in `main()`.
- In `main()`, delete every `getSharedDiagrams` assertion. In `checkTombstoneIsHiddenAndReserved`, change the identity literal to `{ userId: OWNER_ID }`.

- [ ] **Step 2: Rewrite the token verifier's authorization calls**

In `scripts/verify-agent-token.ts`:
- Every `authorizeDiagram(req, id, { requireOwner: … })` becomes `authorizeDiagram(req, id)`. Keep `{ allowDeletionStates: true }` on the tombstone retry.
- Replace `assert.ok(owner.ok && owner.role === "owner" && owner.userId === OWNER_ID)` with `assert.ok(owner.ok && owner.userId === OWNER_ID)`.
- Delete the `forbiddenCollaborator` block and its comment. `forbiddenOwnerOnly` stays and now reads as "a stranger is 403".
- In `checkBearerResolutionReturnsOwnerIdentity`, replace the email assertion with `assert.deepEqual(Object.keys(identity ?? {}), ["userId"], "identity carries the user ID and nothing else")`.

- [ ] **Step 3: Run the integration verifiers to see them fail**

Run: `npx tsx scripts/verify-diagram-data.ts && npx tsx scripts/verify-agent-token.ts`
Expected: FAIL. `getAccessibleDiagram` still returns `isOwner`/`storyboardId`/`ownsStoryboard`, and still lets the board owner into `verify-foreign-on-owner-board`.

- [ ] **Step 4: Shrink identity to a user ID**

`lib/access.ts`, replacing everything below the imports:

```ts
import { resolveIdentity } from "@/lib/agent-identity";

/**
 * The identity and authorization primitives every access check is built from.
 *
 * Kept apart from `lib/diagram-access.ts` so a type-only importer (the
 * `*-server.ts` handlers) pulls in nothing that touches Prisma at module load.
 */

export interface Identity {
  userId: string;
}

/**
 * Identity for the current request, or `null` when signed out and no valid
 * bearer token is present. `request` is optional because page loads have no
 * bearer channel and fall straight to the Clerk cookie.
 */
export async function getCurrentIdentity(request?: Request): Promise<Identity | null> {
  return resolveIdentity(request);
}

/** Every diagram is owner-only (ADR 0005), so success carries only the owner. */
export type Authorization =
  | { ok: true; userId: string }
  | { ok: false; response: Response };
```

`lib/agent-identity.ts`:
- Delete `resolveIdentityEmail` and its doc comment.
- Change the Clerk import to `import { auth } from "@clerk/nextjs/server";`.
- Replace `resolveIdentity` with:

```ts
/** `null` when signed out and no valid bearer token is present. */
export async function resolveIdentity(request?: Request): Promise<Identity | null> {
  const source = await resolveIdentitySource(request);

  return source ? { userId: source.userId } : null;
}
```

- Rewrite the header comment: resolution is one step now, and it never calls the Clerk API beyond `auth()`.

- [ ] **Step 5: Make diagram access owner-only**

Replace the body of `lib/diagram-access.ts` with:

```ts
import type { Authorization, Identity } from "@/lib/access";
import { resolveIdentitySource } from "@/lib/agent-identity";
import { isTombstoned, NOT_TOMBSTONED } from "@/lib/diagram-lifecycle";
import { jsonError } from "@/lib/api-requests";
import { prisma } from "@/lib/prisma";
import type { DiagramSummary } from "@/types/diagram";

/**
 * The diagram behind `/editor/[roomId]`, or `null` when this identity does not
 * own it.
 *
 * "Does not exist" and "not yours" collapse into the same `null` on purpose:
 * both render `AccessDenied`, so an outsider cannot probe which IDs are real.
 */
export async function getAccessibleDiagram(
  diagramId: string,
  identity: Identity,
): Promise<DiagramSummary | null> {
  return prisma.diagram.findFirst({
    where: { id: diagramId, ownerId: identity.userId, ...NOT_TOMBSTONED },
    select: { id: true, name: true },
  });
}

/**
 * The single authorization gate for every diagram route handler:
 * 401 unauthenticated, then 404 unknown diagram, then 403 not the owner.
 *
 * Checked before any body is parsed, so a caller without access cannot probe
 * validation behaviour. 404-before-403 leaks whether an ID exists to a
 * signed-in user, which is accepted because diagram IDs are also the public
 * `/editor/[roomId]` segment.
 *
 * Tombstones answer 404 for every caller. The DELETE handler alone opts into
 * them so the owner can retry a deletion.
 */
export async function authorizeDiagram(
  request: Request,
  diagramId: string,
  { allowDeletionStates = false }: { allowDeletionStates?: boolean } = {},
): Promise<Authorization> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return { ok: false, response: jsonError("Unauthorized", 401) };
  }

  const { userId } = identitySource;
  const diagram = await prisma.diagram.findUnique({
    where: { id: diagramId },
    select: { ownerId: true, deletingAt: true, deletedAt: true },
  });

  if (!diagram) {
    return { ok: false, response: jsonError("Diagram not found", 404) };
  }

  if (isTombstoned(diagram) && (!allowDeletionStates || diagram.ownerId !== userId)) {
    return { ok: false, response: jsonError("Diagram not found", 404) };
  }

  if (diagram.ownerId !== userId) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return { ok: true, userId };
}
```

In `lib/diagrams.ts`, delete `getSharedDiagrams` and its doc comment. In `types/diagram.ts`, delete `DiagramAccess` and its doc comment. `git rm types/storyboard.ts`.

- [ ] **Step 6: Update every caller**

- `app/editor/page.tsx` and `app/editor/[roomId]/page.tsx`: drop `getSharedDiagrams` from the import, drop it from `Promise.all`, and drop the `sharedDiagrams` prop. Change the editor page's comment "the future Liveblocks room ID" to "the diagram ID".
- `components/editor/editor-shell.tsx`: drop `sharedDiagrams` from props and from the `DiagramSidebar` call. Type `activeDiagram?: DiagramSummary` and import only `DiagramSummary`.
- `components/editor/diagram-sidebar.tsx`: drop `sharedDiagrams`, the `Tabs` import and `Users`. Replace the whole `<Tabs …>…</Tabs>` element with:

```tsx
      <div className="min-h-0 flex-1 max-sm:pt-8">
        {ownedDiagrams.length === 0 ? (
          <EmptyState
            icon={<FolderOpen className="h-8 w-8 text-copy-faint" />}
            message="No diagrams yet"
          />
        ) : (
          <DiagramList
            label="My diagrams"
            diagrams={ownedDiagrams}
            activeDiagramId={activeDiagramId}
            onRename={onRenameDiagram}
            onDelete={onDeleteDiagram}
          />
        )}
      </div>
```

- `scripts/verify-editor-controls.tsx`: delete `sharedDiagrams: [],` from `diagramSidebarProps`.
- `lib/agent-canvas-write.ts` and `lib/agent-graph-read-server.ts`: change the dependency to `authorizeDiagram: (diagramId: string) => Promise<Authorization>;`.
- `lib/agent-graph-edit-server.ts`, `lib/agent-graph-import-server.ts`, `lib/agent-graph-read-server.ts`: call `dependencies.authorizeDiagram(diagramId)`.
- The three agent routes: `authorizeDiagram: (id) => authorizeDiagram(request, id),`.
- `app/api/diagrams/[diagramId]/route.ts`: `authorizeDiagram(request, diagramId)` in GET and PATCH, `authorizeDiagram(request, diagramId, { allowDeletionStates: true })` in DELETE, and `access.userId` where it passed `access.ownerId`. Replace the "09-share-dialog" comment with "Every handler here is owner-only, like every diagram route."
- `app/api/diagrams/[diagramId]/canvas/route.ts`: `authorizeDiagram(request, diagramId)` in both handlers. Delete the "Both handlers are `requireOwner: false`…" paragraph and change "private to its owner and collaborators" to "private to its owner".
- `app/api/liveblocks-auth/route.ts`: `authorizeDiagram(request, roomId)` in both places. It is deleted in Task 10.
- Test stubs in `scripts/verify-agent-graph-edit.ts`, `scripts/verify-agent-graph-import.ts` and `scripts/verify-diagram-api.ts`: every `{ ok: true, role: "owner", userId: …, ownerId: … }` becomes `{ ok: true, userId: … }`.

- [ ] **Step 7: Run the checks**

Run: `npm run typecheck && npm run verify:unit && npx tsx scripts/verify-diagram-data.ts && npx tsx scripts/verify-agent-token.ts`
Expected: PASS. `git grep -n "requireOwner\|getSharedDiagrams\|DiagramAccess\|ownsStoryboard\|resolveIdentityEmail\|StoryboardRole"` prints nothing outside `docs/` and `context/`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: make every diagram owner-only"
```

## Task 3: Drop StoryboardCollaborator

**Files:**
- Modify: `prisma/models/storyboard.prisma`, `prisma/seed.ts`, `scripts/verify-prisma.ts`
- Create: `prisma/migrations/20260925120000_drop_storyboard_collaborators/migration.sql`

**Interfaces:**
- Consumes: Tasks 1 and 2 removed every reader of `storyboardCollaborator` and `Storyboard.collaborators`.
- Produces: a schema with no collaborator model.

- [ ] **Step 1: Edit the schema**

In `prisma/models/storyboard.prisma`, delete the `collaborators StoryboardCollaborator[]` line and the whole `StoryboardCollaborator` model with its doc comment. Replace the model's doc comment with:

```prisma
/// A board of panels expressing one plan, owned by one user. The top-level
/// object in the app (see CONTEXT.md). This row is metadata and ownership.
```

- [ ] **Step 2: Write the migration by hand**

`prisma/migrations/20260925120000_drop_storyboard_collaborators/migration.sql`:

```sql
-- Storyboards are owner-only (ADR 0005). Invitations and their rows go.
DROP TABLE "StoryboardCollaborator";
```

- [ ] **Step 3: Update the seed and the Prisma smoke check**

`prisma/seed.ts`: delete the `collaborators` key from all three storyboard literals, from the destructuring in `storyboards.map`, from the `create` data, and from the returned object. The log line becomes:

```ts
      `Seeded storyboard ${storyboard.name} (${diagrams.length} diagrams)`,
```

`scripts/verify-prisma.ts`: change the `_count` select to `{ diagrams: true }` and the log line to `` `  - ${storyboard.name} (${storyboard._count.diagrams} diagrams)` ``.

- [ ] **Step 4: Validate and regenerate**

Run: `npx prisma validate && npm run generate && npm run typecheck`
Expected: PASS.

If `DATABASE_URL` is a development database, also run `npx prisma migrate deploy && npx tsx scripts/verify-prisma.ts && npx tsx scripts/verify-diagram-data.ts`. Expected: PASS. Otherwise skip, per Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: drop the storyboard collaborator table"
```

---

## Phase 2: Versioned canvas storage (Tasks 4 to 9 deploy together)

## Task 4: Canvas version columns and wire helpers

**Files:**
- Modify: `prisma/models/diagram.prisma`, `lib/canvas-snapshot.ts`, `lib/agent-canvas-write.ts`, `package.json`
- Create: `prisma/migrations/20260925130000_diagram_canvas_version/migration.sql`, `lib/canvas-client.ts`, `scripts/verify-canvas-version.ts`

**Interfaces:**
- Consumes: `CanvasSnapshot`, `parseCanvasSnapshot`, `serializeCanvasSnapshot` from `lib/canvas-snapshot.ts`.
- Produces:
  - `class CanvasVersionConflictError extends Error` (in `lib/canvas-snapshot.ts`, Prisma-free)
  - `parseCanvasVersion(value: unknown): number | null`
  - `parseCanvasWrite(body: unknown): { version: number; snapshot: CanvasSnapshot } | null`
  - `canonicalCanvasPayload(snapshot: CanvasSnapshot): string`
  - `interface RemoteCanvas { snapshot: CanvasSnapshot; version: number; isAgentWrite: boolean }` and `parseCanvasReadResponse(body: unknown): RemoteCanvas | "unchanged" | null` (in `lib/canvas-client.ts`)
  - `interface SnapshotFlow extends AgentCanvasFlow { readonly hasChanged: boolean; toSnapshot(): CanvasSnapshot }` and `createSnapshotFlow(snapshot: CanvasSnapshot): SnapshotFlow` (in `lib/agent-canvas-write.ts`)

- [ ] **Step 1: Write the failing unit verifier**

`scripts/verify-canvas-version.ts`:

```ts
import assert from "node:assert/strict";

import { createSnapshotFlow } from "../lib/agent-canvas-write";
import { parseCanvasReadResponse } from "../lib/canvas-client";
import {
  canonicalCanvasPayload,
  parseCanvasVersion,
  parseCanvasWrite,
  type CanvasSnapshot,
} from "../lib/canvas-snapshot";
import { CANVAS_NODE_TYPE, type CanvasNode } from "../types/canvas";

function node(id: string, x = 0): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y: 0 },
    width: 160,
    height: 80,
    data: { label: id, color: "neutral", shape: "rectangle" },
  } as CanvasNode;
}

const SNAPSHOT: CanvasSnapshot = { nodes: [node("web")], edges: [] };

function checkVersionParsing() {
  assert.equal(parseCanvasVersion(0), 0);
  assert.equal(parseCanvasVersion(7), 7);
  assert.equal(parseCanvasVersion("12"), 12, "a query-string version parses");
  for (const bad of [-1, 1.5, Number.NaN, "", "1e3", "-2", null, undefined, {}]) {
    assert.equal(parseCanvasVersion(bad), null, `rejects ${String(bad)}`);
  }
}

function checkWriteParsing() {
  assert.deepEqual(parseCanvasWrite({ version: 3, canvas: SNAPSHOT })?.version, 3);
  assert.equal(parseCanvasWrite(SNAPSHOT), null, "a bare snapshot has no version");
  assert.equal(parseCanvasWrite({ version: 3, canvas: { nodes: "no" } }), null);
  assert.equal(parseCanvasWrite({ version: "x", canvas: SNAPSHOT }), null);
}

/** Review Focus 3: opening an editor must never look like an edit. */
function checkCanonicalPayloadIgnoresRuntimeFields() {
  const decorated = {
    nodes: [
      {
        ...node("web"),
        selected: true,
        dragging: false,
        measured: { width: 160, height: 80 },
      },
    ],
    edges: [],
  } as CanvasSnapshot;

  assert.equal(canonicalCanvasPayload(decorated), canonicalCanvasPayload(SNAPSHOT));
  assert.notEqual(
    canonicalCanvasPayload({ nodes: [node("web", 20)], edges: [] }),
    canonicalCanvasPayload(SNAPSHOT),
    "a real move still changes the payload",
  );
}

function checkReadResponseParsing() {
  assert.equal(parseCanvasReadResponse({ changed: false, version: 4 }), "unchanged");
  assert.deepEqual(
    parseCanvasReadResponse({ changed: true, canvas: null, version: 0, isAgentWrite: false }),
    { snapshot: { nodes: [], edges: [] }, version: 0, isAgentWrite: false },
    "never saved reads as an empty canvas",
  );
  assert.equal(
    parseCanvasReadResponse({ changed: true, canvas: SNAPSHOT, version: 2, isAgentWrite: true })
      ?.isAgentWrite,
    true,
  );
  assert.equal(parseCanvasReadResponse({ changed: true, canvas: SNAPSHOT }), null, "no version");
  assert.equal(parseCanvasReadResponse("junk"), null);
}

function checkSnapshotFlow() {
  const untouched = createSnapshotFlow(SNAPSHOT);
  assert.equal(untouched.hasChanged, false);

  const flow = createSnapshotFlow(SNAPSHOT);
  flow.addNodes([node("db", 280)]);
  flow.updateNode("web", { position: { x: 40, y: 0 } });
  flow.removeNodes(["missing"]);
  assert.equal(flow.hasChanged, true);
  assert.deepEqual(flow.toSnapshot().nodes.map((n) => [n.id, n.position.x]), [
    ["web", 40],
    ["db", 280],
  ]);
  assert.deepEqual(SNAPSHOT.nodes[0].position, { x: 0, y: 0 }, "the source snapshot is never mutated");
}

checkVersionParsing();
checkWriteParsing();
checkCanonicalPayloadIgnoresRuntimeFields();
checkReadResponseParsing();
checkSnapshotFlow();
console.log("✅ canvas version helpers verified");
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/verify-canvas-version.ts`
Expected: FAIL with a missing export (`createSnapshotFlow`, `parseCanvasReadResponse` and friends do not exist yet).

- [ ] **Step 3: Add the columns and migration**

In `prisma/models/diagram.prisma`, below `canvasJsonPath`:

```prisma
  /// Bumped on every canvas write. A writer sends the version it read, and a
  /// write against a version that has moved is refused with 409.
  canvasVersion Int @default(0)

  /// Whether the latest canvas write came from an agent-token route, so an
  /// open editor replays it with the agent cursor instead of snapping to it.
  canvasWrittenByAgent Boolean @default(false)
```

Rewrite the model's doc comment: "A system architecture graph stored as one versioned snapshot." and "`id` is one value doing two jobs: this primary key and the `/editor/[roomId]` segment." Change the `deletingAt` comment to "Deletion tombstone. A diagram ID is never reused. Either stamp makes the diagram inaccessible and excludes it from lists."

`prisma/migrations/20260925130000_diagram_canvas_version/migration.sql`:

```sql
-- Canvas writes become compare-and-swap on a per-diagram counter (ADR 0005).
ALTER TABLE "Diagram"
  ADD COLUMN "canvasVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "canvasWrittenByAgent" BOOLEAN NOT NULL DEFAULT false;
```

Run: `npx prisma validate && npm run generate`

- [ ] **Step 4: Add the snapshot helpers**

Append to `lib/canvas-snapshot.ts`:

```ts
/** A write carried a version the stored canvas has already moved past. */
export class CanvasVersionConflictError extends Error {
  constructor(diagramId: string) {
    super(`Canvas for ${diagramId} changed since it was read`);
    this.name = "CanvasVersionConflictError";
  }
}

/** A non-negative integer, from JSON or from a query string. */
export function parseCanvasVersion(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  return typeof value === "string" && /^\d+$/.test(value)
    ? parseCanvasVersion(Number(value))
    : null;
}

/** The PUT body: the version the client read, plus the snapshot to store. */
export function parseCanvasWrite(
  body: unknown,
): { version: number; snapshot: CanvasSnapshot } | null {
  if (!isRecord(body)) {
    return null;
  }

  const version = parseCanvasVersion(body.version);
  const snapshot = parseCanvasSnapshot(body.canvas);

  return version === null || !snapshot ? null : { version, snapshot };
}

/**
 * The snapshot exactly as it would be stored. React Flow adds `measured`,
 * `selected` and `dragging` to nodes it renders; comparing raw state would
 * treat opening an editor as an edit.
 */
export function canonicalCanvasPayload(snapshot: CanvasSnapshot): string {
  return serializeCanvasSnapshot(parseCanvasSnapshot(snapshot) ?? snapshot);
}
```

Also change `canvasBlobPath`'s comment to: "The stable prefix for a diagram's snapshots. Each write adds a random suffix, so a pointer never names a file that a later write overwrote."

- [ ] **Step 5: Add the client response parser**

`lib/canvas-client.ts` (the fetch wrappers land in Task 8; this task adds the pure half):

```ts
import {
  parseCanvasSnapshot,
  parseCanvasVersion,
  type CanvasSnapshot,
} from "@/lib/canvas-snapshot";

/** A stored canvas as the browser receives it. */
export interface RemoteCanvas {
  snapshot: CanvasSnapshot;
  version: number;
  isAgentWrite: boolean;
}

const EMPTY_CANVAS: CanvasSnapshot = { nodes: [], edges: [] };

/**
 * Reads a `GET /api/diagrams/:id/canvas` body. `"unchanged"` answers a
 * `?since=` poll whose version still matches; `null` is a body this build
 * cannot read, which callers treat as a failed request.
 */
export function parseCanvasReadResponse(body: unknown): RemoteCanvas | "unchanged" | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const { changed, canvas, version, isAgentWrite } = body as Record<string, unknown>;

  if (changed === false) {
    return "unchanged";
  }

  const parsedVersion = parseCanvasVersion(version);
  const snapshot = canvas === null ? EMPTY_CANVAS : parseCanvasSnapshot(canvas);

  if (changed !== true || parsedVersion === null || !snapshot) {
    return null;
  }

  return { snapshot, version: parsedVersion, isAgentWrite: isAgentWrite === true };
}
```

- [ ] **Step 6: Add the in-memory flow**

Append to `lib/agent-canvas-write.ts`:

```ts
/** An `AgentCanvasFlow` over a plain snapshot, for writes against Blob. */
export interface SnapshotFlow extends AgentCanvasFlow {
  readonly hasChanged: boolean;
  toSnapshot(): CanvasSnapshot;
}

/**
 * Same semantics the Liveblocks flow had: `updateNode` and `updateEdge` merge
 * shallowly, and `removeNodes` does not cascade to edges. Callers that remove
 * a node remove its edges themselves (see `applyDiff`).
 */
export function createSnapshotFlow(snapshot: CanvasSnapshot): SnapshotFlow {
  let nodes = [...snapshot.nodes];
  let edges = [...snapshot.edges];
  let hasChanged = false;
  const touch = () => {
    hasChanged = true;
  };

  return {
    get nodes() {
      return nodes;
    },
    get edges() {
      return edges;
    },
    get hasChanged() {
      return hasChanged;
    },
    addNodes: (added) => {
      nodes = [...nodes, ...added];
      touch();
    },
    addEdges: (added) => {
      edges = [...edges, ...added];
      touch();
    },
    updateNode: (id, partial) => {
      nodes = nodes.map((node) => (node.id === id ? ({ ...node, ...partial } as CanvasNode) : node));
      touch();
    },
    updateEdge: (id, partial) => {
      edges = edges.map((edge) => (edge.id === id ? ({ ...edge, ...partial } as CanvasEdge) : edge));
      touch();
    },
    removeNodes: (ids) => {
      nodes = nodes.filter((node) => !ids.includes(node.id));
      touch();
    },
    removeEdges: (ids) => {
      edges = edges.filter((edge) => !ids.includes(edge.id));
      touch();
    },
    toSnapshot: () => ({ nodes, edges }),
  };
}
```

`CanvasSnapshot` is already imported there as a type. Keep the file free of runtime imports from Prisma.

- [ ] **Step 7: Register and run**

In `package.json`, add `tsx scripts/verify-canvas-version.ts && ` to `verify:unit` right after `tsx scripts/verify-canvas.ts && `.

Run: `npx tsx scripts/verify-canvas-version.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add canvas versions and the helpers that carry them"
```

## Task 5: Versioned Blob store and the canvas route

**Files:**
- Modify: `lib/canvas-persistence.ts`, `lib/canvas-read.ts`, `app/api/diagrams/[diagramId]/canvas/route.ts`, `package.json`
- Create: `scripts/verify-canvas-store.ts`

**Interfaces:**
- Consumes: `CanvasVersionConflictError`, `parseCanvasVersion`, `parseCanvasWrite`, `createSnapshotFlow`, `AgentCanvasFlow` (Task 4).
- Produces (all in `lib/canvas-persistence.ts`):
  - `interface CanvasBlobClient { upload(pathname: string, body: string): Promise<string>; download(url: string): Promise<unknown>; remove(url: string): Promise<void> }`
  - `interface StoredCanvas { snapshot: CanvasSnapshot | null; version: number; isAgentWrite: boolean }`
  - `readStoredCanvas(diagramId: string, blob?: CanvasBlobClient): Promise<StoredCanvas>`
  - `readStoredCanvasSince(diagramId: string, since: number | null, blob?: CanvasBlobClient): Promise<StoredCanvas | "unchanged">`
  - `writeStoredCanvas(diagramId: string, snapshot: CanvasSnapshot, options: { expectedVersion: number; isAgentWrite: boolean }, blob?: CanvasBlobClient): Promise<number>`
  - `mutateStoredCanvas(diagramId: string, callback: (flow: AgentCanvasFlow) => void | Promise<void>, blob?: CanvasBlobClient): Promise<void>`
  - Errors: `CanvasSnapshotUploadError`, `CanvasSnapshotReadError`, `CanvasSnapshotInvalidError`
  - `GET /api/diagrams/:id/canvas[?since=N]` answers `{ changed: false, version }` or `{ changed: true, canvas, version, isAgentWrite }`.
  - `PUT /api/diagrams/:id/canvas` takes `{ version, canvas }` and answers `200 { version, savedAt }` or `409`.
  - `saveCanvasSnapshot` is removed.

- [ ] **Step 1: Write the failing integration verifier**

`scripts/verify-canvas-store.ts`:

```ts
import "dotenv/config";

import assert from "node:assert/strict";

import {
  mutateStoredCanvas,
  readStoredCanvas,
  readStoredCanvasSince,
  writeStoredCanvas,
  type CanvasBlobClient,
} from "../lib/canvas-persistence";
import { CanvasVersionConflictError, type CanvasSnapshot } from "../lib/canvas-snapshot";
import { prisma } from "../lib/prisma";
import { CANVAS_NODE_TYPE, type CanvasNode } from "../types/canvas";

const DIAGRAM_ID = "verify-canvas-store";
const OWNER_ID = "verify_canvas_store_owner";

function node(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    width: 160,
    height: 80,
    data: { label: id, color: "neutral", shape: "rectangle" },
  } as CanvasNode;
}

function snapshot(...ids: string[]): CanvasSnapshot {
  return { nodes: ids.map(node), edges: [] };
}

function memoryBlob() {
  const files = new Map<string, string>();
  let counter = 0;
  const client: CanvasBlobClient = {
    upload: async (pathname, body) => {
      counter += 1;
      const url = `memory://${pathname}#${counter}`;
      files.set(url, body);
      return url;
    },
    download: async (url) => {
      const body = files.get(url);
      if (body === undefined) throw new Error(`missing ${url}`);
      return JSON.parse(body);
    },
    remove: async (url) => {
      files.delete(url);
    },
  };
  return { files, client };
}

async function reset() {
  await prisma.diagram.deleteMany({ where: { id: DIAGRAM_ID } });
  await prisma.diagram.create({ data: { id: DIAGRAM_ID, ownerId: OWNER_ID, name: "Store" } });
}

async function checkFreshWriteAndRead() {
  await reset();
  const { files, client } = memoryBlob();

  const empty = await readStoredCanvas(DIAGRAM_ID, client);
  assert.deepEqual(empty, { snapshot: null, version: 0, isAgentWrite: false });

  assert.equal(await writeStoredCanvas(DIAGRAM_ID, snapshot("web"), { expectedVersion: 0, isAgentWrite: false }, client), 1);
  assert.equal(await writeStoredCanvas(DIAGRAM_ID, snapshot("web", "db"), { expectedVersion: 1, isAgentWrite: false }, client), 2);

  const stored = await readStoredCanvas(DIAGRAM_ID, client);
  assert.deepEqual(stored.snapshot?.nodes.map((n) => n.id), ["web", "db"]);
  assert.equal(stored.version, 2);
  assert.equal(files.size, 1, "a successful write deletes the snapshot it replaced");
}

/** Review Focus 1: a stale writer is refused and the stored canvas is untouched. */
async function checkStaleWriteIsRefused() {
  await reset();
  const { files, client } = memoryBlob();
  await writeStoredCanvas(DIAGRAM_ID, snapshot("agent"), { expectedVersion: 0, isAgentWrite: true }, client);

  await assert.rejects(
    writeStoredCanvas(DIAGRAM_ID, snapshot("human"), { expectedVersion: 0, isAgentWrite: false }, client),
    CanvasVersionConflictError,
  );

  const stored = await readStoredCanvas(DIAGRAM_ID, client);
  assert.deepEqual(stored.snapshot?.nodes.map((n) => n.id), ["agent"]);
  assert.equal(stored.version, 1);
  assert.equal(stored.isAgentWrite, true);
  assert.equal(files.size, 1, "a refused write leaves no orphan behind");
}

/** Two writers that both pass the first check: the loser's upload is cleaned up. */
async function checkLostSwapRemovesItsUpload() {
  await reset();
  const { files, client } = memoryBlob();
  const racing: CanvasBlobClient = {
    ...client,
    upload: async (pathname, body) => {
      const url = await client.upload(pathname, body);
      // Another writer lands between this upload and the pointer swap.
      await prisma.diagram.update({ where: { id: DIAGRAM_ID }, data: { canvasVersion: { increment: 1 } } });
      return url;
    },
  };

  await assert.rejects(
    writeStoredCanvas(DIAGRAM_ID, snapshot("late"), { expectedVersion: 0, isAgentWrite: false }, racing),
    CanvasVersionConflictError,
  );
  assert.equal(files.size, 0);
}

/** Review Focus 2: a download that fails because the pointer moved is retried once. */
async function checkReadRetriesAfterPointerMoves() {
  await reset();
  const { client } = memoryBlob();
  await writeStoredCanvas(DIAGRAM_ID, snapshot("one"), { expectedVersion: 0, isAgentWrite: false }, client);

  let isFirstDownload = true;
  const moving: CanvasBlobClient = {
    ...client,
    download: async (url) => {
      if (isFirstDownload) {
        isFirstDownload = false;
        await writeStoredCanvas(DIAGRAM_ID, snapshot("two"), { expectedVersion: 1, isAgentWrite: false }, client);
        return client.download(url);
      }
      return client.download(url);
    },
  };

  const stored = await readStoredCanvas(DIAGRAM_ID, moving);
  assert.deepEqual(stored.snapshot?.nodes.map((n) => n.id), ["two"]);
  assert.equal(stored.version, 2);
}

async function checkSinceSkipsTheDownload() {
  await reset();
  const { client } = memoryBlob();
  await writeStoredCanvas(DIAGRAM_ID, snapshot("web"), { expectedVersion: 0, isAgentWrite: false }, client);

  const refusing: CanvasBlobClient = {
    ...client,
    download: async () => {
      throw new Error("an unchanged poll must not touch Blob");
    },
  };

  assert.equal(await readStoredCanvasSince(DIAGRAM_ID, 1, refusing), "unchanged");
  const newer = await readStoredCanvasSince(DIAGRAM_ID, 0, client);
  assert.notEqual(newer, "unchanged");
}

async function checkMutateWritesOnlyChanges() {
  await reset();
  const { client } = memoryBlob();

  await mutateStoredCanvas(DIAGRAM_ID, () => undefined, client);
  assert.equal((await readStoredCanvas(DIAGRAM_ID, client)).version, 0, "a no-op mutate writes nothing");

  await mutateStoredCanvas(DIAGRAM_ID, (flow) => flow.addNodes([node("agent")]), client);
  const stored = await readStoredCanvas(DIAGRAM_ID, client);
  assert.equal(stored.version, 1);
  assert.equal(stored.isAgentWrite, true, "mutate is the agent write path");

  await writeStoredCanvas(DIAGRAM_ID, snapshot("agent", "human"), { expectedVersion: 1, isAgentWrite: false }, client);
  assert.equal((await readStoredCanvas(DIAGRAM_ID, client)).isAgentWrite, false);
}

async function main() {
  try {
    await checkFreshWriteAndRead();
    await checkStaleWriteIsRefused();
    await checkLostSwapRemovesItsUpload();
    await checkReadRetriesAfterPointerMoves();
    await checkSinceSkipsTheDownload();
    await checkMutateWritesOnlyChanges();
    console.log("✅ canvas store verified");
  } finally {
    await prisma.diagram.deleteMany({ where: { id: DIAGRAM_ID } });
    await prisma.$disconnect();
  }
}

void main();
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/verify-canvas-store.ts` (needs a development `DATABASE_URL` with Task 4's migration applied)
Expected: FAIL with a missing export (`readStoredCanvas` does not exist).

- [ ] **Step 3: Rewrite the persistence module**

Replace `lib/canvas-persistence.ts` with:

```ts
import { del, get, put } from "@vercel/blob";

import { createSnapshotFlow, type AgentCanvasFlow } from "@/lib/agent-canvas-write";
import {
  CanvasVersionConflictError,
  canvasBlobPath,
  parseCanvasSnapshot,
  serializeCanvasSnapshot,
  type CanvasSnapshot,
} from "@/lib/canvas-snapshot";
import { prisma } from "@/lib/prisma";

/**
 * The only store a canvas has (ADR 0005). Prisma holds the pointer and the
 * version, Blob holds the JSON. Every write uploads a new file and then swaps
 * the pointer with a compare-and-swap on `canvasVersion`, so the pointer and
 * the version always move together and a reader never sees one without the
 * other.
 */

/**
 * The store is configured for private access: a diagram is private to its
 * owner, and a public URL would be an unauthenticated read of the diagram.
 */
const BLOB_ACCESS = "private" as const;

export interface CanvasBlobClient {
  upload: (pathname: string, body: string) => Promise<string>;
  download: (url: string) => Promise<unknown>;
  remove: (url: string) => Promise<void>;
}

const vercelBlob: CanvasBlobClient = {
  upload: async (pathname, body) => {
    const blob = await put(pathname, body, {
      access: BLOB_ACCESS,
      contentType: "application/json",
      addRandomSuffix: true,
    });
    return blob.url;
  },
  download: async (url) => {
    // `get` attaches the token a private blob needs; a plain fetch cannot.
    const result = await get(url, { access: BLOB_ACCESS, useCache: false });

    if (!result || result.statusCode !== 200) {
      throw new Error(`Blob read returned ${result?.statusCode ?? "nothing"}`);
    }

    return new Response(result.stream).json();
  },
  remove: async (url) => {
    await del(url);
  },
};

export class CanvasSnapshotUploadError extends Error {
  constructor(cause: unknown) {
    super("Canvas snapshot upload failed", { cause });
    this.name = "CanvasSnapshotUploadError";
  }
}

export class CanvasSnapshotReadError extends Error {
  constructor(cause: unknown) {
    super("Canvas snapshot download failed", { cause });
    this.name = "CanvasSnapshotReadError";
  }
}

/** The pointer resolves, but what it names is not a canvas. */
export class CanvasSnapshotInvalidError extends Error {
  constructor(diagramId: string) {
    super(`Stored canvas for ${diagramId} is not a valid snapshot`);
    this.name = "CanvasSnapshotInvalidError";
  }
}

export interface StoredCanvas {
  /** `null` until the first save. */
  snapshot: CanvasSnapshot | null;
  version: number;
  isAgentWrite: boolean;
}

const HEAD_SELECT = {
  canvasJsonPath: true,
  canvasVersion: true,
  canvasWrittenByAgent: true,
} as const;

async function readHead(diagramId: string) {
  const head = await prisma.diagram.findUnique({ where: { id: diagramId }, select: HEAD_SELECT });

  if (!head) {
    throw new Error(`Diagram ${diagramId} does not exist`);
  }

  return head;
}

/**
 * The current canvas. A download that fails is retried once when the pointer
 * moved in the meantime: a concurrent write deletes the file it replaced, and
 * a reader holding the old pointer should get the new canvas, not a 502.
 */
export async function readStoredCanvas(
  diagramId: string,
  blob: CanvasBlobClient = vercelBlob,
): Promise<StoredCanvas> {
  let head = await readHead(diagramId);

  for (let attempt = 0; ; attempt += 1) {
    const meta = { version: head.canvasVersion, isAgentWrite: head.canvasWrittenByAgent };

    if (!head.canvasJsonPath) {
      return { snapshot: null, ...meta };
    }

    let stored: unknown;

    try {
      stored = await blob.download(head.canvasJsonPath);
    } catch (error: unknown) {
      const latest = await readHead(diagramId);

      if (attempt === 0 && latest.canvasJsonPath !== head.canvasJsonPath) {
        head = latest;
        continue;
      }

      throw new CanvasSnapshotReadError(error);
    }

    const snapshot = parseCanvasSnapshot(stored);

    if (!snapshot) {
      throw new CanvasSnapshotInvalidError(diagramId);
    }

    return { snapshot, ...meta };
  }
}

/** A poll: skips the Blob download entirely when `since` is still current. */
export async function readStoredCanvasSince(
  diagramId: string,
  since: number | null,
  blob: CanvasBlobClient = vercelBlob,
): Promise<StoredCanvas | "unchanged"> {
  if (since !== null && (await readHead(diagramId)).canvasVersion === since) {
    return "unchanged";
  }

  return readStoredCanvas(diagramId, blob);
}

async function removeQuietly(blob: CanvasBlobClient, url: string): Promise<void> {
  try {
    await blob.remove(url);
  } catch (error: unknown) {
    // An orphaned private blob costs storage, not correctness.
    console.error(`Canvas blob cleanup failed for ${url}`, error);
  }
}

/**
 * Stores `snapshot` if the canvas is still at `expectedVersion`, and returns
 * the new version. Throws `CanvasVersionConflictError` when it moved.
 */
export async function writeStoredCanvas(
  diagramId: string,
  snapshot: CanvasSnapshot,
  { expectedVersion, isAgentWrite }: { expectedVersion: number; isAgentWrite: boolean },
  blob: CanvasBlobClient = vercelBlob,
): Promise<number> {
  const before = await readHead(diagramId);

  // Cheap early refusal: no upload for a writer that is already stale.
  if (before.canvasVersion !== expectedVersion) {
    throw new CanvasVersionConflictError(diagramId);
  }

  let url: string;

  try {
    url = await blob.upload(canvasBlobPath(diagramId), serializeCanvasSnapshot(snapshot));
  } catch (error: unknown) {
    throw new CanvasSnapshotUploadError(error);
  }

  const { count } = await prisma.diagram.updateMany({
    where: { id: diagramId, canvasVersion: expectedVersion },
    data: {
      canvasJsonPath: url,
      canvasVersion: { increment: 1 },
      canvasWrittenByAgent: isAgentWrite,
    },
  });

  if (count === 0) {
    await removeQuietly(blob, url);
    throw new CanvasVersionConflictError(diagramId);
  }

  // The swap matched `expectedVersion`, so `before.canvasJsonPath` is exactly
  // the file this write replaced.
  if (before.canvasJsonPath) {
    await removeQuietly(blob, before.canvasJsonPath);
  }

  return expectedVersion + 1;
}

/**
 * Read, modify and write under one version, for the agent-token routes. The
 * callback sees the same `AgentCanvasFlow` surface `mutateFlow` gave it. A
 * callback that changes nothing writes nothing.
 */
export async function mutateStoredCanvas(
  diagramId: string,
  callback: (flow: AgentCanvasFlow) => void | Promise<void>,
  blob: CanvasBlobClient = vercelBlob,
): Promise<void> {
  const stored = await readStoredCanvas(diagramId, blob);
  const flow = createSnapshotFlow(stored.snapshot ?? { nodes: [], edges: [] });

  await callback(flow);

  if (!flow.hasChanged) {
    return;
  }

  await writeStoredCanvas(
    diagramId,
    flow.toSnapshot(),
    { expectedVersion: stored.version, isAgentWrite: true },
    blob,
  );
}
```

`lib/canvas-read.ts` becomes:

```ts
import { readStoredCanvas } from "@/lib/canvas-persistence";
import type { DesignContext } from "@/types/canvas";

/** The stored canvas, or an empty one before the first save. Throws on a failed read. */
export async function readCanvas(diagramId: string): Promise<DesignContext> {
  const { snapshot } = await readStoredCanvas(diagramId);

  return snapshot ?? { nodes: [], edges: [] };
}
```

- [ ] **Step 4: Rewrite the canvas route**

Replace both handlers in `app/api/diagrams/[diagramId]/canvas/route.ts` (keep `RouteParams`; drop the `@vercel/blob` import and `BLOB_ACCESS`):

```ts
import {
  CanvasSnapshotInvalidError,
  CanvasSnapshotUploadError,
  readStoredCanvasSince,
  writeStoredCanvas,
} from "@/lib/canvas-persistence";
import {
  CanvasVersionConflictError,
  parseCanvasVersion,
  parseCanvasWrite,
} from "@/lib/canvas-snapshot";
import { authorizeDiagram } from "@/lib/diagram-access";
import { jsonError, readJsonBody } from "@/lib/api-requests";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

/**
 * The canvas as one versioned snapshot (ADR 0005). `PUT` is a compare-and-swap
 * on the version the client last read; `GET ?since=N` is the idle editor's
 * cheap poll and answers `{ changed: false }` without touching Blob.
 */
export async function PUT(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;
  const access = await authorizeDiagram(request, diagramId);

  if (!access.ok) {
    return access.response;
  }

  const write = parseCanvasWrite(await readJsonBody(request));

  if (!write) {
    return jsonError("A canvas snapshot and version are required", 400);
  }

  try {
    const version = await writeStoredCanvas(diagramId, write.snapshot, {
      expectedVersion: write.version,
      isAgentWrite: false,
    });

    return Response.json({ version, savedAt: new Date().toISOString() });
  } catch (error: unknown) {
    if (error instanceof CanvasVersionConflictError) {
      return jsonError("The diagram changed elsewhere", 409);
    }

    if (error instanceof CanvasSnapshotUploadError) {
      console.error(`Canvas upload failed for ${diagramId}`, error);
      return jsonError("Could not save the canvas", 502);
    }

    throw error;
  }
}

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;
  const access = await authorizeDiagram(request, diagramId);

  if (!access.ok) {
    return access.response;
  }

  const since = parseCanvasVersion(new URL(request.url).searchParams.get("since"));

  try {
    const stored = await readStoredCanvasSince(diagramId, since);

    if (stored === "unchanged") {
      return Response.json({ changed: false, version: since });
    }

    return Response.json({
      changed: true,
      canvas: stored.snapshot,
      version: stored.version,
      isAgentWrite: stored.isAgentWrite,
    });
  } catch (error: unknown) {
    if (error instanceof CanvasSnapshotInvalidError) {
      // Answering `canvas: null` would look like "never saved" and let an
      // autosave quietly overwrite whatever is really there.
      console.error(error.message);
      return jsonError("The saved canvas could not be read", 422);
    }

    console.error(`Canvas download failed for ${diagramId}`, error);
    return jsonError("Could not load the canvas", 502);
  }
}
```

The agent routes still import `saveCanvasSnapshot` until Task 6. Keep a temporary re-export at the bottom of `lib/canvas-persistence.ts` so this commit type-checks, and delete it in Task 6:

```ts
/** Removed in Task 6 with its last two callers. */
export async function saveCanvasSnapshot(diagramId: string, snapshot: CanvasSnapshot): Promise<void> {
  const { version } = await readStoredCanvas(diagramId);
  await writeStoredCanvas(diagramId, snapshot, { expectedVersion: version, isAgentWrite: true });
}
```

- [ ] **Step 5: Register and run**

In `package.json`, add `tsx scripts/verify-canvas-store.ts && ` to `verify:integration` after `tsx scripts/verify-diagram-data.ts && `.

Run: `npm run typecheck && npx tsx scripts/verify-canvas-store.ts && npm run verify:unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: store the canvas as a versioned blob snapshot"
```

## Task 6: Agent writes go through the store

**Files:**
- Modify: `lib/agent-canvas-write.ts`, `lib/agent-graph-edit-server.ts`, `lib/agent-graph-import-server.ts`, `lib/agent-graph-read-server.ts`, `lib/canvas-drawing.ts`, `lib/canvas-persistence.ts`, `app/api/diagrams/[diagramId]/agent-graph-edit/route.ts`, `app/api/diagrams/[diagramId]/agent-launch-import/route.ts`
- Delete: `lib/ai-activity.ts`, `lib/agent-graph-import-config.ts`
- Test: `scripts/verify-agent-graph-edit.ts`, `scripts/verify-agent-graph-import.ts`, `scripts/verify-canvas-drawing.ts`

**Interfaces:**
- Consumes: `mutateStoredCanvas`, `CanvasVersionConflictError` (Tasks 4 and 5).
- Produces:
  - `interface AgentCanvasWriteDependencies { authorizeDiagram(diagramId: string): Promise<Authorization>; mutateCanvas(diagramId: string, callback: (flow: AgentCanvasFlow) => void | Promise<void>): Promise<void> }`
  - Both handlers answer `409 { error: "The canvas changed since it was read" }` on a version conflict and never call a separate save.
  - `drawNodesThenEdges`, `AgentCanvasAddFlow`, `runWithAiPresenceCleanup` and the server presence helpers no longer exist. The pacing loop in `lib/canvas-drawing.ts` stays for Task 9.

- [ ] **Step 1: Point the edit verifier at the new dependency shape**

In `scripts/verify-agent-graph-edit.ts`:
- Replace `makeFlow` with a thin wrapper over the real flow:

```ts
function makeFlow(nodes: CanvasNode[], edges: CanvasEdge[]) {
  let flow = createSnapshotFlow({ nodes, edges });
  const state = {
    get nodes() {
      return flow.nodes;
    },
    get edges() {
      return flow.edges;
    },
  };
  return { flow, state, reset: (next: SnapshotFlow) => (flow = next) };
}
```

  Import `createSnapshotFlow, type SnapshotFlow` from `../lib/agent-canvas-write`.
- Replace `deps` with:

```ts
function deps(flow: SnapshotFlow, saved: { snapshot?: unknown }): AgentGraphEditDependencies {
  return {
    authorizeDiagram: async () => ({ ok: true as const, userId: "u1" }),
    mutateCanvas: async (_diagramId, callback) => {
      await callback(flow);
      // Mirrors `mutateStoredCanvas`: only a changed canvas is written.
      if (flow.hasChanged) saved.snapshot = flow.toSnapshot();
    },
  };
}
```

- Rename every `mutateFlow:` override to `mutateCanvas:`. In `checkMutateFlowFailureIs502`, rename the function to `checkStoreFailureIs502` and change the thrown message to `"blob unavailable"`.
- Replace `checkPersistenceFailureAfterApplyIs502` with:

```ts
async function checkVersionConflictIs409(): Promise<void> {
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow } = makeFlow([...start.nodes], [...start.edges]);
  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web"), n("db", "DB", 280, 0)], edges: [] },
    }),
    "p1",
    {
      ...deps(flow, {}),
      mutateCanvas: async () => {
        throw new CanvasVersionConflictError("p1");
      },
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "The canvas changed since it was read" });
}
```

  Import `CanvasVersionConflictError` from `../lib/canvas-snapshot` and update `main()`.

- [ ] **Step 2: Point the import verifier at the new dependency shape**

In `scripts/verify-agent-graph-import.ts`:
- Delete the `AI_CURSOR_*`, `getBuildStepMs` and `AGENT_GRAPH_IMPORT_MAX_DURATION_SECONDS` imports.
- In `createDependencies`, rename `mutateFlow` to `mutateCanvas`. At the end of its body, after `await callback(flow);`, count a persisted write only when this call added something:

```ts
        const writesBefore = flowWriteCount;
        await callback(flow);
        if (flowWriteCount > writesBefore) {
          persistenceCount += 1;
          savedSnapshots.push(structuredClone(canvas));
        }
```

  Delete `saveCanvasSnapshot`, `setAiPresence`, `clearAiPresence` and `sleep` from the returned dependencies, and change the `authorizeDiagram` stub to `{ ok: true, userId: "user-owner" }`.
- Replace `checkExactReplayDoesNotWriteFlowAndRetriesPersistence` with:

```ts
/** A replay of an import that already landed writes nothing and still answers 200. */
async function checkExactReplayWritesNothing(): Promise<void> {
  const canvas = materializeAgentGraph(graph);
  const { dependencies, getFlowWriteCount, getPersistenceCount } = createDependencies(canvas);

  const response = await handleAgentGraphImportPost(request({ launchId, graph }), "diagram-1", dependencies);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { imported: false });
  assert.equal(getFlowWriteCount(), 0);
  assert.equal(getPersistenceCount(), 0);
}
```

- In `checkSemanticReplayAndDivergentConflict`, change `assert.equal(replay.getPersistenceCount(), 1)` to `0`: an exact replay no longer rewrites the snapshot.
- Replace `checkPacedCursorDrawingAndPartialResume` with the same scenario minus pacing:

```ts
/** An interrupted import resumes by adding only what is missing. */
async function checkPartialResumeAddsOnlyMissingItems(): Promise<void> {
  const canvas: CanvasSnapshot = { nodes: [materializeAgentGraph(graph).nodes[0]], edges: [] };
  const { dependencies, getFlowWrites, getPersistenceCount } = createDependencies(canvas);

  const response = await handleAgentGraphImportPost(request({ launchId, graph }), "diagram-1", dependencies);

  assert.equal(response.status, 200);
  assert.deepEqual(getFlowWrites(), ["node:orders-api", "edge:client-to-orders"]);
  assert.equal(getPersistenceCount(), 1);
}
```

- Delete `checkRouteDurationCoversMaximumNativeImport`. Add a conflict check mirroring the edit one (`mutateCanvas` throws `CanvasVersionConflictError`, expect `409` and `{ error: "The canvas changed since it was read" }`). Update `main()`.
- In `checkEmptyCanvasImportsAndPersistsCanonicalSnapshot`, change `getFlowWriteCount()` to `2` and `getFlowWrites()` stays the same list: the server now adds all nodes in one call and all edges in another. Update the assertion messages to say "one node write and one edge write".

- [ ] **Step 3: Run both to see them fail**

Run: `npx tsx scripts/verify-agent-graph-edit.ts; npx tsx scripts/verify-agent-graph-import.ts`
Expected: FAIL. The handlers still call `dependencies.mutateFlow` and `dependencies.saveCanvasSnapshot`.

- [ ] **Step 4: Slim the shared write module**

In `lib/agent-canvas-write.ts`:
- Delete the `canvas-drawing` import, `AgentCanvasAddFlow`, and `drawNodesThenEdges`.
- Replace `AgentCanvasWriteDependencies` with:

```ts
export interface AgentCanvasWriteDependencies {
  authorizeDiagram: (diagramId: string) => Promise<Authorization>;
  /** Read, modify and write the stored canvas under one version. */
  mutateCanvas: (
    diagramId: string,
    callback: (flow: AgentCanvasFlow) => void | Promise<void>,
  ) => Promise<void>;
}
```

- Rewrite the `AgentCanvasFlow` doc comment: "The flow surface the agent write paths share. `createSnapshotFlow` implements it over a stored snapshot."

- [ ] **Step 5: Rewrite the edit handler's apply and persistence**

In `lib/agent-graph-edit-server.ts`:
- Import `CanvasVersionConflictError` from `@/lib/canvas-snapshot` and drop `drawNodesThenEdges` from the import.
- `applyDiff` loses its `diagramId` and `dependencies` parameters and becomes synchronous. Keep the removal and update loops as they are, then end with:

```ts
  flow.addNodes(diff.addedNodes.map((node) => desiredNodes.get(node.id)!));
  flow.addEdges(diff.addedEdges.map((edge) => desiredEdges.get(edge.id)!));
```

  Change the paragraph about `removeNodes` in `@liveblocks/react-flow` to "`removeNodes` does not cascade (see `createSnapshotFlow`)", keeping the rest of that comment.
- In `handleAgentGraphEditPost`, replace the `try { await dependencies.mutateFlow(…) } catch …` block and everything after it through the final return with:

```ts
  let decision: EditDecision = "stale";

  try {
    await dependencies.mutateCanvas(diagramId, (flow) => {
      const liveSnapshot: CanvasSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };

      if (canvasFingerprint(liveSnapshot) !== parsed.fingerprint) {
        decision = "stale";
        return;
      }

      const live = canvasToAgentGraph(liveSnapshot);

      if (collidesWithOpaque(live, parsed.graph)) {
        decision = "collision";
        return;
      }

      applyDiff(flow, diffAgentGraph(live, parsed.graph), desiredSnapshot, liveSnapshot);
      decision = "applied";
    });
  } catch (error: unknown) {
    if (error instanceof CanvasVersionConflictError) {
      return jsonError("The canvas changed since it was read", 409);
    }

    console.error(`Agent graph edit failed for ${diagramId}`, error);
    return jsonError("Could not apply the graph edit", 502);
  }

  if (decision === "stale") {
    return jsonError("The canvas changed since it was read", 409);
  }

  if (decision === "collision") {
    return jsonError("The edit reuses an ID that is already in use", 409);
  }

  return Response.json({ applied: true });
```

  Use whichever of `canvasToAgentGraph`/`projectCanvasToAgentGraph` the file already imports on `main` (it is `canvasToAgentGraph` there). Delete `appliedSnapshot`. Update the function's doc comment: the fingerprint is recomputed inside `mutateCanvas`, and the version swap closes the window between that check and the write.

- [ ] **Step 6: Rewrite the import handler's apply and persistence**

In `lib/agent-graph-import-server.ts`:
- Import `CanvasVersionConflictError`, drop `drawNodesThenEdges`.
- Replace the `try { await dependencies.mutateFlow(…) } catch { … }` block and everything after it with:

```ts
  let decision: ImportDecision = "conflict";

  try {
    await dependencies.mutateCanvas(diagramId, (flow) => {
      const existingSnapshot: CanvasSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };
      const missingItems = findMissingCanonicalItems(existingSnapshot, requestedSnapshot);

      if (!missingItems) {
        decision = "conflict";
        return;
      }

      if (missingItems.nodes.length === 0 && missingItems.edges.length === 0) {
        decision = "exact";
        return;
      }

      decision =
        existingSnapshot.nodes.length === 0 && existingSnapshot.edges.length === 0
          ? "empty"
          : "resume";

      if (missingItems.nodes.length > 0) {
        flow.addNodes(missingItems.nodes);
      }

      if (missingItems.edges.length > 0) {
        flow.addEdges(missingItems.edges);
      }
    });
  } catch (error: unknown) {
    if (error instanceof CanvasVersionConflictError) {
      return jsonError("The canvas changed since it was read", 409);
    }

    return jsonError("Could not import the graph", 502);
  }

  if (decision === "conflict") {
    return jsonError("Canvas already contains a different graph", 409);
  }

  return Response.json({ imported: decision === "empty" || decision === "resume" });
```

- [ ] **Step 7: Rewire both routes and delete the server presence**

`app/api/diagrams/[diagramId]/agent-graph-edit/route.ts` becomes (the import route is identical with `handleAgentGraphImportPost`):

```ts
import { handleAgentGraphEditPost } from "@/lib/agent-graph-edit-server";
import { mutateStoredCanvas } from "@/lib/canvas-persistence";
import { authorizeDiagram } from "@/lib/diagram-access";

interface RouteParams {
  params: Promise<{ diagramId: string }>;
}

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  const { diagramId } = await params;

  return handleAgentGraphEditPost(request, diagramId, {
    // Closes over `request` so a `trs_agent_...` bearer token resolves the
    // same way a browser session does.
    authorizeDiagram: (id) => authorizeDiagram(request, id),
    mutateCanvas: (id, callback) => mutateStoredCanvas(id, callback),
  });
}
```

The `maxDuration = 120` exports go: the server no longer paces its writes.

```bash
git rm lib/ai-activity.ts lib/agent-graph-import-config.ts
```

Delete the temporary `saveCanvasSnapshot` from `lib/canvas-persistence.ts`.

In `lib/canvas-drawing.ts`, delete `runWithAiPresenceCleanup`. In `scripts/verify-canvas-drawing.ts`, delete `checkWholeRunCleanupCoversZeroActionAndPreBuildFailure` and its call. In `lib/agent-graph-read-server.ts`, change the last paragraph of the doc comment to: "The compact view comes from the stored snapshot, the same one `agent-graph-edit` diffs and writes against, so the fingerprint it returns is the one an edit is checked against."

- [ ] **Step 8: Run the checks**

Run: `npm run typecheck && npm run lint && npm run verify:unit`
Expected: PASS. `git grep -n "mutateFlow\|setAiPresence\|clearAiPresence\|saveCanvasSnapshot\|drawNodesThenEdges"` prints only `lib/canvas-drawing.ts` (Task 9 rewrites it), `docs/` and `context/`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: route agent canvas writes through the versioned store"
```

## Task 7: Local undo history

**Files:**
- Create: `lib/canvas-history.ts`, `hooks/use-canvas-history.ts`, `scripts/verify-canvas-history.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `CanvasSnapshot`.
- Produces:
  - `MAX_CANVAS_HISTORY = 100`, `CANVAS_HISTORY_COALESCE_MS = 500`
  - `interface CanvasHistoryStacks { past: readonly CanvasSnapshot[]; future: readonly CanvasSnapshot[] }`, `EMPTY_CANVAS_HISTORY`
  - `pushCanvasHistory(stacks, snapshot): CanvasHistoryStacks`
  - `undoCanvasHistory(stacks, current): { stacks: CanvasHistoryStacks; snapshot: CanvasSnapshot } | null`, and `redoCanvasHistory` with the same shape
  - `isCanvasHistoryCommit(change: NodeChange<CanvasNode> | EdgeChange<CanvasEdge>, nodes: readonly CanvasNode[]): boolean`
  - `useCanvasHistory(current: CanvasSnapshot, restore: (snapshot: CanvasSnapshot) => void): CanvasHistoryControls` where `CanvasHistoryControls = { undo(): void; redo(): void; canUndo: boolean; canRedo: boolean; checkpoint(): void; reset(): void }`

- [ ] **Step 1: Write the failing verifier**

`scripts/verify-canvas-history.ts`:

```ts
import assert from "node:assert/strict";

import {
  EMPTY_CANVAS_HISTORY,
  MAX_CANVAS_HISTORY,
  isCanvasHistoryCommit,
  pushCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
} from "../lib/canvas-history";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { CANVAS_NODE_TYPE, type CanvasNode } from "../types/canvas";

function node(id: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { label: id, color: "neutral", shape: "rectangle" },
    ...extra,
  } as CanvasNode;
}

const s = (label: string): CanvasSnapshot => ({ nodes: [node(label)], edges: [] });

function checkUndoRedoRoundTrip() {
  const pushed = pushCanvasHistory(pushCanvasHistory(EMPTY_CANVAS_HISTORY, s("a")), s("b"));
  const undone = undoCanvasHistory(pushed, s("c"));
  assert.ok(undone);
  assert.equal(undone.snapshot.nodes[0].id, "b");
  assert.deepEqual(undone.stacks.future.map((x) => x.nodes[0].id), ["c"]);

  const redone = redoCanvasHistory(undone.stacks, undone.snapshot);
  assert.ok(redone);
  assert.equal(redone.snapshot.nodes[0].id, "c");
  assert.deepEqual(redone.stacks.past.map((x) => x.nodes[0].id), ["a", "b"]);
}

function checkEdgesOfTheStacks() {
  assert.equal(undoCanvasHistory(EMPTY_CANVAS_HISTORY, s("x")), null, "nothing to undo");
  assert.equal(redoCanvasHistory(EMPTY_CANVAS_HISTORY, s("x")), null, "nothing to redo");

  const undone = undoCanvasHistory(pushCanvasHistory(EMPTY_CANVAS_HISTORY, s("a")), s("b"));
  assert.ok(undone);
  const branched = pushCanvasHistory(undone.stacks, s("a"));
  assert.deepEqual(branched.future, [], "a new edit after undo drops the redo branch");
}

function checkTheCap() {
  let stacks = EMPTY_CANVAS_HISTORY;
  for (let index = 0; index < MAX_CANVAS_HISTORY + 5; index += 1) {
    stacks = pushCanvasHistory(stacks, s(`n${index}`));
  }
  assert.equal(stacks.past.length, MAX_CANVAS_HISTORY);
  assert.equal(stacks.past[0].nodes[0].id, "n5", "the oldest entries fall off first");
}

/** Review Focus 5: a remote apply resets history to empty. */
function checkResetEmptiesBothStacks() {
  assert.deepEqual(EMPTY_CANVAS_HISTORY, { past: [], future: [] });
}

/** Review Focus 4: one drag is one entry, and measuring is not an edit. */
function checkCommitClassification() {
  const idle = [node("a")];
  const dragging = [node("a", { dragging: true })];
  const resizing = [node("a", { resizing: true })];

  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", dragging: true, position: { x: 1, y: 0 } }, idle), true, "drag start");
  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", dragging: true, position: { x: 2, y: 0 } }, dragging), false, "mid drag");
  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", dragging: false, position: { x: 3, y: 0 } }, dragging), false, "drag end");
  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", position: { x: 20, y: 0 } }, idle), true, "arrow-key move");

  assert.equal(isCanvasHistoryCommit({ type: "dimensions", id: "a", dimensions: { width: 10, height: 10 } }, idle), false, "measurement");
  assert.equal(isCanvasHistoryCommit({ type: "dimensions", id: "a", resizing: true, dimensions: { width: 10, height: 10 } }, idle), true, "resize start");
  assert.equal(isCanvasHistoryCommit({ type: "dimensions", id: "a", resizing: true, dimensions: { width: 12, height: 10 } }, resizing), false, "mid resize");

  assert.equal(isCanvasHistoryCommit({ type: "select", id: "a", selected: true }, idle), false, "selection");
  assert.equal(isCanvasHistoryCommit({ type: "remove", id: "a" }, idle), true);
  assert.equal(isCanvasHistoryCommit({ type: "replace", id: "a", item: node("a") }, idle), true, "label or colour edit");
}

checkUndoRedoRoundTrip();
checkEdgesOfTheStacks();
checkTheCap();
checkResetEmptiesBothStacks();
checkCommitClassification();
console.log("✅ canvas history verified");
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/verify-canvas-history.ts`
Expected: FAIL, `lib/canvas-history.ts` does not exist.

- [ ] **Step 3: Write the pure module**

`lib/canvas-history.ts`:

```ts
import type { EdgeChange, NodeChange } from "@xyflow/react";

import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * Undo and redo for one editor tab. Liveblocks room history did this before
 * (ADR 0005); React Flow has no equivalent.
 *
 * Entries are whole snapshots. React state arrays are immutable, so an entry
 * shares every node object it did not change and costs little.
 *
 * ponytail: snapshot stack, O(diagram) per entry and capped at
 * MAX_CANVAS_HISTORY. Switch to stored change arrays if a large diagram makes
 * the cap felt.
 */
export const MAX_CANVAS_HISTORY = 100;

/** Edits closer together than this share one undo step, so typing a label is one step. */
export const CANVAS_HISTORY_COALESCE_MS = 500;

export interface CanvasHistoryStacks {
  past: readonly CanvasSnapshot[];
  future: readonly CanvasSnapshot[];
}

export const EMPTY_CANVAS_HISTORY: CanvasHistoryStacks = { past: [], future: [] };

/** Records the state *before* an edit. A new edit drops the redo branch. */
export function pushCanvasHistory(
  stacks: CanvasHistoryStacks,
  snapshot: CanvasSnapshot,
): CanvasHistoryStacks {
  return { past: [...stacks.past, snapshot].slice(-MAX_CANVAS_HISTORY), future: [] };
}

export function undoCanvasHistory(
  stacks: CanvasHistoryStacks,
  current: CanvasSnapshot,
): { stacks: CanvasHistoryStacks; snapshot: CanvasSnapshot } | null {
  const snapshot = stacks.past.at(-1);

  return snapshot
    ? { snapshot, stacks: { past: stacks.past.slice(0, -1), future: [current, ...stacks.future] } }
    : null;
}

export function redoCanvasHistory(
  stacks: CanvasHistoryStacks,
  current: CanvasSnapshot,
): { stacks: CanvasHistoryStacks; snapshot: CanvasSnapshot } | null {
  const [snapshot, ...future] = stacks.future;

  return snapshot
    ? { snapshot, stacks: { past: [...stacks.past, current].slice(-MAX_CANVAS_HISTORY), future } }
    : null;
}

/**
 * Whether a React Flow change starts an undoable edit. A drag or a resize is
 * one edit: only its first frame counts, detected by the node not yet
 * carrying the `dragging` or `resizing` flag that frame sets. A dimensions
 * change without `resizing` is React Flow measuring a node, not an edit.
 */
export function isCanvasHistoryCommit(
  change: NodeChange<CanvasNode> | EdgeChange<CanvasEdge>,
  nodes: readonly CanvasNode[],
): boolean {
  switch (change.type) {
    case "add":
    case "remove":
    case "replace":
      return true;
    case "position":
      return !nodes.find((node) => node.id === change.id)?.dragging;
    case "dimensions":
      return change.resizing === true && !nodes.find((node) => node.id === change.id)?.resizing;
    default:
      return false;
  }
}
```

- [ ] **Step 4: Write the hook**

`hooks/use-canvas-history.ts`:

```ts
"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import {
  CANVAS_HISTORY_COALESCE_MS,
  EMPTY_CANVAS_HISTORY,
  pushCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
  type CanvasHistoryStacks,
} from "@/lib/canvas-history";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";

export interface CanvasHistoryControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Call from an event handler *before* applying an edit. */
  checkpoint: () => void;
  /** Forget everything, after the canvas was replaced from outside this tab. */
  reset: () => void;
}

/**
 * History is recorded from event handlers, never from effects: the caller
 * checkpoints before it applies an edit, which is the only moment the
 * pre-edit state is still in hand.
 */
export function useCanvasHistory(
  current: CanvasSnapshot,
  restore: (snapshot: CanvasSnapshot) => void,
): CanvasHistoryControls {
  const [stacks, setStacks] = useState<CanvasHistoryStacks>(EMPTY_CANVAS_HISTORY);
  const lastEditAt = useRef(Number.NEGATIVE_INFINITY);

  const checkpoint = useCallback(() => {
    const now = Date.now();
    const isSameBurst = now - lastEditAt.current < CANVAS_HISTORY_COALESCE_MS;

    lastEditAt.current = now;

    if (!isSameBurst) {
      setStacks((previous) => pushCanvasHistory(previous, current));
    }
  }, [current]);

  const step = useCallback(
    (move: typeof undoCanvasHistory) => {
      const result = move(stacks, current);

      if (!result) {
        return;
      }

      // The next edit must start its own step, even straight after an undo.
      lastEditAt.current = Number.NEGATIVE_INFINITY;
      setStacks(result.stacks);
      restore(result.snapshot);
    },
    [current, restore, stacks],
  );

  const undo = useCallback(() => step(undoCanvasHistory), [step]);
  const redo = useCallback(() => step(redoCanvasHistory), [step]);
  const reset = useCallback(() => {
    lastEditAt.current = Number.NEGATIVE_INFINITY;
    setStacks(EMPTY_CANVAS_HISTORY);
  }, []);

  return useMemo(
    () => ({
      undo,
      redo,
      checkpoint,
      reset,
      canUndo: stacks.past.length > 0,
      canRedo: stacks.future.length > 0,
    }),
    [checkpoint, redo, reset, stacks, undo],
  );
}
```

- [ ] **Step 5: Register and run**

Add `tsx scripts/verify-canvas-history.ts && ` to `verify:unit` after the Task 4 entry.

Run: `npx tsx scripts/verify-canvas-history.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add a local undo history for the canvas"
```

## Task 8: The canvas runs on local React Flow state

**Files:**
- Create: `components/canvas/canvas-surface.tsx`, `components/canvas/agent-presence.tsx`, `hooks/use-stored-canvas.ts`
- Delete: `components/canvas/canvas-room.tsx`, `hooks/use-canvas-restore.ts`, `hooks/use-collaborators.ts`
- Modify: `lib/canvas-client.ts`, `hooks/use-canvas-autosave.ts`, `components/canvas/canvas.tsx`, `components/canvas/canvas-controls.tsx`, `components/canvas/canvas-save-context.tsx`, `components/canvas/canvas-motion-context.tsx`, `components/canvas/live-cursors.tsx`, `components/canvas/presence-avatars.tsx`, `components/editor/editor-shell.tsx`, `components/editor/save-status-button.tsx`, `lib/presence.ts`, `types/tasks.ts`
- Test: `scripts/verify-canvas.ts`, manual browser pass

**Interfaces:**
- Consumes: `RemoteCanvas`, `parseCanvasReadResponse`, `canonicalCanvasPayload`, `parseCanvasVersion` (Task 4); the canvas route contract (Task 5); `useCanvasHistory`, `isCanvasHistoryCommit` (Task 7).
- Produces:
  - `fetchCanvas(diagramId: string, since?: number, signal?: AbortSignal): Promise<RemoteCanvas | null>` (`null` means unchanged) and `putCanvas(diagramId: string, payload: string, version: number): Promise<{ status: "saved"; version: number } | { status: "conflict" }>`
  - `type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict"`
  - `useCanvasAutosave(diagramId: string, payload: string, initialVersion: number, onStatusChange: (status: SaveStatus) => void): CanvasAutosave` with `CanvasAutosave = { saveNow(): void; isClean(): boolean; getVersion(): number; adopt(payload: string, version: number): void; whilePaused(run: () => Promise<void>): Promise<void> }`
  - `AgentPresenceProvider`, `useAgentPresence(): AgentPresence | null`, `useSetAgentPresence(): (presence: AgentPresence | null) => void` with `AgentPresence = { cursor: XYPosition | null }`
  - `CanvasSurface({ diagramId, isTemplatesOpen, onTemplatesOpenChange, children })`
  - `CanvasControls({ history })`
  - `AI_USER_COLOR` in `types/tasks.ts`

- [ ] **Step 1: Drop the per-person presence check**

In `scripts/verify-canvas.ts`, delete `checkAvatarsAreOnePerPerson` and its call, and remove `dedupeByUser` from the `../lib/presence` import. Keep `checkInitialsAlwaysRenderSomething`.

Run: `npx tsx scripts/verify-canvas.ts`
Expected: PASS (nothing else depends on it yet).

In `lib/presence.ts`, delete `dedupeByUser` and its doc comment. Change the header to "Avatar display helpers."

- [ ] **Step 2: Add the browser fetch wrappers**

Append to `lib/canvas-client.ts`:

```ts
/**
 * Loads the stored canvas. With `since`, answers `null` when the version still
 * matches, which is the idle editor's poll.
 */
export async function fetchCanvas(
  diagramId: string,
  since?: number,
  signal?: AbortSignal,
): Promise<RemoteCanvas | null> {
  const query = since === undefined ? "" : `?since=${since}`;
  const response = await fetch(`/api/diagrams/${diagramId}/canvas${query}`, { signal });

  if (!response.ok) {
    throw new Error(`Canvas load responded ${response.status}`);
  }

  const parsed = parseCanvasReadResponse(await response.json());

  if (parsed === null) {
    throw new Error("Canvas load returned an unreadable body");
  }

  return parsed === "unchanged" ? null : parsed;
}

/** One compare-and-swap save. `payload` is already the canonical snapshot JSON. */
export async function putCanvas(
  diagramId: string,
  payload: string,
  version: number,
): Promise<{ status: "saved"; version: number } | { status: "conflict" }> {
  const response = await fetch(`/api/diagrams/${diagramId}/canvas`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // Spliced rather than re-stringified: `payload` is valid JSON already.
    body: `{"version":${version},"canvas":${payload}}`,
  });

  if (response.status === 409) {
    return { status: "conflict" };
  }

  if (!response.ok) {
    throw new Error(`Canvas save responded ${response.status}`);
  }

  const next = parseCanvasVersion(((await response.json()) as { version?: unknown }).version);

  if (next === null) {
    throw new Error("Canvas save response carried no version");
  }

  return { status: "saved", version: next };
}
```

- [ ] **Step 3: Teach autosave about versions**

Replace `hooks/use-canvas-autosave.ts` with:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import { putCanvas } from "@/lib/canvas-client";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

/**
 * Long enough that dragging a node is one save rather than sixty, short enough
 * that a person who edits and immediately closes the tab keeps their work.
 */
const AUTOSAVE_DEBOUNCE_MS = 1500;

export interface CanvasAutosave {
  /** Flushes immediately, ignoring the debounce. Backs the navbar Save button. */
  saveNow: () => void;
  /** Every local edit has reached the server and nothing is in flight. */
  isClean: () => boolean;
  /** The version this tab last read or wrote. */
  getVersion: () => number;
  /** Takes a server canvas as the saved baseline, so applying it is not an edit. */
  adopt: (payload: string, version: number) => void;
  /** Holds saves while `run` applies a remote canvas, then flushes any local edit. */
  whilePaused: (run: () => Promise<void>) => Promise<void>;
}

/**
 * Debounced canvas persistence against a versioned store (ADR 0005).
 *
 * Every save sends the version it is based on. A `409` means someone else
 * wrote first: the tab stops saving and the navbar asks for a reload, because
 * saving over that write would silently discard it.
 */
export function useCanvasAutosave(
  diagramId: string,
  payload: string,
  initialVersion: number,
  onStatusChange: (status: SaveStatus) => void,
): CanvasAutosave {
  const setStatus = useRef(onStatusChange);

  useEffect(() => {
    setStatus.current = onStatusChange;
  }, [onStatusChange]);

  /**
   * Seeded with the payload the editor opened on, so merely opening a diagram
   * never writes. The payload is canonical (Task 4), so React Flow measuring
   * nodes does not count as a change either.
   */
  const savedPayload = useRef(payload);
  const latestPayload = useRef(payload);
  const version = useRef(initialVersion);
  const isSaving = useRef(false);
  const isPendingResave = useRef(false);
  const isPaused = useRef(false);
  const hasConflict = useRef(false);
  const saveRef = useRef<((body: string) => Promise<void>) | null>(null);

  useEffect(() => {
    latestPayload.current = payload;
  }, [payload]);

  const save = useCallback(
    async (body: string) => {
      if (isPaused.current || hasConflict.current) {
        return;
      }

      if (isSaving.current) {
        isPendingResave.current = true;
        return;
      }

      isSaving.current = true;
      setStatus.current("saving");

      try {
        const result = await putCanvas(diagramId, body, version.current);

        if (result.status === "conflict") {
          hasConflict.current = true;
          setStatus.current("conflict");
          return;
        }

        version.current = result.version;
        savedPayload.current = body;
        setStatus.current("saved");
      } catch (error: unknown) {
        // Left visible in the navbar rather than retried on a timer: a retry
        // loop against a failing endpoint is how a save bug becomes a bill.
        console.error("Canvas autosave failed", error);
        setStatus.current("error");
      } finally {
        isSaving.current = false;

        if (isPendingResave.current) {
          isPendingResave.current = false;

          if (latestPayload.current !== savedPayload.current) {
            void saveRef.current?.(latestPayload.current);
          }
        }
      }
    },
    [diagramId],
  );

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const saveNow = useCallback(() => {
    if (latestPayload.current !== savedPayload.current) {
      void save(latestPayload.current);
    }
  }, [save]);

  useEffect(() => {
    if (payload === savedPayload.current) {
      return;
    }

    const timer = setTimeout(() => void save(payload), AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [payload, save]);

  return useMemo(
    () => ({
      saveNow,
      isClean: () =>
        !isSaving.current && !hasConflict.current && latestPayload.current === savedPayload.current,
      getVersion: () => version.current,
      adopt: (nextPayload: string, nextVersion: number) => {
        savedPayload.current = nextPayload;
        version.current = nextVersion;
      },
      whilePaused: async (run: () => Promise<void>) => {
        isPaused.current = true;

        try {
          await run();
        } finally {
          isPaused.current = false;
          saveNow();
        }
      },
    }),
    [saveNow],
  );
}
```

- [ ] **Step 4: Loader, surface and agent presence**

`hooks/use-stored-canvas.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

import { fetchCanvas, type RemoteCanvas } from "@/lib/canvas-client";

export type StoredCanvasState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; canvas: RemoteCanvas };

/**
 * Loads the stored canvas before the editor mounts, so the canvas never renders
 * empty and then fills in. The caller keys this by diagram ID, so a new
 * diagram always starts from `loading`.
 */
export function useStoredCanvas(diagramId: string): StoredCanvasState {
  const [state, setState] = useState<StoredCanvasState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    fetchCanvas(diagramId, undefined, controller.signal)
      .then((canvas) => {
        setState(canvas ? { status: "ready", canvas } : { status: "error" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        console.error("Canvas load failed", error);
        setState({ status: "error" });
      });

    return () => controller.abort();
  }, [diagramId]);

  return state;
}
```

`components/canvas/canvas-surface.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";

import { Canvas } from "@/components/canvas/canvas";
import { useStoredCanvas } from "@/hooks/use-stored-canvas";

interface CanvasSurfaceProps {
  diagramId: string;
  /** Owned by the editor shell, since the navbar is what opens the picker. */
  isTemplatesOpen: boolean;
  onTemplatesOpenChange: (open: boolean) => void;
  /** Mounted only once the stored canvas has loaded. */
  children?: ReactNode;
}

/** The canvas, with its loading and failure states around it. */
export function CanvasSurface({
  diagramId,
  isTemplatesOpen,
  onTemplatesOpenChange,
  children,
}: CanvasSurfaceProps) {
  const stored = useStoredCanvas(diagramId);

  if (stored.status === "loading") {
    return <CanvasStatus>Connecting to the canvas…</CanvasStatus>;
  }

  if (stored.status === "error") {
    // An editor that failed to load must not open empty: its first autosave
    // would overwrite the diagram it could not read.
    return <CanvasStatus>Could not load the canvas. Try reloading the page.</CanvasStatus>;
  }

  return (
    <>
      <Canvas
        diagramId={diagramId}
        initial={stored.canvas}
        isTemplatesOpen={isTemplatesOpen}
        onTemplatesOpenChange={onTemplatesOpenChange}
      />
      {children}
    </>
  );
}

function CanvasStatus({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-copy-muted"
    >
      {children}
    </div>
  );
}
```

`components/canvas/agent-presence.tsx`:

```tsx
"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { XYPosition } from "@xyflow/react";

/** The agent's cursor while a replay draws on this tab's canvas. */
export interface AgentPresence {
  cursor: XYPosition | null;
}

interface AgentPresenceValue {
  presence: AgentPresence | null;
  setPresence: (presence: AgentPresence | null) => void;
}

const AgentPresenceContext = createContext<AgentPresenceValue | null>(null);

/**
 * Spans the navbar and the canvas, like the room provider it replaces: the
 * avatar sits in one and the cursor in the other.
 */
export function AgentPresenceProvider({ children }: { children: ReactNode }) {
  const [presence, setPresence] = useState<AgentPresence | null>(null);
  const value = useMemo(() => ({ presence, setPresence }), [presence]);

  return <AgentPresenceContext value={value}>{children}</AgentPresenceContext>;
}

/** `null` whenever the agent is not drawing. Safe outside a provider. */
export function useAgentPresence(): AgentPresence | null {
  return useContext(AgentPresenceContext)?.presence ?? null;
}

export function useSetAgentPresence(): (presence: AgentPresence | null) => void {
  const value = useContext(AgentPresenceContext);

  if (!value) {
    throw new Error("useSetAgentPresence must be used inside an AgentPresenceProvider");
  }

  return value.setPresence;
}
```

In `types/tasks.ts`, add below `AI_USER_NAME`:

```ts
/** `--accent-ai`, as a raw hex because inline styles need a value, not a token. */
export const AI_USER_COLOR = "#6457f9";
```

Change the `AI_USER_ID` doc comment to "The agent's identity on the canvas. Deliberately not a Clerk ID, so it can never match a user." Change the `AI_CURSOR_ARRIVAL_PAD_MS` comment's last sentence to "This absorbs React batching the cursor move and the node landing, so it is a floor rather than a delay to minimise." Change `getBuildStepMs`'s floor comment to "Floored at `MIN_BUILD_STEP_MS` so each action stays visible as its own step."

- [ ] **Step 5: The cursor layer and the avatar read the agent presence**

In `components/canvas/live-cursors.tsx`, keep the header comment's three-layer explanation, drop the "Never renders the current user" paragraph, and replace the component with:

```tsx
export function LiveCursors() {
  const agent = useAgentPresence();
  const { x, y, zoom } = useViewport();
  const prefersReducedMotion = useReducedMotion();
  const cursor = agent?.cursor;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${x}px, ${y}px) scale(${zoom})`, transformOrigin: "0 0" }}
      >
        {cursor ? (
          <div
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${cursor.x}px, ${cursor.y}px)`,
              transformOrigin: "0 0",
              transition: prefersReducedMotion
                ? undefined
                : `transform ${AI_CURSOR_SWEEP_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`,
            }}
          >
            <div
              className="absolute left-0 top-0"
              style={{ transform: `scale(${1 / zoom})`, transformOrigin: "0 0" }}
            >
              <svg
                width="16"
                height="19"
                viewBox="0 0 16 19"
                fill={AI_USER_COLOR}
                aria-hidden
                className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
              >
                <path d="M0.5 0.5 L0.5 15.2 L4.3 11.6 L6.9 17.4 L9.5 16.2 L6.9 10.6 L12 10.6 Z" />
              </svg>
              <span
                className="absolute left-3 top-4 flex items-center gap-1 whitespace-nowrap rounded-xl px-2 py-0.5 text-[11px] font-medium text-white"
                style={{ backgroundColor: AI_USER_COLOR }}
              >
                {AI_USER_NAME}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
```

Imports: `useAgentPresence` from `@/components/canvas/agent-presence`, `AI_CURSOR_SWEEP_MS, AI_USER_COLOR, AI_USER_NAME` from `@/types/tasks`. Drop `useCollaborators`.

In `components/canvas/presence-avatars.tsx`, replace the component (and drop `next/image`, `useMemo`, `useCollaborators`, `dedupeByUser`) with:

```tsx
/**
 * The agent's avatar while it draws, beside the Clerk `UserButton`. With no
 * agent drawing it renders nothing and the navbar is unchanged.
 */
export function PresenceAvatars() {
  const agent = useAgentPresence();

  if (!agent) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <ul aria-label="1 other person in this canvas" className="flex items-center -space-x-2">
        <li>
          <span
            title={AI_USER_NAME}
            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-elevated text-[10px] font-medium text-copy-primary ring-2 ring-page"
            style={{ outline: `2px solid ${AI_USER_COLOR}`, outlineOffset: "-2px" }}
          >
            <span aria-hidden>{getInitials(AI_USER_NAME)}</span>
            <span className="sr-only">{AI_USER_NAME}</span>
          </span>
        </li>
      </ul>
      <span aria-hidden className="h-5 w-px bg-surface-border" />
    </div>
  );
}
```

```bash
git rm hooks/use-collaborators.ts
```

- [ ] **Step 6: Save context carries `syncNow`, and the button learns `conflict`**

In `components/canvas/canvas-save-context.tsx`, add to `CanvasSaveValue`:

```ts
  /** The canvas hands up its sync; the launch importer calls it. */
  registerSyncNow: (syncNow: (() => void) | null) => void;
  syncNow: () => void;
```

and implement them exactly like `registerSaveNow`/`saveNow` (a `syncNowRef`, a stable `registerSyncNow`, a stable `syncNow`), adding both to the memoised value. Then add a hook that is safe outside the provider, because `scripts/verify-agent-launch-editor.tsx` renders the import controller without one:

```ts
/** `syncNow`, or a no-op outside a `CanvasSaveProvider`. */
export function useCanvasSyncNow(): () => void {
  return useContext(CanvasSaveContext)?.syncNow ?? NOOP;
}

const NOOP = () => undefined;
```

In `components/editor/save-status-button.tsx`, add to `DISPLAY`:

```ts
  // Someone else wrote first (see useCanvasAutosave). Saving over them would
  // discard their work, so the only way forward is a reload.
  conflict: { Icon: AlertCircle, label: "Changed elsewhere, reload", tone: "text-state-error" },
```

and change the button's `onClick` to `onClick={status === "conflict" ? () => window.location.reload() : saveNow}`.

- [ ] **Step 7: Controls take history as a prop**

In `components/canvas/canvas-controls.tsx`, drop the Liveblocks import and replace the component signature and first lines with:

```tsx
interface CanvasControlsProps {
  history: Pick<CanvasHistoryControls, "undo" | "redo" | "canUndo" | "canRedo">;
}

/**
 * The floating zoom and history bar (17-canvas-ergonomics). History is this
 * tab's own stack (`useCanvasHistory`): undo takes back your last change here.
 *
 * The keyboard shortcuts are registered here because this is the one component
 * that already holds all four handlers.
 */
export function CanvasControls({ history }: CanvasControlsProps) {
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const { undo, redo, canUndo, canRedo } = history;
```

Import `type CanvasHistoryControls` from `@/hooks/use-canvas-history`. The JSX is unchanged.

- [ ] **Step 8: Move the canvas onto local state**

In `components/canvas/canvas.tsx`:
- Remove the `@liveblocks/react` and `@liveblocks/react-flow` imports, `type MouseEvent`, `useCanvasRestore`, and `DEFAULT_EDGE_OPTIONS` with its comment.
- Add imports: `addEdge, useEdgesState, useNodesState, type Connection, type EdgeChange, type NodeChange` from `@xyflow/react`; `useMemo` from `react`; `useCanvasHistory` from `@/hooks/use-canvas-history`; `isCanvasHistoryCommit` from `@/lib/canvas-history`; `canonicalCanvasPayload` from `@/lib/canvas-snapshot`; `type RemoteCanvas` from `@/lib/canvas-client`.
- Add below `isConnectionBetweenNodes`:

```ts
/**
 * A new edge with every canvas default written onto it, so the stored edge and
 * the rendered one are the same object with no post-processing step
 * (16-edge-behavior). `data.label` starts empty so the key always exists.
 */
function createCanvasEdge(connection: Connection): CanvasEdge {
  return {
    ...connection,
    id: `edge-${crypto.randomUUID()}`,
    type: CANVAS_EDGE_TYPE,
    data: { label: "" },
    style: CANVAS_EDGE_STYLE,
    markerEnd: CANVAS_EDGE_MARKER,
  } as CanvasEdge;
}
```

- Change `CanvasProps` to:

```ts
interface CanvasProps {
  /** The diagram the canvas is persisted under. */
  diagramId: string;
  /** The stored canvas this editor opened on, loaded by `CanvasSurface`. */
  initial: RemoteCanvas;
  /** Opened from the navbar, but importing writes flow state, which lives here (18-starter-templates). */
  isTemplatesOpen: boolean;
  onTemplatesOpenChange: (open: boolean) => void;
}
```

- Replace the body of `CanvasFlow` from its first line down to and including the `registerSaveNow` effect with:

```tsx
function CanvasFlow({ diagramId, initial, isTemplatesOpen, onTemplatesOpenChange }: CanvasProps) {
  /*
   * Autosave state reaches the navbar through context rather than a callback
   * prop: the indicator lives outside `ReactFlowProvider` and cannot read the
   * flow state that drives it (21-canvas-autosave).
   */
  const { setStatus: setSaveStatus, registerSaveNow } = useCanvasSave();
  const [nodes, setNodes, applyNodeChanges] = useNodesState<CanvasNode>(initial.snapshot.nodes);
  const [edges, setEdges, applyEdgeChanges] = useEdgesState<CanvasEdge>(initial.snapshot.edges);
  const { fitView, screenToFlowPosition } = useReactFlow<CanvasNode, CanvasEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isAwaitingImportedNodes = useRef(false);

  const current = useMemo(() => ({ nodes, edges }), [nodes, edges]);
  const payload = useMemo(() => canonicalCanvasPayload(current), [current]);

  const restore = useCallback(
    (snapshot: CanvasSnapshot) => {
      setNodes(snapshot.nodes);
      setEdges(snapshot.edges);
    },
    [setEdges, setNodes],
  );
  const history = useCanvasHistory(current, restore);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      if (changes.some((change) => isCanvasHistoryCommit(change, nodes))) {
        history.checkpoint();
      }

      applyNodeChanges(changes);
    },
    [applyNodeChanges, history, nodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      if (changes.some((change) => isCanvasHistoryCommit(change, nodes))) {
        history.checkpoint();
      }

      applyEdgeChanges(changes);
    },
    [applyEdgeChanges, history, nodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      history.checkpoint();
      setEdges((existing) => addEdge(createCanvasEdge(connection), existing));
    },
    [history, setEdges],
  );

  const addNode = useCallback(
    ({ shape, width, height }: ShapeDragPayload, center: XYPosition) => {
      history.checkpoint();
      setNodes((existing) => [
        ...existing,
        {
          id: createNodeId(shape),
          type: CANVAS_NODE_TYPE,
          // Centred on the drop point rather than hanging off its corner.
          position: { x: center.x - width / 2, y: center.y - height / 2 },
          width,
          height,
          data: { label: "", color: DEFAULT_NODE_COLOR, shape },
        },
      ]);
    },
    [history, setNodes],
  );

  /**
   * A template replaces the canvas. Nodes and edges are copied so the template
   * constants are never aliased into flow state.
   */
  const handleImportTemplate = useCallback(
    (template: CanvasTemplate) => {
      history.checkpoint();
      setNodes(template.nodes.map((node) => ({ ...node, data: { ...node.data } })));
      setEdges(
        template.edges.map((edge) => ({
          ...edge,
          data: { ...edge.data, label: edge.data?.label ?? "" },
        })),
      );
      isAwaitingImportedNodes.current = true;
    },
    [history, setEdges, setNodes],
  );

  /** `fitView` must wait for the imported nodes to render, or it measures the old canvas. */
  useEffect(() => {
    if (!isAwaitingImportedNodes.current || nodes.length === 0) {
      return;
    }

    isAwaitingImportedNodes.current = false;
    void fitView({ duration: VIEWPORT_TRANSITION_MS });
  }, [fitView, nodes]);

  const autosave = useCanvasAutosave(diagramId, payload, initial.version, setSaveStatus);

  useEffect(() => {
    registerSaveNow(autosave.saveNow);

    // The handle must not outlive the canvas, or a Save click on the editor
    // home would call into an unmounted canvas.
    return () => registerSaveNow(null);
  }, [autosave.saveNow, registerSaveNow]);
```

- In the JSX, delete `defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}`, `onDelete={onDelete}`, `onMouseMove={handleMouseMove}`, `onMouseLeave={handleMouseLeave}` and the comment above the mouse handlers. `onNodesChange`, `onEdgesChange` and `onConnect` now name the wrappers above. Change `<CanvasControls />` to `<CanvasControls history={history} />`.
- Update the `Canvas` doc comment from "The collaborative canvas surface" to "The canvas surface", and the wrapper div comment to "`relative` anchors the agent cursor overlay to the canvas."

`handleDragOver`, `handleDrop` and `handleAddShape` are unchanged.

- [ ] **Step 9: Replace the room in the shell**

```bash
git rm components/canvas/canvas-room.tsx hooks/use-canvas-restore.ts
```

In `components/editor/editor-shell.tsx`:
- Replace the `canvas-room` import with `import { CanvasSurface } from "@/components/canvas/canvas-surface"` and add `import { AgentPresenceProvider } from "@/components/canvas/agent-presence"`.
- Replace `<CanvasRoom roomId={activeDiagram?.id}>` and its closing tag with `<AgentPresenceProvider>` / `</AgentPresenceProvider>`, and drop the "never joins a room" comment.
- Add `key={activeDiagram.id}` to `<CanvasSurface …>`, so moving between diagrams remounts the loader and the flow state.
- Change the presence comment to "Only the workspace shows the agent avatar; the home page has no canvas for it to draw on."

In `components/canvas/canvas-motion-context.tsx`, change the `SETTLE_MS` comment to: "How long after mount the canvas stops treating new elements as part of the initial load. The canvas mounts with its stored nodes already in hand (`CanvasSurface`), so this only has to cover React Flow's first render."

- [ ] **Step 10: Run the automated checks**

Run: `npm run typecheck && npm run lint && npm run verify:unit`
Expected: PASS. `git grep -n "@liveblocks" -- app components hooks lib` prints only `app/api/liveblocks-auth/route.ts` and `lib/liveblocks.ts`, both deleted in Task 10.

- [ ] **Step 11: Check the editor in a browser**

Start the app with the `truss-dev-server` skill (it checks for a running instance first) and drive it with `agent-browser`. On a diagram you own:
- The canvas shows `Connecting to the canvas…` briefly, then the saved diagram with no arrival animations.
- Opening and waiting 5 seconds leaves the save button on `Save` (no write on open).
- Drag a node: the button goes `Saving…` then `Saved`. Undo moves it back in one step; redo moves it forward. Cmd+Z and Shift+Cmd+Z do the same.
- Type a label: one undo removes the whole word.
- Connect two nodes: the edge is right-angled, has an arrowhead, and survives a reload.
- Import a template: the view fits it; undo brings back the previous canvas.
- Delete a node with Backspace: its edges go too; undo restores both.
- Open a second tab on the same diagram, edit and save there, then edit in the first tab: the first tab's button shows `Changed elsewhere, reload`, and clicking it reloads onto the second tab's version. (Review Focus 1.)
- Switch to another diagram from the sidebar: the canvas reloads with that diagram, and undo is disabled.
Take screenshots of the canvas and the navbar at 1440px and 375px.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: run the canvas on local React Flow state"
```

## Task 9: Idle sync and the agent replay

**Files:**
- Create: `lib/canvas-replay.ts`, `hooks/use-canvas-remote-sync.ts`, `scripts/verify-canvas-replay.ts`
- Modify: `lib/canvas-drawing.ts`, `components/canvas/canvas.tsx`, `hooks/use-agent-launch-import.ts`, `components/editor/agent-launch-import-status.tsx`, `scripts/verify-canvas-drawing.ts`, `package.json`

**Interfaces:**
- Consumes: `RemoteCanvas`, `fetchCanvas`, `CanvasAutosave`, `useSetAgentPresence`, `useCanvasSyncNow`, `registerSyncNow` (Task 8); `CanvasHistoryControls.reset` (Task 7); `getBuildStepMs`, `AI_CURSOR_*` (`types/tasks.ts`).
- Produces:
  - `CanvasDrawingDependencies = { moveCursor(cursor: XYPosition): void; clearCursor(): void; sleep(ms: number): Promise<void> }` and `drawPacedCanvasActions<Target>(target: Target, actions: readonly PacedCanvasAction<Target>[], dependencies): Promise<number>`
  - `CanvasReplayPlan = { base: CanvasSnapshot; addedNodes: CanvasNode[]; addedEdges: CanvasEdge[] }`, `planCanvasReplay(current, remote): CanvasReplayPlan`, `CanvasAddTarget = { addNodes(nodes): void; addEdges(edges): void }`, `drawNodesThenEdges(plan, target, dependencies): Promise<void>`
  - `useCanvasRemoteSync(diagramId: string, autosave: CanvasAutosave, onRemoteCanvas: (canvas: RemoteCanvas) => Promise<void>): { syncNow(): void }`
  - `UseAgentLaunchImportInput.onImported?: () => void`

- [ ] **Step 1: Write the failing replay verifier**

`scripts/verify-canvas-replay.ts`:

```ts
import assert from "node:assert/strict";

import { drawNodesThenEdges, planCanvasReplay, type CanvasAddTarget } from "../lib/canvas-replay";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { AI_CURSOR_ARRIVAL_PAD_MS, AI_CURSOR_SWEEP_MS, getBuildStepMs } from "../types/tasks";
import { CANVAS_EDGE_TYPE, CANVAS_NODE_TYPE, type CanvasEdge, type CanvasNode } from "../types/canvas";

function node(id: string, x = 0, label = id): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y: 0 },
    data: { label, color: "neutral", shape: "rectangle" },
  } as CanvasNode;
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, type: CANVAS_EDGE_TYPE, source, target, data: { label: "" } } as CanvasEdge;
}

function checkPlanSplitsAdditionsFromTheRest() {
  const current: CanvasSnapshot = {
    nodes: [node("keep"), node("gone"), node("moved")],
    edges: [edge("keep-to-gone", "keep", "gone")],
  };
  const remote: CanvasSnapshot = {
    nodes: [node("keep", 0, "Renamed"), node("moved", 400), node("new", 280)],
    edges: [edge("keep-to-new", "keep", "new")],
  };

  const plan = planCanvasReplay(current, remote);

  assert.deepEqual(plan.base.nodes.map((n) => [n.id, n.data.label, n.position.x]), [
    ["keep", "Renamed", 0],
    ["moved", "moved", 400],
  ], "updates and removals land at once, in the remote's form");
  assert.deepEqual(plan.base.edges, [], "an edge to a removed node goes with it");
  assert.deepEqual(plan.addedNodes.map((n) => n.id), ["new"]);
  assert.deepEqual(plan.addedEdges.map((e) => e.id), ["keep-to-new"]);
}

function checkAnExistingEdgeRetargetedToANewNodeWaitsForIt() {
  const plan = planCanvasReplay(
    { nodes: [node("a"), node("b")], edges: [edge("e", "a", "b")] },
    { nodes: [node("a"), node("b"), node("c")], edges: [edge("e", "a", "c")] },
  );

  assert.deepEqual(plan.base.edges, []);
  assert.deepEqual(plan.addedEdges.map((e) => e.id), ["e"], "it is redrawn once its target exists");
}

async function checkNodesThenEdgesWithTheCursorFirst() {
  const plan = planCanvasReplay(
    { nodes: [node("client")], edges: [] },
    { nodes: [node("client"), node("orders", 280)], edges: [edge("client-to-orders", "client", "orders")] },
  );
  const events: string[] = [];
  const target: CanvasAddTarget = {
    addNodes: (nodes) => events.push(...nodes.map((n) => `node:${n.id}`)),
    addEdges: (edges) => events.push(...edges.map((e) => `edge:${e.id}`)),
  };

  await drawNodesThenEdges(plan, target, {
    moveCursor: (cursor) => events.push(`cursor:${cursor.x},${cursor.y}`),
    clearCursor: () => events.push("clear"),
    sleep: async (ms) => {
      events.push(`delay:${ms}`);
    },
  });

  const arrive = `delay:${AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS}`;
  const step = `delay:${getBuildStepMs(2)}`;
  assert.deepEqual(events, [
    "cursor:280,0", arrive, "node:orders", step,
    "cursor:280,0", arrive, "edge:client-to-orders", step,
    "clear",
  ], "the cursor reaches each item before it lands, and leaves at the end");
}

async function checkTheCursorClearsWhenAStepThrows() {
  const plan = planCanvasReplay({ nodes: [], edges: [] }, { nodes: [node("a")], edges: [] });
  let cleared = false;

  await assert.rejects(
    drawNodesThenEdges(
      plan,
      { addNodes: () => { throw new Error("unmounted"); }, addEdges: () => undefined },
      { moveCursor: () => undefined, clearCursor: () => { cleared = true; }, sleep: async () => undefined },
    ),
  );
  assert.equal(cleared, true);
}

void (async () => {
  checkPlanSplitsAdditionsFromTheRest();
  checkAnExistingEdgeRetargetedToANewNodeWaitsForIt();
  await checkNodesThenEdgesWithTheCursorFirst();
  await checkTheCursorClearsWhenAStepThrows();
  console.log("✅ canvas replay verified");
})();
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx scripts/verify-canvas-replay.ts`
Expected: FAIL, `lib/canvas-replay.ts` does not exist.

- [ ] **Step 3: Make the pacing loop local**

Replace the dependencies and loop in `lib/canvas-drawing.ts`:

```ts
import type { XYPosition } from "@xyflow/react";

import { AI_CURSOR_ARRIVAL_PAD_MS, AI_CURSOR_SWEEP_MS, getBuildStepMs } from "@/types/tasks";

export interface PacedCanvasAction<Target> {
  target: () => XYPosition | null;
  apply: (target: Target) => void;
}

export interface CanvasDrawingDependencies {
  moveCursor: (cursor: XYPosition) => void;
  clearCursor: () => void;
  sleep: (milliseconds: number) => Promise<void>;
}

/**
 * Applies actions at a watchable pace, with the agent cursor arriving before
 * each one lands (32-live-canvas-building). Runs in the browser now: the
 * server writes an agent's change at once, and the open editor replays it.
 */
export async function drawPacedCanvasActions<Target>(
  target: Target,
  actions: readonly PacedCanvasAction<Target>[],
  dependencies: CanvasDrawingDependencies,
): Promise<number> {
  const stepMs = getBuildStepMs(actions.length);
  let applied = 0;

  try {
    for (const action of actions) {
      const cursor = action.target();

      if (cursor) {
        dependencies.moveCursor(cursor);
        await dependencies.sleep(AI_CURSOR_SWEEP_MS + AI_CURSOR_ARRIVAL_PAD_MS);
      }

      action.apply(target);
      applied += 1;
      await dependencies.sleep(stepMs);
    }
  } finally {
    dependencies.clearCursor();
  }

  return applied;
}
```

In `scripts/verify-canvas-drawing.ts`, change the call to `drawPacedCanvasActions(flow, actions, { moveCursor: (cursor) => events.push(\`cursor:${cursor.x},${cursor.y}\`), clearCursor: () => events.push("clear"), sleep: async (ms) => { events.push(\`delay:${ms}\`); } })`. The expected event list is unchanged.

- [ ] **Step 4: Write the replay module**

`lib/canvas-replay.ts`:

```ts
import type { XYPosition } from "@xyflow/react";

import {
  drawPacedCanvasActions,
  type CanvasDrawingDependencies,
  type PacedCanvasAction,
} from "@/lib/canvas-drawing";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * How an open editor shows an agent write it picked up by polling: removals
 * and updates at once, then additions one at a time behind the agent cursor.
 * The same order the server's paced draw used when Liveblocks carried it.
 */
export interface CanvasReplayPlan {
  /** The remote canvas minus everything the replay will add. */
  base: CanvasSnapshot;
  addedNodes: CanvasNode[];
  addedEdges: CanvasEdge[];
}

export interface CanvasAddTarget {
  addNodes: (nodes: CanvasNode[]) => void;
  addEdges: (edges: CanvasEdge[]) => void;
}

export function planCanvasReplay(current: CanvasSnapshot, remote: CanvasSnapshot): CanvasReplayPlan {
  const currentNodeIds = new Set(current.nodes.map((node) => node.id));
  const currentEdgeIds = new Set(current.edges.map((edge) => edge.id));
  const addedNodes = remote.nodes.filter((node) => !currentNodeIds.has(node.id));
  const addedNodeIds = new Set(addedNodes.map((node) => node.id));
  // An edge touching a node that has not landed yet would render as nothing,
  // so it waits and is drawn after its endpoints.
  const waitsForANode = (edge: CanvasEdge) =>
    addedNodeIds.has(edge.source) || addedNodeIds.has(edge.target);

  return {
    base: {
      nodes: remote.nodes.filter((node) => currentNodeIds.has(node.id)),
      edges: remote.edges.filter((edge) => currentEdgeIds.has(edge.id) && !waitsForANode(edge)),
    },
    addedNodes,
    addedEdges: remote.edges.filter((edge) => !currentEdgeIds.has(edge.id) || waitsForANode(edge)),
  };
}

/** Nodes first, then edges, each paced so the cursor arrives before the item does. */
export async function drawNodesThenEdges(
  plan: CanvasReplayPlan,
  target: CanvasAddTarget,
  dependencies: CanvasDrawingDependencies,
): Promise<void> {
  const positions = new Map<string, XYPosition>(
    [...plan.base.nodes, ...plan.addedNodes].map((node) => [node.id, node.position]),
  );
  const actions: PacedCanvasAction<CanvasAddTarget>[] = [
    ...plan.addedNodes.map((node) => ({
      target: () => node.position,
      apply: (flow: CanvasAddTarget) => flow.addNodes([node]),
    })),
    ...plan.addedEdges.map((edge) => ({
      target: () => positions.get(edge.target) ?? null,
      apply: (flow: CanvasAddTarget) => flow.addEdges([edge]),
    })),
  ];

  await drawPacedCanvasActions(target, actions, dependencies);
}
```

- [ ] **Step 5: Write the sync hook**

`hooks/use-canvas-remote-sync.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef } from "react";

import type { CanvasAutosave } from "@/hooks/use-canvas-autosave";
import { fetchCanvas, type RemoteCanvas } from "@/lib/canvas-client";

/**
 * How often an idle editor asks whether the canvas moved.
 *
 * ponytail: polling costs one small function call per open, visible tab every
 * interval. A server-sent event stream is the upgrade if open tabs ever make
 * that cost show up.
 */
const CANVAS_POLL_MS = 4_000;

/**
 * Keeps an idle editor current with writes made elsewhere: the terminal agent
 * through `agent-graph-edit`, or the owner's other tab. A tab with unsaved
 * edits does not poll, so nothing overwrites work in progress.
 */
export function useCanvasRemoteSync(
  diagramId: string,
  autosave: CanvasAutosave,
  onRemoteCanvas: (canvas: RemoteCanvas) => Promise<void>,
): { syncNow: () => void } {
  const isSyncing = useRef(false);
  const apply = useRef(onRemoteCanvas);

  useEffect(() => {
    apply.current = onRemoteCanvas;
  }, [onRemoteCanvas]);

  const syncNow = useCallback(() => {
    if (isSyncing.current || !autosave.isClean()) {
      return;
    }

    isSyncing.current = true;

    void fetchCanvas(diagramId, autosave.getVersion())
      .then(async (remote) => {
        // Re-checked: the owner may have started editing while this was in flight.
        if (remote && autosave.isClean()) {
          await apply.current(remote);
        }
      })
      .catch((error: unknown) => {
        console.error("Canvas sync failed", error);
      })
      .finally(() => {
        isSyncing.current = false;
      });
  }, [autosave, diagramId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        syncNow();
      }
    }, CANVAS_POLL_MS);

    return () => window.clearInterval(timer);
  }, [syncNow]);

  return { syncNow };
}
```

- [ ] **Step 6: Apply remote canvases in the editor**

In `components/canvas/canvas.tsx`, pull `registerSyncNow` out of `useCanvasSave()` alongside `registerSaveNow`, and add after the `registerSaveNow` effect:

```tsx
  const setAgentPresence = useSetAgentPresence();

  // Read from an async callback that outlives the render that created it.
  const latest = useRef(current);

  useEffect(() => {
    latest.current = current;
  }, [current]);

  const applyRemoteCanvas = useCallback(
    async (remote: RemoteCanvas) => {
      autosave.adopt(canonicalCanvasPayload(remote.snapshot), remote.version);
      // Undo must never reach back across a change this tab did not make.
      history.reset();

      if (!remote.isAgentWrite) {
        restore(remote.snapshot);
        return;
      }

      const plan = planCanvasReplay(latest.current, remote.snapshot);

      restore(plan.base);
      await autosave.whilePaused(() =>
        drawNodesThenEdges(
          plan,
          {
            addNodes: (added) => setNodes((existing) => [...existing, ...added]),
            addEdges: (added) => setEdges((existing) => [...existing, ...added]),
          },
          {
            moveCursor: (cursor) => setAgentPresence({ cursor }),
            clearCursor: () => setAgentPresence(null),
            sleep: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
          },
        ),
      );
    },
    [autosave, history, restore, setAgentPresence, setEdges, setNodes],
  );

  const { syncNow } = useCanvasRemoteSync(diagramId, autosave, applyRemoteCanvas);

  useEffect(() => {
    registerSyncNow(syncNow);

    return () => registerSyncNow(null);
  }, [registerSyncNow, syncNow]);
```

Imports: `useSetAgentPresence` from `@/components/canvas/agent-presence`, `useCanvasRemoteSync` from `@/hooks/use-canvas-remote-sync`, `drawNodesThenEdges, planCanvasReplay` from `@/lib/canvas-replay`.

- [ ] **Step 7: The launch import asks for a sync when it lands**

In `hooks/use-agent-launch-import.ts`, add `onImported?: () => void;` to `UseAgentLaunchImportInput`, destructure it, and change `settle` to:

```ts
  const settle = useCallback(
    (result: AgentLaunchImportResult) => {
      setIsImporting(false);
      setError(result.status === "failed" ? result.message : null);

      if (result.status === "imported") {
        // The server wrote the graph at once; the editor replays it now
        // instead of waiting for the next idle poll.
        onImported?.();
      }
    },
    [onImported],
  );
```

In `components/editor/agent-launch-import-status.tsx`, call `const syncNow = useCanvasSyncNow();` and pass `onImported: syncNow` to `useAgentLaunchImport`.

- [ ] **Step 8: Register and run**

Add `tsx scripts/verify-canvas-replay.ts && ` to `verify:unit` after the Task 7 entry.

Run: `npm run typecheck && npm run lint && npm run verify:unit`
Expected: PASS, including `verify-agent-launch-editor.tsx` (the controller renders without a provider thanks to `useCanvasSyncNow`).

- [ ] **Step 9: Check the agent draw in a browser**

With the dev server running and the editor open on a diagram you own, idle:
- Mint an agent token and call `truss_edit_diagram` through the `truss-diagram` MCP server (or `curl` `GET …/agent-graph` then `POST …/agent-graph-edit` with its fingerprint) adding three nodes and two edges.
- Within about 4 seconds the `AI Architect` avatar appears in the navbar, the purple cursor sweeps to each new node before it appears, edges follow, and both disappear at the end. New nodes play their arrival animation.
- Undo is disabled right after the replay. (Review Focus 5.)
- The save button does not move off its current state during or after the replay, and a reload shows the same canvas.
- Run the `?launch=` flow from `/agent/launch`: `Importing diagram…` shows, then the graph draws in with the cursor.
- With unsaved local edits pending (drag, then call the edit route within 1.5 seconds), the tab does not replay; its save shows `Changed elsewhere, reload`. (Review Focus 1.)

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: replay agent writes on an idle canvas"
```

---

## Phase 3: Delete the dependency

## Task 10: Remove Liveblocks

**Files:**
- Delete: `app/api/liveblocks-auth/route.ts`, `lib/liveblocks.ts`, `liveblocks.config.ts`, `scripts/verify-liveblocks.ts`
- Modify: `package.json`, `package-lock.json`, `lib/diagram-lifecycle.ts`, `app/api/diagrams/[diagramId]/route.ts`, `scripts/verify-diagram-data.ts`, `scripts/verify-diagram-api.ts`, `scripts/verify-env-keys.ts`, `lib/env-keys.ts`, `next.config.ts`, `README.md`, `.github/workflows/quality.yml`, `skills-lock.json`, `.agents/skills/truss-diagram/scripts/core.mjs`

**Interfaces:**
- Consumes: nothing reads Liveblocks after Task 9.
- Produces: `deleteDiagramResources(diagramId: string, ownerId: string): Promise<void>` with no room argument. `cleanupTombstonedRoom` no longer exists.

- [ ] **Step 1: Rewrite the deletion checks**

In `scripts/verify-diagram-data.ts`:
- Import only `deleteDiagramResources` from `../lib/diagram-lifecycle`.
- Delete `checkActiveRoomIsPreserved` and `checkAuthFenceCleansTombstone`.
- `checkMissingDiagramPreservesRoom` becomes `checkMissingDiagramFails`: call `deleteDiagramResources("verify-does-not-exist", OWNER_ID)` and keep the `P2025` rejection assertion.
- Replace `checkCleanupFailureLeavesTombstone` and `checkDeletionRetryFinalizesTombstone` with:

```ts
async function checkDeletionTombstonesTheRow() {
  await deleteDiagramResources(CLEANUP_DIAGRAM_ID, OWNER_ID);

  const tombstone = await prisma.diagram.findUnique({
    where: { id: CLEANUP_DIAGRAM_ID },
    select: { ownerId: true, name: true, storyboardId: true, canvasJsonPath: true, deletingAt: true, deletedAt: true },
  });

  assert.ok(tombstone, "the tombstone row is permanent");
  assert.equal(tombstone.ownerId, OWNER_ID);
  assert.equal(tombstone.name, "Deleted diagram", "the name is scrubbed");
  assert.equal(tombstone.storyboardId, null, "a deleted diagram leaves its board");
  assert.equal(
    tombstone.canvasJsonPath,
    "https://blob.example/verify-room-cleanup-failure.json",
    "the artifact pointer is kept until blob deletion exists",
  );
  assert.notEqual(tombstone.deletingAt, null);
  assert.notEqual(tombstone.deletedAt, null, "with no external room there is nothing left to finish");
}

async function checkDeletionRetryIsHarmless() {
  await deleteDiagramResources(CLEANUP_DIAGRAM_ID, OWNER_ID);
  assert.ok(await prisma.diagram.findUnique({ where: { id: CLEANUP_DIAGRAM_ID } }));
}
```

- `checkDiagramResourceDeletion` runs `checkMissingDiagramFails`, `seedCleanupFailureDiagram`, `checkDeletionTombstonesTheRow`, `checkTombstoneIsHiddenAndReserved`, `checkDeletionRetryIsHarmless`, in that order.

In `scripts/verify-diagram-api.ts`, find the stub around the old line 311 that throws `"liveblocks unavailable"` and change the message to `"blob unavailable"`.

- [ ] **Step 2: Run to see it fail**

Run: `npx tsx scripts/verify-diagram-data.ts`
Expected: FAIL. `deleteDiagramResources` still requires a room lifecycle and leaves `deletedAt` null when the room call is absent.

- [ ] **Step 3: Simplify deletion**

In `lib/diagram-lifecycle.ts`, delete `RoomLifecycle`, `TOMBSTONED` (if only `cleanupTombstonedRoom` used it) and `cleanupTombstonedRoom`, and replace `deleteDiagramResources` with:

```ts
/**
 * Tombstones a diagram. The row stays forever so its ID is never reused, and
 * it leaves its storyboard so no board renders a panel for it.
 *
 * Both stamps are written together: the two-step `deletingAt` then
 * `deletedAt` existed to retry deleting an external room, and there is no
 * external room any more (ADR 0005).
 */
export async function deleteDiagramResources(diagramId: string, ownerId: string): Promise<void> {
  const now = new Date();

  // The owner predicate closes the gap between route authorization and this
  // mutation.
  await prisma.diagram.update({
    where: { id: diagramId, ownerId },
    data: { deletingAt: now, deletedAt: now, name: "Deleted diagram", storyboardId: null },
  });
}
```

In `app/api/diagrams/[diagramId]/route.ts`, drop the `getLiveblocks` import and call `await deleteDiagramResources(diagramId, access.userId);`.

- [ ] **Step 4: Delete the Liveblocks surface and packages**

```bash
git rm app/api/liveblocks-auth/route.ts lib/liveblocks.ts liveblocks.config.ts scripts/verify-liveblocks.ts
npm uninstall @liveblocks/client @liveblocks/node @liveblocks/react @liveblocks/react-flow @liveblocks/react-ui
```

- `package.json`: remove `tsx scripts/verify-liveblocks.ts && ` from `verify:integration`.
- `scripts/verify-env-keys.ts`: replace the `LIVEBLOCKS_SECRET_KEY` pair with `CLERK_SECRET_KEY: "sk_dev_1"` / `CLERK_SECRET_KEY_PROD: "sk_prod_1"` in `values`, rename the two assertions to match, and change the header comment's example to "production quietly served with development Clerk keys".
- `lib/env-keys.ts`: change "`LIVEBLOCKS_SECRET_KEY` and friends" to "`CLERK_SECRET_KEY` and friends".
- `next.config.ts`: delete the whole `images` block. Nothing renders a Clerk avatar through `next/image` any more; `UserButton` draws its own.
- `skills-lock.json`: delete the `liveblocks-best-practices` entry and any other entry whose `source` is `liveblocks/skills`.
- `.github/workflows/quality.yml`: change the comment "live database/Liveblocks checks" to "live database checks".
- `.agents/skills/truss-diagram/scripts/core.mjs` near line 374: drop "and the Liveblocks room ID" from the comment.
- `README.md`: remove the Liveblocks env section and the `LIVEBLOCKS_SECRET_KEY` lines, change the stack table row to `| Canvas | React Flow (`@xyflow/react`) + Vercel Blob |`, and rewrite the feature bullets that mention collaborators, invites, live cursors or Liveblocks Storage.

- [ ] **Step 5: Sweep**

Run: `git grep -n -i "liveblocks" -- ':!docs' ':!context/feature-specs' ':!context/progress-tracker.md' ':!prisma/migrations' ':!package-lock.json'`
Expected: only comments that Task 11 rewrites (`canvas-node.tsx`, `canvas-edge.tsx`, `node-color-toolbar.tsx`, `lib/agent-graph.ts`, `lib/room-id.ts`, `lib/diagram-id.ts`, `lib/api-requests.ts`, `hooks/use-diagram-actions.ts`, `app/api/diagrams/route.ts`, `prisma/models/*.prisma`, `lib/canvas-drag.ts`, `scripts/verify-canvas.ts`, `scripts/verify-agent-graph-import.ts`). Fix each comment now: say "diagram ID" where it said "room ID", and "flow state" or "the stored snapshot" where it said "Liveblocks Storage".

Run: `npm run typecheck && npm run lint && npm run verify:unit && npm run build`
Expected: PASS, and `npm run build` lists no `/api/liveblocks-auth` route.

Run: `npm run verify:integration` against a development database.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove Liveblocks"
```

- [ ] **Step 7: Hand the environment cleanup to the owner**

Removing `LIVEBLOCKS_SECRET_KEY` (and `LIVEBLOCKS_SECRET_KEY_PROD`) from Vercel and from `.env` changes shared configuration, so ask the owner before doing it. The commands, once approved:

```bash
vercel env rm LIVEBLOCKS_SECRET_KEY production
vercel env rm LIVEBLOCKS_SECRET_KEY preview
vercel env rm LIVEBLOCKS_SECRET_KEY development
```

Deleting the Liveblocks project itself is the owner's call and happens in the Liveblocks dashboard.

## Task 11: Documentation

**Files:**
- Create: `docs/adr/0005-owner-only-without-liveblocks.md`
- Modify: `CONTEXT.md`, `docs/adr/0003-diagrams-keep-their-own-rooms.md`, `docs/adr/0004-temporary-storyboards-before-sign-in.md`, `context/project-overview.md`, `context/architecture-context.md`, `context/ui-context.md`, `context/code-standards.md`, `context/progress-tracker.md`

**Interfaces:** none.

- [ ] **Step 1: Write the ADR**

`docs/adr/0005-owner-only-without-liveblocks.md`:

```markdown
# Owner-only, without Liveblocks

Truss stored every diagram in a Liveblocks room so collaborators could edit it
together, and invited those collaborators to a storyboard by email. On
2026-09-21 the owner decided human co-editing was not worth what it cost, and on
2026-09-25 extended that to the invitation flow itself. Every storyboard and
diagram now has exactly one user: its owner.

A diagram's canvas is one private Vercel Blob snapshot. `Diagram.canvasVersion`
versions it, and every write is a compare-and-swap on that version: the editor's
autosave and the agent-token routes alike. A stale write gets `409`. An idle
editor polls the version and, when the terminal agent wrote, replays the change
node by node behind the agent cursor.

## Consequences

`StoryboardCollaborator`, the Share dialog, the member routes, the Shared list,
presence avatars for people and live cursors for people are gone. The agent's
cursor and avatar stay; they are driven by the replay, not by a realtime
service.

Undo is this tab's own stack. Two tabs on one diagram do not merge: the one
that saves second is told to reload.

This supersedes ADR 0003. A diagram is still its own record, separate from any
storyboard, but there are no rooms.
```

- [ ] **Step 2: Update the domain glossary**

In `CONTEXT.md`:
- Opening paragraph: "…authors a plan as a board of panels, the owner argues with it in place, and the curated feedback goes back to that agent…"
- **Storyboard**: "A board of panels expressing one plan, owned by one user. It is the top-level object in the app."
- **Temporary storyboard**: "…but has no owner or persisted record." (drop "collaborators").
- **Diagram**: "A system architecture graph stored as one versioned snapshot, rendered on a storyboard as static SVG and opening into a full editor. Valid on its own with no storyboard pointing at it."
- **Thread**: "Started by the owner or the agent, resolved by the owner."
- Delete the **Collaborator** entry. Add "Collaborator" to the _Avoid_ line under **Owner** with a note: "(removed, ADR 0005)".
- **Agent**: "present on the canvas under the owner's name plus a suffix" instead of "present in the room".

At the top of `docs/adr/0003-diagrams-keep-their-own-rooms.md`, add `> Superseded by ADR 0005: there are no rooms.` In `docs/adr/0004-temporary-storyboards-before-sign-in.md`, change "exposes collaboration" to "enables saving" and delete the paragraph about temporary storyboards not inviting collaborators.

- [ ] **Step 3: Update the context files**

- `context/architecture-context.md`: rewrite the canvas row of the stack table, the diagram lifecycle section (single tombstone step), the access rules (owner-only; the storyboard-owner-reads-foreign-diagram rule is gone), the agent-graph read and edit sections (they read and write the stored snapshot under the version check), the undo note that cites Liveblocks `history.undo()`, and the paced-draw section (the server writes at once; the editor replays). Add the idle poll and its 4 second interval.
- `context/project-overview.md` and `context/ui-context.md`: drop sharing, invites, presence and live cursors for people; keep the agent cursor.
- `context/code-standards.md`: drop any Liveblocks rule.
- `context/progress-tracker.md`: add an entry for this work listing the tasks above, the two migrations, the removed packages, and the open questions below.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: record the owner-only, Liveblocks-free canvas"
```

## Task 12: Final verification

- [ ] **Step 1: Full automated pass**

Run: `npm run typecheck && npm run lint && npm run verify:unit && npm run build`
Then, against a development database: `npm run verify:integration`
Expected: all PASS.

- [ ] **Step 2: UI parity pass**

With `agent-browser`, compare against screenshots of `main` taken before Task 1, at 375px and 1440px:
- Editor home: navbar, empty state, `New Diagram` button unchanged.
- Sidebar: `Diagrams` heading, list rows with rename and delete, `New Diagram` button. The My Diagrams/Shared tab strip is gone, and nothing else moved.
- Workspace navbar: diagram name, save button, `Templates`, profile. No Share button.
- Canvas: shape panel, controls bar (zoom out, fit, zoom in, undo, redo), minimap, dotted background.
- An agent draw shows the avatar and the sweeping cursor as before.
- A signed-in user opening someone else's diagram URL sees `AccessDenied`.

- [ ] **Step 3: Review and hand off**

Run a whole-branch review (superpowers:requesting-code-review), fix CRITICAL and HIGH findings, then use superpowers:finishing-a-development-branch.

---

## Open questions

- `components/auth/auth-panel.tsx` advertises "Real-time collaborative canvas", and `app/editor/[roomId]/page.tsx` has the meta description "Collaborative system design workspace." Both are now false. This plan leaves them, because changing them is a copy decision. Say which wording you want.
- The `Storyboard` model stays with no UI and no collaborators. Nothing in this plan needs it; it is kept because ADR 0004 and the storyboard work build on it.
- Deleted diagrams keep their last Blob snapshot, as they did before. Deleting it on tombstone is a small follow-up if storage cost matters.
- The `Importing diagram…` pill now disappears when the import request returns, a moment before the replay starts drawing. Before, it stayed up for the whole server-paced draw. Holding it until the replay finishes is possible if the gap reads badly.
