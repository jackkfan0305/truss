# Caller-Generated Diagram Skill Implementation Plan

> Execute with `superpowers:subagent-driven-development`. Use a fresh GPT-5.6
> Terra implementer and reviewer for each task, TDD-first, sequentially because
> every task consumes the prior task's contract.

**Goal:** Make `render-truss-diagram` generate the final graph in the calling
LLM and import it directly into Truss without a skill-specific chat message,
Trigger run, or second LLM call.

**Design:**
`docs/superpowers/specs/2026-08-12-caller-generated-diagram-skill-design.md`

**Tech:** Next.js 16.2, React 19, TypeScript strict, Zod 4, Clerk 7,
Liveblocks React Flow, Prisma/Postgres, private Vercel Blob, Node ESM launcher,
`npx skills`.

## Global constraints

- Compact graph v1: 1..40 nodes, 0..60 edges; strict whole-document rejection.
- Payload version remains 1 but storage prefix becomes
  `truss.agent-launch.graph.v1:`; old description payloads are rejected.
- Fragment stays base64url and at most 16,384 characters.
- Skill launcher accepts the graph only through `--stdin-json`.
- Import is owner-only, empty-or-exact, retry-safe, and never overwrites a
  divergent room.
- Skill launches do not write chat, start orchestrator/Trigger, open AI sidebar,
  or consume a Truss model key. Manual AI remains unchanged.
- Graph contents never appear in URLs, logs, launcher output, status/error UI,
  or generated verification records.
- Update `context/progress-tracker.md` after each meaningful task.

### Task 1: Define the strict compact graph and launch lifecycle

**Files:**

- Create: `lib/agent-graph.ts`
- Modify: `lib/agent-launch.ts`
- Modify: `scripts/verify-agent-launch.ts`
- Create: `scripts/verify-agent-graph.ts`
- Modify: `package.json`
- Modify: `context/architecture-context.md`
- Modify: `context/progress-tracker.md`

**TDD:** First add failing graph checks. Prove valid parsing/materialization,
every enum, default dimensions, canonical edge fields, 1/40/41 node and
0/60/61 edge boundaries, ID/label/coordinate bounds, duplicate IDs and endpoint
pairs, dangling edges, self-loops, unknown keys, and immutability.

Implement a strict Zod compact-graph schema and:

```ts
export const MAX_AGENT_GRAPH_NODES = 40;
export const MAX_AGENT_GRAPH_EDGES = 60;
export type AgentGraph = z.infer<typeof agentGraphSchema>;
export function parseAgentGraph(value: unknown): AgentGraph | null;
export function materializeAgentGraph(graph: AgentGraph): CanvasSnapshot;
export function canonicalCanvasSnapshotsEqual(a: CanvasSnapshot, b: CanvasSnapshot): boolean;
```

Refactor the launch payload/record to `{version,launchId,title,graph}` and stages
`captured`, `creating-project`, `project-created`, `importing-graph`,
`graph-imported`, `failed`. Update transition tests exhaustively. Preserve the
canonical UUID, fragment cap, immutable helpers, and browser-safe decoding.

Run focused verifiers, `npm run verify:unit`, typecheck, and targeted lint with
the configured environment. Commit:

```text
feat: define caller-generated diagram graph
```

### Task 2: Make the distributable skill generate and launch a graph

**Files:**

- Modify: `.agents/skills/render-truss-diagram/SKILL.md`
- Create: `.agents/skills/render-truss-diagram/references/graph-schema.md`
- Modify: `.agents/skills/render-truss-diagram/scripts/open-truss-diagram.mjs`
- Modify: `scripts/verify-render-truss-skill.mjs`
- Modify: `README.md`
- Modify: `context/progress-tracker.md`

**TDD:** Change the launcher verifier first so the current description input is
RED. Test `--stdin-json` with `{title,graph}`, exact decoded fragment, all graph
boundaries, encoded-length rejection, invalid JSON/unknown keys, base origin
validation, async spawn errors, and no graph/title/fragment leakage.

Update the skill to require a title and description from the user, generate the
compact positioned graph itself using the reference rubric, and send only
`{title,graph}` to the launcher through stdin. Remove direct title/description
CLI arguments. Keep the generated `openai.yaml` interface values and safe
cross-platform spawn behavior.

Validate with the official skill validator, launcher verifier, repository
discovery, and a clean copied `npx skills` installation/use. Commit:

```text
feat: generate diagram graphs in calling skill
```

### Task 3: Add the owner-only idempotent graph import endpoint

**Files:**

- Create: `lib/canvas-persistence.ts`
- Create: `lib/agent-graph-import-server.ts`
- Create: `app/api/projects/[projectId]/agent-launch-import/route.ts`
- Modify: `app/api/projects/[projectId]/canvas/route.ts`
- Create: `scripts/verify-agent-graph-import.ts`
- Modify: `package.json`
- Modify: `context/architecture-context.md`
- Modify: `context/progress-tracker.md`

**TDD:** With injected authorization, flow, and persistence dependencies, prove
401/403 occur before body parse; malformed graphs are 400; empty canvas imports
all canonical nodes/edges in one mutation; exact replay returns 200 without a
second flow write; divergent non-empty canvas returns 409 without mutation;
same graph with different ordering compares equal; persistence failure is 502
and exact retry retries persistence; graph/launch contents never enter errors.

Factor the existing private Blob-first/Prisma-pointer-second save into
`saveCanvasSnapshot`. Keep the generic collaborator canvas PUT behavior intact.
The new route calls an owner-only controller that uses one server-side
`mutateFlow`, imports only into an empty room, treats exact state as a no-op,
then persists the canonical requested snapshot.

Run graph/import/canvas/project verifiers, integration verification, typecheck,
and lint. Commit:

```text
feat: import caller-generated diagrams safely
```

### Task 4: Replace the editor launch runner with direct graph import

**Files:**

- Create: `lib/agent-launch-import-runner.ts`
- Create: `hooks/use-agent-launch-import.ts`
- Modify: `components/editor/editor-shell.tsx`
- Modify: `components/editor/ai-sidebar.tsx`
- Modify: `lib/editor-sidebar-state.ts`
- Delete: `lib/agent-launch-runner.ts`
- Delete: `hooks/use-agent-launch-prompt.ts`
- Rewrite: `scripts/verify-agent-launch-editor.tsx`
- Modify: `context/ui-context.md`
- Modify: `context/architecture-context.md`
- Modify: `context/progress-tracker.md`

**TDD:** Rewrite the editor verifier first. Prove matching project/launch imports
once, Strict Mode shares a promise, stage persists `importing-graph`, success
persists `graph-imported` then clears storage/query, network/5xx/409 failures
retain graph state with a safe Retry, terminal record is a no-op, mismatch is a
no-op, no `/api/ai/chat` or `/api/ai/orchestrate` request occurs, and ordinary
AI/sidebar behavior remains unchanged and initially closed.

Mount the import hook inside the authorized active-project editor. Render a
neutral canvas overlay alert with Retry. Do not pass launch IDs into
`AiSidebar`; remove skill-specific prompt-run code while retaining Task 5's
shared manual submission controller.

Run editor, prompt submission, chat UI, canvas, and full unit verifiers;
typecheck/lint; React Doctor changed and staged scans. Commit:

```text
refactor: import agent diagrams without a second LLM
```

### Task 5: Complete end-to-end, distribution, and privacy verification

**Files:**

- Modify: `context/progress-tracker.md`
- Modify if defects surface: only files in the direct-import path

Run with the configured environment:

```bash
npm test
npm run verify:integration
npm run typecheck
npm run lint
npm run build
npm run doctor -- --verbose --scope changed
```

Run the official skill validator, launcher verifier, and clean-project
`npx skills add/list/use`. Verify a 40-node/60-edge fixture fits the fragment.

Browser test the signed-out capture/Clerk handoff and, when interactive auth is
available, verify one project, immediate graph rendering, refresh/retry with no
duplicates, empty AI transcript, and no Trigger run/network request. If Orca or
Clerk CAPTCHA blocks the authenticated segment, record it as a manual follow-up
without claiming pass.

Record the public GitHub install command as pending post-merge; do not push or
merge. Commit the sanitized verification record:

```text
docs: verify caller-generated diagram skill
```

Finally run a whole-branch review against the original base, allow one bounded
fix wave, rerun all affected gates, and finish with a clean worktree.
