# `truss:diagram` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the write-only `render-truss-diagram` skill with a single `truss:diagram` skill that creates, edits, and deletes Truss diagrams, backed by a one-shot loopback read channel and server-side diff-apply.

**Architecture:** Create keeps today's fragment-launch path untouched. Edit and delete open one `/agent/pick` tab that uses the browser's Clerk session to read the user's projects and the live canvas, and POSTs them to a one-shot `127.0.0.1` listener the skill script owns; the script holds each response open until the agent has an answer. Edits are reconciled server-side against the live Liveblocks room, never against the lagging blob snapshot.

**Tech Stack:** Next.js 16, TypeScript, Zod, Clerk, Prisma, Liveblocks (`@liveblocks/react-flow` server-side `mutateFlow`), Vercel Blob, Node `node:http` for the loopback, `tsx` assertion scripts for verification.

**Spec:** `docs/superpowers/specs/2026-08-13-truss-diagram-skill-design.md`

## Global Constraints

- **Node IDs the agent never saw are never removed.** Removal is scoped strictly to IDs present in the server-side compact projection of the live room.
- **Create's contract does not change.** Same payload, same `/agent/new` path, same limits, same `AGENT_LAUNCH_VERSION` of `1`.
- Compact graph limits are unchanged: 40 nodes, 60 edges, ID pattern `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` max 48 chars, node label 1–80, edge label 0–40, positions integers in `[-10000, 10000]`.
- Every route under `/api` calls `authorizeProject(projectId, { requireOwner: true })` itself. `proxy.ts` does not gate API routes.
- Loopback listener: bind `127.0.0.1` only, kernel-assigned port, 120000 ms idle timeout, 131072 byte body cap, nonce compared with `timingSafeEqual`, rejected callbacks do not consume the one-shot.
- No test framework. Verification is `tsx scripts/verify-*.ts` (or `node scripts/verify-*.mjs`) using `node:assert/strict`, chained in the `verify:unit` npm script.
- Immutability: never mutate inputs; return new objects (`~/.claude/rules/ecc/common/coding-style.md`).
- No `console.log` in shipped code. `console.error` for server-side failure logging matches existing routes.

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/agent-graph.ts` *(modify)* | Compact graph schema + both directions of projection + fingerprint |
| `lib/agent-graph-diff.ts` *(new)* | Pure diff between live and desired compact graphs |
| `lib/agent-canvas-write.ts` *(new)* | Paced draw + blob-then-pointer persistence, shared by import and edit |
| `lib/agent-graph-import-server.ts` *(modify)* | Create-path import; delegates writing to `agent-canvas-write` |
| `lib/agent-graph-edit-server.ts` *(new)* | Edit-path apply: fingerprint gate, diff, batched removal/update, paced adds |
| `app/api/projects/[projectId]/agent-graph/route.ts` *(new)* | Owner-only live-room read |
| `app/api/projects/[projectId]/agent-graph-edit/route.ts` *(new)* | Owner-only apply |
| `lib/agent-pick.ts` *(new)* | `/agent/pick` fragment contract: parse, validate, session-storage keys |
| `app/agent/pick/page.tsx` + `components/agent/agent-pick-page.tsx` *(new)* | The single tab that runs edit and delete |
| `proxy.ts` *(modify)* | Public-path and handshake-bypass predicates generalized to a set |
| `.agents/skills/truss-diagram/**` *(new, replaces `render-truss-diagram`)* | Skill definition, references, launcher script, loopback module |

---

### Task 1: Canvas → compact projection and fingerprint

**Files:**
- Modify: `lib/agent-graph.ts`
- Test: `scripts/verify-agent-graph-read.ts`
- Modify: `package.json` (add to `verify:unit`)

**Interfaces:**
- Consumes: `CanvasSnapshot` from `lib/canvas-snapshot`, `NODE_SHAPES`/`NODE_COLORS` from `types/canvas`.
- Produces:
  ```ts
  export interface AgentGraphView {
    graph: { version: 1; nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
    opaqueNodeIds: string[];
    opaqueEdgeIds: string[];
  }
  export type AgentGraphNode = AgentGraph["nodes"][number];
  export type AgentGraphEdge = AgentGraph["edges"][number];
  export function projectCanvasToAgentGraph(snapshot: CanvasSnapshot): AgentGraphView;
  export function canvasFingerprint(snapshot: CanvasSnapshot): string;
  export function parseAgentGraphAllowingEmpty(value: unknown): AgentGraphView["graph"] | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-agent-graph-read.ts`:

```ts
import assert from "node:assert/strict";

import {
  canvasFingerprint,
  parseAgentGraphAllowingEmpty,
  projectCanvasToAgentGraph,
} from "../lib/agent-graph";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  NODE_DEFAULT_SIZES,
} from "../types/canvas";
import type { CanvasEdge, CanvasNode } from "../types/canvas";

function node(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    ...NODE_DEFAULT_SIZES.rectangle,
    data: { label: "Node", shape: "rectangle", color: "neutral" },
    ...overrides,
  } as CanvasNode;
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return {
    id,
    type: CANVAS_EDGE_TYPE,
    source,
    target,
    data: { label: "" },
    style: { ...CANVAS_EDGE_STYLE },
    markerEnd: { ...CANVAS_EDGE_MARKER },
  } as CanvasEdge;
}

// Representable nodes land in the graph.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web"), node("api", { position: { x: 280, y: 0 } })],
    edges: [edge("web-to-api", "web", "api")],
  });

  assert.equal(view.graph.nodes.length, 2);
  assert.equal(view.graph.edges.length, 1);
  assert.deepEqual(view.opaqueNodeIds, []);
  assert.deepEqual(view.opaqueEdgeIds, []);
  assert.equal(view.graph.nodes[0].id, "web");
  assert.equal(view.graph.nodes[1].x, 280);
}

// A non-conforming ID is opaque, never dropped and never representable.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web"), node("Xk_92NOT-kebab")],
    edges: [],
  });

  assert.deepEqual(view.graph.nodes.map((n) => n.id), ["web"]);
  assert.deepEqual(view.opaqueNodeIds, ["Xk_92NOT-kebab"]);
}

// An over-long label is opaque.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web", { data: { label: "x".repeat(81), shape: "rectangle", color: "neutral" } })],
    edges: [],
  });

  assert.deepEqual(view.graph.nodes, []);
  assert.deepEqual(view.opaqueNodeIds, ["web"]);
}

// A non-integer position is opaque.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web", { position: { x: 10.5, y: 0 } })],
    edges: [],
  });

  assert.deepEqual(view.opaqueNodeIds, ["web"]);
}

// An edge whose endpoint is opaque is itself opaque.
{
  const view = projectCanvasToAgentGraph({
    nodes: [node("web"), node("BAD_ID")],
    edges: [edge("web-to-bad", "web", "BAD_ID")],
  });

  assert.deepEqual(view.graph.edges, []);
  assert.deepEqual(view.opaqueEdgeIds, ["web-to-bad"]);
}

// Fingerprints are order-independent and change with content.
{
  const a = { nodes: [node("web"), node("api")], edges: [] };
  const b = { nodes: [node("api"), node("web")], edges: [] };
  const c = { nodes: [node("web"), node("api", { position: { x: 1, y: 0 } })], edges: [] };

  assert.equal(canvasFingerprint(a), canvasFingerprint(b));
  assert.notEqual(canvasFingerprint(a), canvasFingerprint(c));
}

// Fingerprints cover opaque items too — an invisible change must still invalidate.
{
  const a = { nodes: [node("web"), node("BAD_ID")], edges: [] };
  const b = {
    nodes: [node("web"), node("BAD_ID", { data: { label: "moved", shape: "rectangle", color: "neutral" } })],
    edges: [],
  };

  assert.notEqual(canvasFingerprint(a), canvasFingerprint(b));
}

// An empty graph parses here but not through the strict launch schema.
{
  assert.deepEqual(parseAgentGraphAllowingEmpty({ version: 1, nodes: [], edges: [] }), {
    version: 1,
    nodes: [],
    edges: [],
  });
  assert.equal(parseAgentGraphAllowingEmpty({ version: 1, nodes: [], edges: [], extra: 1 }), null);
}

console.log("verify-agent-graph-read: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-agent-graph-read.ts`
Expected: FAIL — `projectCanvasToAgentGraph is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `lib/agent-graph.ts`, first factor the existing schema so the node minimum is a parameter. Replace the `export const agentGraphSchema = z.strictObject({...}).superRefine(...)` block with:

```ts
function buildAgentGraphSchema(minimumNodes: 0 | 1) {
  return z
    .strictObject({
      version: z.literal(1),
      nodes: z.array(agentGraphNodeSchema).min(minimumNodes).max(MAX_AGENT_GRAPH_NODES),
      edges: z.array(agentGraphEdgeSchema).max(MAX_AGENT_GRAPH_EDGES),
    })
    .superRefine((graph, context) => {
      // ...existing superRefine body, unchanged...
    });
}

export const agentGraphSchema = buildAgentGraphSchema(1);

/**
 * Same contract as `agentGraphSchema` with the one-node floor lifted. A launch
 * must draw something; an *edit* may legitimately empty a canvas, and rejecting
 * that would make "remove the last node" the one edit the skill cannot express.
 */
const agentGraphEditSchema = buildAgentGraphSchema(0);
```

Then append:

```ts
import { createHash } from "node:crypto";

export type AgentGraphNode = AgentGraph["nodes"][number];
export type AgentGraphEdge = AgentGraph["edges"][number];

export interface AgentGraphView {
  graph: { version: 1; nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
  opaqueNodeIds: string[];
  opaqueEdgeIds: string[];
}

export function parseAgentGraphAllowingEmpty(
  value: unknown,
): AgentGraphView["graph"] | null {
  const parsed = agentGraphEditSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * The compact view of a live canvas, plus the IDs it could not express.
 *
 * Human-authored nodes carry arbitrary IDs, long labels and hand-dragged
 * fractional positions — none of which fit the compact contract. They are
 * reported as opaque rather than dropped, because a caller that cannot see an
 * item must never be able to delete it.
 */
export function projectCanvasToAgentGraph(snapshot: CanvasSnapshot): AgentGraphView {
  const nodes: AgentGraphNode[] = [];
  const opaqueNodeIds: string[] = [];

  for (const node of snapshot.nodes) {
    const candidate = {
      id: node.id,
      label: node.data?.label ?? "",
      shape: node.data?.shape,
      color: node.data?.color,
      x: node.position?.x,
      y: node.position?.y,
    };
    const parsed = agentGraphNodeSchema.safeParse(candidate);

    if (parsed.success) {
      nodes.push(parsed.data);
    } else {
      opaqueNodeIds.push(node.id);
    }
  }

  const representableNodeIds = new Set(nodes.map((node) => node.id));
  const edges: AgentGraphEdge[] = [];
  const opaqueEdgeIds: string[] = [];
  const seenEdgeIds = new Set<string>();
  const seenPairs = new Set<string>();

  for (const edge of snapshot.edges) {
    const parsed = agentGraphEdgeSchema.safeParse({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.data?.label ?? "",
    });
    const pair = `${edge.source} ${edge.target}`;

    if (
      !parsed.success ||
      !representableNodeIds.has(edge.source) ||
      !representableNodeIds.has(edge.target) ||
      edge.source === edge.target ||
      seenEdgeIds.has(edge.id) ||
      seenPairs.has(pair)
    ) {
      opaqueEdgeIds.push(edge.id);
      continue;
    }

    seenEdgeIds.add(parsed.data.id);
    seenPairs.add(pair);
    edges.push(parsed.data);
  }

  return { graph: { version: 1, nodes, edges }, opaqueNodeIds, opaqueEdgeIds };
}

/**
 * A stable hash of the whole live room, opaque items included.
 *
 * Optimistic concurrency for edits: the read hands this out, the apply hands it
 * back, and the server recomputes it under the same `mutateFlow` callback that
 * performs the write. Covering opaque items matters — a collaborator editing a
 * node the agent cannot see still invalidates the basis the agent reasoned from.
 */
export function canvasFingerprint(snapshot: CanvasSnapshot): string {
  const nodes = [...snapshot.nodes]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((node) => [
      node.id,
      node.type,
      node.position?.x,
      node.position?.y,
      node.width,
      node.height,
      node.data?.label,
      node.data?.shape,
      node.data?.color,
    ]);
  const edges = [...snapshot.edges]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((edge) => [edge.id, edge.type, edge.source, edge.target, edge.data?.label ?? ""]);

  return createHash("sha256").update(JSON.stringify({ nodes, edges })).digest("hex");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-agent-graph-read.ts && npx tsx scripts/verify-agent-graph.ts`
Expected: both print `ok`. The second must still pass — the schema refactor is behaviour-preserving for launches.

- [ ] **Step 5: Wire into the verify chain**

In `package.json`, in `verify:unit`, insert `tsx scripts/verify-agent-graph-read.ts && ` immediately after `tsx scripts/verify-agent-graph.ts && `.

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/agent-graph.ts scripts/verify-agent-graph-read.ts package.json
git commit -m "feat: project live canvas into the compact agent graph"
```

---

### Task 2: The diff engine

**Files:**
- Create: `lib/agent-graph-diff.ts`
- Test: `scripts/verify-agent-graph-diff.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `AgentGraphView`, `AgentGraphNode`, `AgentGraphEdge` from Task 1.
- Produces:
  ```ts
  export interface AgentGraphDiff {
    addedNodes: AgentGraphNode[];
    updatedNodes: AgentGraphNode[];
    removedNodeIds: string[];
    addedEdges: AgentGraphEdge[];
    updatedEdges: AgentGraphEdge[];
    removedEdgeIds: string[];
  }
  export function diffAgentGraph(live: AgentGraphView, desired: AgentGraphView["graph"]): AgentGraphDiff;
  export function collidesWithOpaque(live: AgentGraphView, desired: AgentGraphView["graph"]): boolean;
  export function isDestructive(diff: AgentGraphDiff): boolean;
  ```

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-agent-graph-diff.ts`:

```ts
import assert from "node:assert/strict";

import {
  collidesWithOpaque,
  diffAgentGraph,
  isDestructive,
} from "../lib/agent-graph-diff";
import type { AgentGraphView } from "../lib/agent-graph";

function n(id: string, label = "Node", x = 0, y = 0) {
  return { id, label, shape: "rectangle" as const, color: "neutral" as const, x, y };
}

function e(id: string, source: string, target: string, label = "") {
  return { id, source, target, label };
}

function view(
  nodes: ReturnType<typeof n>[],
  edges: ReturnType<typeof e>[] = [],
  opaqueNodeIds: string[] = [],
  opaqueEdgeIds: string[] = [],
): AgentGraphView {
  return { graph: { version: 1, nodes, edges }, opaqueNodeIds, opaqueEdgeIds };
}

// Adds.
{
  const diff = diffAgentGraph(view([n("web")]), { version: 1, nodes: [n("web"), n("db")], edges: [] });

  assert.deepEqual(diff.addedNodes.map((node) => node.id), ["db"]);
  assert.deepEqual(diff.updatedNodes, []);
  assert.deepEqual(diff.removedNodeIds, []);
}

// Updates: label, shape, color and position all count.
{
  const diff = diffAgentGraph(view([n("web", "Web")]), {
    version: 1,
    nodes: [n("web", "Web App")],
    edges: [],
  });

  assert.deepEqual(diff.updatedNodes.map((node) => node.label), ["Web App"]);
  assert.deepEqual(diff.addedNodes, []);
}

{
  const diff = diffAgentGraph(view([n("web", "Web", 0, 0)]), {
    version: 1,
    nodes: [n("web", "Web", 400, 0)],
    edges: [],
  });

  assert.deepEqual(diff.updatedNodes.map((node) => node.x), [400]);
}

// Identical input produces an empty diff.
{
  const diff = diffAgentGraph(view([n("web")]), { version: 1, nodes: [n("web")], edges: [] });

  assert.deepEqual(diff, {
    addedNodes: [],
    updatedNodes: [],
    removedNodeIds: [],
    addedEdges: [],
    updatedEdges: [],
    removedEdgeIds: [],
  });
}

// Removal of a node the agent saw.
{
  const diff = diffAgentGraph(view([n("web"), n("db")]), { version: 1, nodes: [n("web")], edges: [] });

  assert.deepEqual(diff.removedNodeIds, ["db"]);
  assert.equal(isDestructive(diff), true);
}

// THE INVARIANT: a node the agent never saw is never removed.
{
  const diff = diffAgentGraph(
    view([n("web")], [], ["legacy-Node_ID"]),
    { version: 1, nodes: [n("web")], edges: [] },
  );

  assert.deepEqual(diff.removedNodeIds, []);
  assert.equal(isDestructive(diff), false);
}

// Edges: add, update label, remove.
{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [e("web-to-db", "web", "db", "reads")]),
    { version: 1, nodes: [n("web"), n("db")], edges: [e("web-to-db", "web", "db", "writes")] },
  );

  assert.deepEqual(diff.updatedEdges.map((edge) => edge.label), ["writes"]);
}

{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [e("web-to-db", "web", "db")]),
    { version: 1, nodes: [n("web"), n("db")], edges: [] },
  );

  assert.deepEqual(diff.removedEdgeIds, ["web-to-db"]);
  assert.equal(isDestructive(diff), true);
}

// An opaque edge is never removed.
{
  const diff = diffAgentGraph(
    view([n("web"), n("db")], [], [], ["hand-drawn-EDGE"]),
    { version: 1, nodes: [n("web"), n("db")], edges: [] },
  );

  assert.deepEqual(diff.removedEdgeIds, []);
}

// An ID that collides with an opaque item is refused outright.
{
  const live = view([n("web")], [], ["Legacy"]);

  assert.equal(collidesWithOpaque(live, { version: 1, nodes: [n("web")], edges: [] }), false);
  assert.equal(
    collidesWithOpaque(live, { version: 1, nodes: [n("web"), n("Legacy")], edges: [] }),
    true,
  );
}

// Emptying a canvas is expressible.
{
  const diff = diffAgentGraph(view([n("web")]), { version: 1, nodes: [], edges: [] });

  assert.deepEqual(diff.removedNodeIds, ["web"]);
}

console.log("verify-agent-graph-diff: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-agent-graph-diff.ts`
Expected: FAIL — cannot find module `../lib/agent-graph-diff`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/agent-graph-diff.ts`:

```ts
import type { AgentGraphEdge, AgentGraphNode, AgentGraphView } from "@/lib/agent-graph";

export interface AgentGraphDiff {
  addedNodes: AgentGraphNode[];
  updatedNodes: AgentGraphNode[];
  removedNodeIds: string[];
  addedEdges: AgentGraphEdge[];
  updatedEdges: AgentGraphEdge[];
  removedEdgeIds: string[];
}

function nodesEqual(a: AgentGraphNode, b: AgentGraphNode): boolean {
  return (
    a.label === b.label &&
    a.shape === b.shape &&
    a.color === b.color &&
    a.x === b.x &&
    a.y === b.y
  );
}

function edgesEqual(a: AgentGraphEdge, b: AgentGraphEdge): boolean {
  return a.source === b.source && a.target === b.target && a.label === b.label;
}

/**
 * The delta between what is on the canvas and what the caller wants there.
 *
 * Removal is derived from `live.graph` alone, never from the room. Items the
 * projection could not express are absent from `live.graph`, so they are
 * structurally invisible here and cannot be removed — the invariant is the data
 * shape, not a check that could be forgotten.
 */
export function diffAgentGraph(
  live: AgentGraphView,
  desired: AgentGraphView["graph"],
): AgentGraphDiff {
  const liveNodes = new Map(live.graph.nodes.map((node) => [node.id, node]));
  const desiredNodes = new Map(desired.nodes.map((node) => [node.id, node]));
  const liveEdges = new Map(live.graph.edges.map((edge) => [edge.id, edge]));
  const desiredEdges = new Map(desired.edges.map((edge) => [edge.id, edge]));

  const addedNodes: AgentGraphNode[] = [];
  const updatedNodes: AgentGraphNode[] = [];

  for (const node of desired.nodes) {
    const existing = liveNodes.get(node.id);

    if (!existing) {
      addedNodes.push(node);
    } else if (!nodesEqual(existing, node)) {
      updatedNodes.push(node);
    }
  }

  const addedEdges: AgentGraphEdge[] = [];
  const updatedEdges: AgentGraphEdge[] = [];

  for (const edge of desired.edges) {
    const existing = liveEdges.get(edge.id);

    if (!existing) {
      addedEdges.push(edge);
    } else if (!edgesEqual(existing, edge)) {
      updatedEdges.push(edge);
    }
  }

  return {
    addedNodes,
    updatedNodes,
    removedNodeIds: live.graph.nodes
      .filter((node) => !desiredNodes.has(node.id))
      .map((node) => node.id),
    addedEdges,
    updatedEdges,
    removedEdgeIds: live.graph.edges
      .filter((edge) => !desiredEdges.has(edge.id))
      .map((edge) => edge.id),
  };
}

/**
 * True when the caller reused an ID belonging to something it could not see.
 *
 * `addNodes` replaces on ID collision, so without this an edit would silently
 * overwrite the very item the removal rule exists to protect.
 */
export function collidesWithOpaque(
  live: AgentGraphView,
  desired: AgentGraphView["graph"],
): boolean {
  const opaqueNodes = new Set(live.opaqueNodeIds);
  const opaqueEdges = new Set(live.opaqueEdgeIds);

  return (
    desired.nodes.some((node) => opaqueNodes.has(node.id)) ||
    desired.edges.some((edge) => opaqueEdges.has(edge.id))
  );
}

export function isDestructive(diff: AgentGraphDiff): boolean {
  return diff.removedNodeIds.length > 0 || diff.removedEdgeIds.length > 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-agent-graph-diff.ts`
Expected: `verify-agent-graph-diff: ok`

- [ ] **Step 5: Wire into the verify chain**

In `package.json`, add `tsx scripts/verify-agent-graph-diff.ts && ` after the `verify-agent-graph-read.ts` entry.

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: Commit**

```bash
git add lib/agent-graph-diff.ts scripts/verify-agent-graph-diff.ts package.json
git commit -m "feat: add compact agent graph diff engine"
```

---

### Task 3: Extract the shared canvas writer

**Files:**
- Create: `lib/agent-canvas-write.ts`
- Modify: `lib/agent-graph-import-server.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AgentCanvasFlow {
    readonly nodes: readonly CanvasNode[];
    readonly edges: readonly CanvasEdge[];
    addNodes(nodes: CanvasNode[]): void;
    addEdges(edges: CanvasEdge[]): void;
    updateNode(id: string, partial: Partial<CanvasNode>): void;
    updateEdge(id: string, partial: Partial<CanvasEdge>): void;
    removeNodes(ids: string[]): void;
    removeEdges(ids: string[]): void;
  }
  export interface AgentCanvasWriteDependencies extends CanvasDrawingDependencies {
    authorizeProject: (projectId: string, options: { requireOwner: true }) => Promise<Authorization>;
    mutateFlow: (projectId: string, callback: (flow: AgentCanvasFlow) => void | Promise<void>) => Promise<void>;
    saveCanvasSnapshot: (projectId: string, snapshot: CanvasSnapshot) => Promise<unknown>;
  }
  export function drawNodesThenEdges(
    projectId: string,
    flow: AgentCanvasFlow,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    positionsById: Map<string, { x: number; y: number }>,
    dependencies: CanvasDrawingDependencies,
  ): Promise<void>;
  ```

This is a **refactor with no behaviour change**. Its gate is that the existing verification still passes.

- [ ] **Step 1: Record the current baseline**

Run: `npx tsx scripts/verify-agent-graph-import.ts`
Expected: passes. Note the output; it must be identical at the end.

- [ ] **Step 2: Create the shared module**

Create `lib/agent-canvas-write.ts`:

```ts
import {
  drawPacedCanvasActions,
  type CanvasDrawingDependencies,
  type PacedCanvasAction,
} from "@/lib/canvas-drawing";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import type { Authorization } from "@/lib/project-access";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * The subset of `@liveblocks/react-flow`'s `MutableFlow` the agent write paths
 * use. Narrowed on purpose: the import path only adds, and stating that in the
 * type keeps a future edit-shaped mistake out of the create contract.
 */
export interface AgentCanvasFlow {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  addNodes(nodes: CanvasNode[]): void;
  addEdges(edges: CanvasEdge[]): void;
  updateNode(id: string, partial: Partial<CanvasNode>): void;
  updateEdge(id: string, partial: Partial<CanvasEdge>): void;
  removeNodes(ids: string[]): void;
  removeEdges(ids: string[]): void;
}

export interface AgentCanvasWriteDependencies extends CanvasDrawingDependencies {
  authorizeProject: (
    projectId: string,
    options: { requireOwner: true },
  ) => Promise<Authorization>;
  mutateFlow: (
    projectId: string,
    callback: (flow: AgentCanvasFlow) => void | Promise<void>,
  ) => Promise<void>;
  saveCanvasSnapshot: (projectId: string, snapshot: CanvasSnapshot) => Promise<unknown>;
}

/**
 * Nodes first, then edges, each paced so a mounted editor sees the cursor
 * arrive before the item does. Shared by the create import and the edit apply
 * so both draw at the same rhythm.
 */
export async function drawNodesThenEdges(
  projectId: string,
  flow: AgentCanvasFlow,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  positionsById: Map<string, { x: number; y: number }>,
  dependencies: CanvasDrawingDependencies,
): Promise<void> {
  const actions: PacedCanvasAction<AgentCanvasFlow>[] = [
    ...nodes.map((node) => ({
      target: () => node.position,
      apply: (target: AgentCanvasFlow) => {
        target.addNodes([node]);
      },
    })),
    ...edges.map((edge) => ({
      target: () => positionsById.get(edge.target) ?? null,
      apply: (target: AgentCanvasFlow) => {
        target.addEdges([edge]);
      },
    })),
  ];

  await drawPacedCanvasActions(projectId, flow, actions, dependencies);
}
```

- [ ] **Step 3: Point the import server at it**

In `lib/agent-graph-import-server.ts`:

- Delete the local `AgentGraphImportFlow` interface. Import `AgentCanvasFlow` and use it in its place.
- Change `AgentGraphImportDependencies` to `export interface AgentGraphImportDependencies extends AgentCanvasWriteDependencies {}` — the three members it declared are now inherited verbatim.
- Replace the inline `const actions: PacedCanvasAction<...>[] = [...]; await drawPacedCanvasActions(...)` block with:

```ts
const requestedPositions = new Map(
  requestedSnapshot.nodes.map((node) => [node.id, node.position]),
);

await drawNodesThenEdges(
  projectId,
  flow,
  missingItems.nodes,
  missingItems.edges,
  requestedPositions,
  dependencies,
);
```

- Drop the now-unused `PacedCanvasAction` and `drawPacedCanvasActions` imports; keep `CanvasDrawingDependencies` only if still referenced.

- [ ] **Step 4: Verify nothing changed**

Run: `npx tsx scripts/verify-agent-graph-import.ts && npm run typecheck && npm run lint`
Expected: identical pass to Step 1.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-canvas-write.ts lib/agent-graph-import-server.ts
git commit -m "refactor: extract shared agent canvas writer"
```

---

### Task 4: The live-room read route

**Files:**
- Create: `app/api/projects/[projectId]/agent-graph/route.ts`

**Interfaces:**
- Consumes: `projectCanvasToAgentGraph`, `canvasFingerprint` (Task 1); `readCanvas` from `lib/canvas-read`; `authorizeProject` from `lib/project-access`.
- Produces: `GET /api/projects/:projectId/agent-graph` responding
  ```json
  { "graph": {...}, "opaqueNodeIds": [], "opaqueEdgeIds": [], "fingerprint": "..." }
  ```

- [ ] **Step 1: Write the route**

Create `app/api/projects/[projectId]/agent-graph/route.ts`:

```ts
import { canvasFingerprint, projectCanvasToAgentGraph } from "@/lib/agent-graph";
import { readCanvas } from "@/lib/canvas-read";
import { authorizeProject } from "@/lib/project-access";
import { jsonError } from "@/lib/project-requests";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * The compact view an agent edits against.
 *
 * Reads the live Liveblocks room, not `GET /api/projects/:id/canvas`. That route
 * serves the autosaved Blob snapshot, which lags the room — an edit diffed
 * against it would compute its delta from a canvas that no longer exists.
 *
 * Owner-only, matching the apply route: a read that a collaborator could take
 * but not act on is only an information leak.
 */
export async function GET(
  _request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;
  const access = await authorizeProject(projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  let snapshot;

  try {
    snapshot = await readCanvas(projectId);
  } catch (error: unknown) {
    console.error(`Live canvas read failed for ${projectId}`, error);
    return jsonError("Could not read the canvas", 502);
  }

  const view = projectCanvasToAgentGraph(snapshot);

  return Response.json({ ...view, fingerprint: canvasFingerprint(snapshot) });
}
```

- [ ] **Step 2: Confirm `readCanvas` returns the snapshot shape**

`lib/canvas-read.ts` types its return as `DesignContext`. Confirm `DesignContext` is structurally `{ nodes, edges }` of `CanvasNode`/`CanvasEdge` and therefore assignable to `CanvasSnapshot`. If it is not, adapt at this call site only:

```ts
const snapshot = { nodes: [...context.nodes], edges: [...context.edges] };
```

Do not change `readCanvas` — the AI tasks depend on its current signature.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Extend the API verification**

In `scripts/verify-project-api.ts`, following the existing patterns in that file for asserting handler auth behaviour, add assertions that the `agent-graph` GET returns `401` with no session and `403` for a non-owner. Match whatever mocking approach the file already uses; do not introduce a new one.

Run: `npx tsx scripts/verify-project-api.ts`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add app/api/projects/\[projectId\]/agent-graph/route.ts scripts/verify-project-api.ts
git commit -m "feat: add owner-only live agent graph read route"
```

---

### Task 5: The edit apply route

**Files:**
- Create: `lib/agent-graph-edit-server.ts`
- Create: `app/api/projects/[projectId]/agent-graph-edit/route.ts`
- Test: `scripts/verify-agent-graph-edit.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 (`projectCanvasToAgentGraph`, `canvasFingerprint`, `parseAgentGraphAllowingEmpty`, `materializeAgentGraph`), Task 2 (`diffAgentGraph`, `collidesWithOpaque`), Task 3 (`AgentCanvasFlow`, `AgentCanvasWriteDependencies`, `drawNodesThenEdges`).
- Produces: `POST /api/projects/:projectId/agent-graph-edit`, body `{ fingerprint: string, graph: AgentGraphView["graph"] }`, responding `200 { applied: {...} }`, `409` on stale fingerprint or opaque collision, `400` on invalid body.

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-agent-graph-edit.ts`. It exercises `handleAgentGraphEditPost` against an in-memory flow, the same injectable-dependencies style `verify-agent-graph-import.ts` uses:

```ts
import assert from "node:assert/strict";

import { canvasFingerprint, materializeAgentGraph } from "../lib/agent-graph";
import { handleAgentGraphEditPost } from "../lib/agent-graph-edit-server";
import type { AgentCanvasFlow } from "../lib/agent-canvas-write";
import type { CanvasEdge, CanvasNode } from "../types/canvas";

function n(id: string, label = "Node", x = 0, y = 0) {
  return { id, label, shape: "rectangle" as const, color: "neutral" as const, x, y };
}

function makeFlow(nodes: CanvasNode[], edges: CanvasEdge[]) {
  const state = { nodes: [...nodes], edges: [...edges] };
  const flow: AgentCanvasFlow = {
    get nodes() {
      return state.nodes;
    },
    get edges() {
      return state.edges;
    },
    addNodes: (added) => {
      state.nodes = [...state.nodes, ...added];
    },
    addEdges: (added) => {
      state.edges = [...state.edges, ...added];
    },
    updateNode: (id, partial) => {
      state.nodes = state.nodes.map((node) =>
        node.id === id ? ({ ...node, ...partial } as CanvasNode) : node,
      );
    },
    updateEdge: (id, partial) => {
      state.edges = state.edges.map((edge) =>
        edge.id === id ? ({ ...edge, ...partial } as CanvasEdge) : edge,
      );
    },
    removeNodes: (ids) => {
      state.nodes = state.nodes.filter((node) => !ids.includes(node.id));
    },
    removeEdges: (ids) => {
      state.edges = state.edges.filter((edge) => !ids.includes(edge.id));
    },
  };

  return { flow, state };
}

function deps(flow: AgentCanvasFlow, saved: { snapshot?: unknown }) {
  return {
    authorizeProject: async () => ({
      ok: true as const,
      role: "owner" as const,
      userId: "u1",
      ownerId: "u1",
    }),
    mutateFlow: async (
      _projectId: string,
      callback: (f: AgentCanvasFlow) => void | Promise<void>,
    ) => {
      await callback(flow);
    },
    saveCanvasSnapshot: async (_projectId: string, snapshot: unknown) => {
      saved.snapshot = snapshot;
    },
    setAiPresence: async () => {},
    clearAiPresence: async () => {},
    sleep: async () => {},
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A matching fingerprint applies the delta.
{
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(start),
      graph: { version: 1, nodes: [n("web"), n("db", "DB", 280, 0)], edges: [] },
    }),
    "p1",
    deps(flow, saved) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.nodes.map((node) => node.id).sort(), ["db", "web"]);
  assert.ok(saved.snapshot, "the applied snapshot is persisted");
}

// A stale fingerprint refuses without mutating.
{
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: "0".repeat(64),
      graph: { version: 1, nodes: [n("web"), n("db")], edges: [] },
    }),
    "p1",
    deps(flow, saved) as never,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(state.nodes.map((node) => node.id), ["web"]);
  assert.equal(saved.snapshot, undefined);
}

// Removal of a seen node is applied.
{
  const start = materializeAgentGraph({ version: 1, nodes: [n("web"), n("db", "DB", 280, 0)], edges: [] });
  const { flow, state } = makeFlow([...start.nodes], [...start.edges]);

  const response = await handleAgentGraphEditPost(
    request({ fingerprint: canvasFingerprint(start), graph: { version: 1, nodes: [n("web")], edges: [] } }),
    "p1",
    deps(flow, {}) as never,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.nodes.map((node) => node.id), ["web"]);
}

// THE INVARIANT, end to end: an unseen node survives.
{
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "Legacy_NODE",
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow, state } = makeFlow([...live.nodes], []);

  const response = await handleAgentGraphEditPost(
    request({ fingerprint: canvasFingerprint(live), graph: { version: 1, nodes: [n("web")], edges: [] } }),
    "p1",
    deps(flow, {}) as never,
  );

  assert.equal(response.status, 200);
  assert.ok(
    state.nodes.some((node) => node.id === "Legacy_NODE"),
    "a node the agent never saw must survive an edit",
  );
}

// Reusing an opaque ID is refused, and nothing is mutated.
//
// The opaque node's ID is chosen to be a *valid* compact ID that the projection
// still rejects for another reason — an over-long label — so the desired graph
// can legitimately name it and the collision check is what stops the write.
{
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "legacy-node",
    data: { label: "x".repeat(81), shape: "rectangle" as const, color: "neutral" as const },
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow, state } = makeFlow([...live.nodes], []);
  const saved: { snapshot?: unknown } = {};

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("web"), n("legacy-node", "Hijacked", 500, 0)], edges: [] },
    }),
    "p1",
    deps(flow, saved) as never,
  );

  assert.equal(response.status, 409);
  assert.equal(
    state.nodes.find((node) => node.id === "legacy-node")?.data.label,
    "x".repeat(81),
    "an opaque node must not be overwritten by an ID collision",
  );
  assert.equal(saved.snapshot, undefined);
}

// A non-colliding new ID alongside an opaque node still succeeds.
{
  const start = materializeAgentGraph({ version: 1, nodes: [n("web")], edges: [] });
  const opaque = {
    ...start.nodes[0],
    id: "legacy-node",
    data: { label: "y".repeat(81), shape: "rectangle" as const, color: "neutral" as const },
  } as CanvasNode;
  const live = { nodes: [...start.nodes, opaque], edges: [] };
  const { flow, state } = makeFlow([...live.nodes], []);

  const response = await handleAgentGraphEditPost(
    request({
      fingerprint: canvasFingerprint(live),
      graph: { version: 1, nodes: [n("web"), n("cache", "Cache", 500, 0)], edges: [] },
    }),
    "p1",
    deps(flow, {}) as never,
  );

  assert.equal(response.status, 200);
  assert.equal(state.nodes.length, 3);
}

// A malformed body is a 400.
{
  const { flow } = makeFlow([], []);
  const response = await handleAgentGraphEditPost(
    request({ fingerprint: "abc" }),
    "p1",
    deps(flow, {}) as never,
  );

  assert.equal(response.status, 400);
}

console.log("verify-agent-graph-edit: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-agent-graph-edit.ts`
Expected: FAIL — cannot find module `../lib/agent-graph-edit-server`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/agent-graph-edit-server.ts`:

```ts
import {
  canvasFingerprint,
  materializeAgentGraph,
  parseAgentGraphAllowingEmpty,
  projectCanvasToAgentGraph,
  type AgentGraphView,
} from "@/lib/agent-graph";
import {
  collidesWithOpaque,
  diffAgentGraph,
  type AgentGraphDiff,
} from "@/lib/agent-graph-diff";
import {
  drawNodesThenEdges,
  type AgentCanvasFlow,
  type AgentCanvasWriteDependencies,
} from "@/lib/agent-canvas-write";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { jsonError, readJsonBody } from "@/lib/project-requests";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

interface EditRequest {
  fingerprint: string;
  graph: AgentGraphView["graph"];
}

function parseEditRequest(value: unknown): EditRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value);

  if (keys.length !== 2 || !keys.includes("fingerprint") || !keys.includes("graph")) {
    return null;
  }

  const { fingerprint, graph } = value as { fingerprint?: unknown; graph?: unknown };

  if (typeof fingerprint !== "string" || !FINGERPRINT_PATTERN.test(fingerprint)) {
    return null;
  }

  const parsedGraph = parseAgentGraphAllowingEmpty(graph);

  return parsedGraph ? { fingerprint, graph: parsedGraph } : null;
}

type EditDecision = "applied" | "stale" | "collision";

/**
 * Applies removals and updates as one batch, then draws additions paced.
 *
 * Order is deliberate: the diagram makes room before it is drawn into, so a
 * reader sees an intentional rearrangement rather than new nodes appearing on
 * top of geometry that is about to change.
 */
function applyDiff(
  projectId: string,
  flow: AgentCanvasFlow,
  diff: AgentGraphDiff,
  desired: CanvasSnapshot,
  dependencies: AgentCanvasWriteDependencies,
): Promise<void> {
  const desiredNodes = new Map(desired.nodes.map((node) => [node.id, node]));
  const desiredEdges = new Map(desired.edges.map((edge) => [edge.id, edge]));

  if (diff.removedEdgeIds.length > 0) {
    flow.removeEdges(diff.removedEdgeIds);
  }

  if (diff.removedNodeIds.length > 0) {
    flow.removeNodes(diff.removedNodeIds);
  }

  for (const node of diff.updatedNodes) {
    const target = desiredNodes.get(node.id);

    if (target) {
      flow.updateNode(node.id, {
        position: target.position,
        width: target.width,
        height: target.height,
        data: target.data,
      });
    }
  }

  for (const edge of diff.updatedEdges) {
    const target = desiredEdges.get(edge.id);

    if (target) {
      flow.updateEdge(edge.id, {
        source: target.source,
        target: target.target,
        data: target.data,
      });
    }
  }

  return drawNodesThenEdges(
    projectId,
    flow,
    diff.addedNodes.map((node) => desiredNodes.get(node.id)!),
    diff.addedEdges.map((edge) => desiredEdges.get(edge.id)!),
    new Map(desired.nodes.map((node) => [node.id, node.position])),
    dependencies,
  );
}

/**
 * Injectable owner-only edit workflow. Authorization precedes body parsing, so
 * an unauthorised caller cannot probe graph validation.
 *
 * The fingerprint is recomputed *inside* the mutate callback rather than before
 * it: checking outside would reintroduce exactly the read-then-write race the
 * fingerprint exists to close.
 */
export async function handleAgentGraphEditPost(
  request: Request,
  projectId: string,
  dependencies: AgentCanvasWriteDependencies,
): Promise<Response> {
  const access = await dependencies.authorizeProject(projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const parsed = parseEditRequest(await readJsonBody(request));

  if (!parsed) {
    return jsonError("Invalid graph edit request", 400);
  }

  const desiredSnapshot = materializeAgentGraph({
    ...parsed.graph,
    nodes: parsed.graph.nodes,
  } as never);

  let decision: EditDecision = "stale";
  let appliedSnapshot: CanvasSnapshot | null = null;

  try {
    await dependencies.mutateFlow(projectId, async (flow) => {
      const liveSnapshot: CanvasSnapshot = {
        nodes: [...flow.nodes],
        edges: [...flow.edges],
      };

      if (canvasFingerprint(liveSnapshot) !== parsed.fingerprint) {
        decision = "stale";
        return;
      }

      const live = projectCanvasToAgentGraph(liveSnapshot);

      if (collidesWithOpaque(live, parsed.graph)) {
        decision = "collision";
        return;
      }

      const diff = diffAgentGraph(live, parsed.graph);
      await applyDiff(projectId, flow, diff, desiredSnapshot, dependencies);
      decision = "applied";
      appliedSnapshot = { nodes: [...flow.nodes], edges: [...flow.edges] };
    });
  } catch (error: unknown) {
    console.error(`Agent graph edit failed for ${projectId}`, error);
    return jsonError("Could not apply the graph edit", 502);
  }

  if (decision === "stale") {
    return jsonError("The canvas changed since it was read", 409);
  }

  if (decision === "collision") {
    return jsonError("The edit reuses an ID that is already in use", 409);
  }

  if (!appliedSnapshot) {
    return jsonError("Could not apply the graph edit", 502);
  }

  try {
    await dependencies.saveCanvasSnapshot(projectId, appliedSnapshot);
  } catch (error: unknown) {
    console.error(`Canvas persistence failed after edit for ${projectId}`, error);
    return jsonError("Could not save the edited canvas", 502);
  }

  return Response.json({ applied: true });
}
```

**Note on `materializeAgentGraph`:** it is typed for `AgentGraph` (one-node floor). Rather than the `as never` cast above, prefer widening its parameter type to `AgentGraphView["graph"]` in `lib/agent-graph.ts` — the function body does not depend on the minimum. Do that, then delete the cast.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-agent-graph-edit.ts`
Expected: `verify-agent-graph-edit: ok`

- [ ] **Step 5: Write the route**

Create `app/api/projects/[projectId]/agent-graph-edit/route.ts`, mirroring `agent-launch-import/route.ts` exactly — same `mutateFlow` wiring, same `maxDuration = 120`, same dependency object — but calling `handleAgentGraphEditPost`.

- [ ] **Step 6: Wire and check**

Add `tsx scripts/verify-agent-graph-edit.ts && ` to `verify:unit`.

Run: `npm run typecheck && npm run lint && npm run verify:unit`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/agent-graph-edit-server.ts "app/api/projects/[projectId]/agent-graph-edit/route.ts" scripts/verify-agent-graph-edit.ts package.json lib/agent-graph.ts
git commit -m "feat: apply agent graph edits with diff reconciliation"
```

---

### Task 6: Generalize the public-path predicates

**Files:**
- Create: `lib/agent-pick.ts`
- Modify: `proxy.ts`
- Modify: `scripts/verify-agent-launch.ts` (extend, do not rewrite)

**Interfaces:**
- Produces:
  ```ts
  export const AGENT_PICK_PATH = "/agent/pick";
  export const AGENT_PICK_QUERY_KEY = "pick";
  export const AGENT_PICK_STORAGE_PREFIX = "truss.agent-pick.v1:";
  export type AgentPickOperation = "edit" | "delete";
  export interface AgentPickPayloadV1 {
    version: 1;
    pickId: string;
    op: AgentPickOperation;
    port: number;
    nonce: string;
  }
  export function parseAgentPickFragment(hash: string): AgentPickPayloadV1 | null;
  export function isAgentPickId(value: unknown): value is string;
  export function agentPickStorageKey(pickId: string): string;
  ```

- [ ] **Step 1: Write `lib/agent-pick.ts`**

Model it directly on `lib/agent-launch.ts`: same base64url decode helper, same UUID v4 pattern, same `MAX_AGENT_LAUNCH_FRAGMENT_LENGTH`-style bound (use 2048 — this payload is tiny), a Zod `strictObject` for the payload, and a `parseAgentPickFragment` that strips a leading `#`, length-checks, decodes, `JSON.parse`es inside a `try`, and validates. Reuse `decodeBase64Url` by exporting it from `lib/agent-launch.ts` rather than copying it.

Constrain `port` to `z.number().int().min(1024).max(65535)` and `nonce` to the same canonical UUID v4 pattern as `pickId`.

- [ ] **Step 2: Generalize `proxy.ts`**

Replace the two single-constant predicates:

```ts
import { AGENT_LAUNCH_PATH } from "@/lib/agent-launch";
import { AGENT_PICK_PATH } from "@/lib/agent-pick";

/**
 * Both agent entry points carry their payload in the URL fragment, which the
 * browser never sends. A Clerk redirect would discard it, so both must be
 * public and both must bypass the development handshake.
 */
const AGENT_ENTRY_PATHS = [AGENT_LAUNCH_PATH, AGENT_PICK_PATH];

export function isPublicPath(pathname: string): boolean {
  if (AGENT_ENTRY_PATHS.includes(pathname)) {
    return true;
  }

  return AUTH_PUBLIC_PATHS.some(
    (publicPath) => pathname === publicPath || pathname.startsWith(`${publicPath}/`),
  );
}

export function isClerkHandshakeBypassPath(pathname: string): boolean {
  return AGENT_ENTRY_PATHS.includes(pathname);
}
```

- [ ] **Step 3: Extend the existing verification**

In `scripts/verify-agent-launch.ts`, add assertions alongside the existing ones:

```ts
import { isClerkHandshakeBypassPath, isPublicPath } from "../proxy";

assert.equal(isPublicPath("/agent/pick"), true);
assert.equal(isClerkHandshakeBypassPath("/agent/pick"), true);
assert.equal(isPublicPath("/agent/picky"), false);
assert.equal(isPublicPath("/editor/abc"), false);
```

Add fragment round-trip assertions for `parseAgentPickFragment`: a valid payload parses; a payload with an unknown key, a bad port, a non-UUID nonce, or a non-base64url fragment each return `null`.

- [ ] **Step 4: Run**

Run: `npx tsx scripts/verify-agent-launch.ts && npm run typecheck && npm run lint`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add lib/agent-pick.ts lib/agent-launch.ts proxy.ts scripts/verify-agent-launch.ts
git commit -m "feat: add the agent pick fragment contract and public path"
```

---

### Task 7: The `/agent/pick` page

**Files:**
- Create: `app/agent/pick/page.tsx`
- Create: `components/agent/agent-pick-page.tsx`
- Test: `scripts/verify-agent-pick-page.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 6's `lib/agent-pick.ts`; Task 4's read route; Task 5's apply route; `GET`/`DELETE /api/projects`.

- [ ] **Step 1: Write the page shell**

`app/agent/pick/page.tsx` mirrors `app/agent/new/page.tsx`: reads `searchParams.pick`, validates with `isAgentPickId`, renders `<AgentPickPage resumePickId={...} />`. Metadata title `"Working with your agent | Truss"`.

- [ ] **Step 2: Write the client component**

`components/agent/agent-pick-page.tsx`, `"use client"`. Mirror `agent-launch-page.tsx` for capture and sign-in:

- On mount, capture the fragment into `sessionStorage` under `agentPickStorageKey(pickId)`, scrub the fragment with `history.replaceState`.
- If `!isSignedIn` once Clerk is loaded, `clerk.redirectToSignIn({ redirectUrl: \`${AGENT_PICK_PATH}?${AGENT_PICK_QUERY_KEY}=${pickId}\` })`, guarded by an `isRedirecting` ref.
- Guard the whole run with a module-level in-flight map keyed on `pickId`, exactly like `startAgentLaunchProjectOnce`, so React Strict Mode's double effect does not run the operation twice.

The operation itself:

```ts
async function callback(port: number, nonce: string, body: unknown): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, ...(body as object) }),
  });

  if (!response.ok) {
    throw new Error("The agent rejected the callback.");
  }

  return response.json();
}
```

Edit flow:
1. `GET /api/projects` → `{ projects }`. Map to `{ id, name }` only — never send more to the loopback than the agent needs.
2. `callback(port, nonce, { op: "edit", projects })` → `{ projectId }`.
3. `GET /api/projects/${projectId}/agent-graph` → `{ graph, opaqueNodeIds, opaqueEdgeIds, fingerprint }`.
4. `callback(port, nonce, { projectId, graph, opaqueNodeIds, opaqueEdgeIds, fingerprint })` → `{ desiredGraph }`.
5. `POST /api/projects/${projectId}/agent-graph-edit` with `{ fingerprint, graph: desiredGraph }`.
6. On `409`, retry once from step 3 with the fresh fingerprint. On a second `409`, show the "actively edited" message and stop.
7. On `200`, `router.replace(\`/editor/${projectId}\`)`.

Delete flow:
1. `GET /api/projects` → map to `{ id, name }`.
2. `callback(port, nonce, { op: "delete", projects })` → `{ projectId }`.
3. Render the confirm dialog with the matching project's **name**, a Cancel and a Delete button.
4. On Delete, `DELETE /api/projects/${projectId}`. `204` → success state. Non-`204` → error state with a Retry button.

States to render, reusing the visual language of `AgentLaunchStatus` (same `rounded-2xl border border-surface-border bg-surface p-6` card, same `role="status"` / `role="alert"` split): `working`, `awaiting-agent` ("Waiting for your agent…"), `confirm-delete`, `done`, `failed` with a retry affordance. Never render graph contents or the nonce.

- [ ] **Step 3: Write the verification**

Create `scripts/verify-agent-pick-page.tsx` modelled on `scripts/verify-agent-launch-page.tsx`. Cover: fragment capture writes to storage and scrubs the URL; a missing or malformed fragment renders the not-found alert; the signed-out branch calls `redirectToSignIn` exactly once with the resume URL; the delete branch renders the project **name** in the confirm dialog and does not call `DELETE` before the button is pressed.

- [ ] **Step 4: Run**

Run: `npx tsx scripts/verify-agent-pick-page.tsx && npm run typecheck && npm run lint`

- [ ] **Step 5: Wire and commit**

Add `tsx scripts/verify-agent-pick-page.tsx && ` to `verify:unit`.

```bash
git add app/agent/pick components/agent/agent-pick-page.tsx scripts/verify-agent-pick-page.tsx package.json
git commit -m "feat: add the agent pick page for edit and delete"
```

---

### Task 8: The loopback listener

**Files:**
- Create: `.agents/skills/truss-diagram/scripts/loopback.mjs`
- Test: `scripts/verify-agent-loopback.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:
  ```js
  export async function startLoopback({ nonce, allowedOrigin, timeoutMs })
  // resolves { port, receive, close }
  // receive(): Promise<{ body, respond(value) }>  — resolves on the next valid callback
  ```

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-agent-loopback.mjs`:

```js
import assert from "node:assert/strict";

import { startLoopback } from "../.agents/skills/truss-diagram/scripts/loopback.mjs";

const NONCE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ORIGIN = "http://localhost:3000";

function post(port, body, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

// A valid callback resolves, and the held response carries the agent's answer.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const pending = post(server.port, { nonce: NONCE, op: "edit", projects: [] });
  const exchange = await server.receive();

  assert.equal(exchange.body.op, "edit");
  exchange.respond({ projectId: "p1" });

  assert.deepEqual(await (await pending).json(), { projectId: "p1" });
  await server.close();
}

// A wrong nonce is a 403 and does NOT consume the one-shot.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const bad = await post(server.port, { nonce: "00000000-0000-4000-8000-000000000000", op: "edit" });

  assert.equal(bad.status, 403);

  const pending = post(server.port, { nonce: NONCE, op: "edit", projects: [] });
  const exchange = await server.receive();

  assert.equal(exchange.body.op, "edit");
  exchange.respond({ projectId: "p1" });
  await pending;
  await server.close();
}

// A foreign origin is refused.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const bad = await post(server.port, { nonce: NONCE }, { origin: "http://evil.example" });

  assert.equal(bad.status, 403);
  await server.close();
}

// A foreign Host header is refused (DNS rebinding).
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const bad = await fetch(`http://127.0.0.1:${server.port}/`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, host: "evil.example" },
    body: JSON.stringify({ nonce: NONCE }),
  });

  assert.equal(bad.status, 403);
  await server.close();
}

// Preflight answers the exact origin and nothing else.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const preflight = await fetch(`http://127.0.0.1:${server.port}/`, {
    method: "OPTIONS",
    headers: { origin: ORIGIN, "access-control-request-method": "POST" },
  });

  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  await server.close();
}

// An oversized body is refused.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 5000 });
  const big = await post(server.port, { nonce: NONCE, pad: "x".repeat(200_000) });

  assert.equal(big.status, 413);
  await server.close();
}

// The idle timeout rejects rather than hanging forever.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 200 });

  await assert.rejects(() => server.receive());
  await server.close();
}

// It binds loopback only.
{
  const server = await startLoopback({ nonce: NONCE, allowedOrigin: ORIGIN, timeoutMs: 500 });

  assert.equal(server.address, "127.0.0.1");
  await server.close();
}

console.log("verify-agent-loopback: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-agent-loopback.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `.agents/skills/truss-diagram/scripts/loopback.mjs` using `node:http`. Requirements, each of which the test above pins:

- `server.listen({ host: "127.0.0.1", port: 0 })`; expose the assigned `port` and the literal `address` `"127.0.0.1"`.
- `OPTIONS` → `204` with `Access-Control-Allow-Origin: <allowedOrigin>`, `Access-Control-Allow-Headers: content-type`, `Access-Control-Allow-Methods: POST`, `Access-Control-Max-Age: 0`.
- Reject before reading the body when `req.headers.origin !== allowedOrigin` or `req.headers.host !== \`127.0.0.1:${port}\`` → `403`.
- Accumulate the body with a running byte count; past `131072` respond `413` and `req.destroy()`.
- Parse JSON; on failure `400`.
- Compare `body.nonce` to the expected nonce with `timingSafeEqual` over equal-length `Buffer`s (length-check first, since `timingSafeEqual` throws on a length mismatch) → `403` on mismatch.
- A rejection **must not** settle a pending `receive()`.
- `receive()` returns a promise resolving to `{ body, respond }`. `respond(value)` writes `200` with the JSON value and the CORS header, ending the held response.
- Each `receive()` arms a fresh `timeoutMs` timer; expiry rejects with `new Error("Timed out waiting for the browser.")`.
- `close()` ends any held response with `500`, clears timers, and closes the server. It is idempotent.
- Never write request bodies to stdout or stderr.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-agent-loopback.mjs`
Expected: `verify-agent-loopback: ok`

- [ ] **Step 5: Wire and commit**

Add `node scripts/verify-agent-loopback.mjs && ` to `verify:unit`.

```bash
git add .agents/skills/truss-diagram/scripts/loopback.mjs scripts/verify-agent-loopback.mjs package.json
git commit -m "feat: add one-shot loopback listener for agent callbacks"
```

---

### Task 9: The `truss:diagram` skill

**Files:**
- Move: `.agents/skills/render-truss-diagram/` → `.agents/skills/truss-diagram/`
- Create: `.agents/skills/truss-diagram/references/operations.md`
- Modify: `.agents/skills/truss-diagram/SKILL.md`
- Modify: `.agents/skills/truss-diagram/scripts/truss-diagram.mjs` (renamed from `open-truss-diagram.mjs`)
- Rename: `scripts/verify-render-truss-skill.mjs` → `scripts/verify-truss-diagram-skill.mjs`
- Modify: `.claude/skills/` symlink, `package.json`

- [ ] **Step 1: Move the skill and repoint the symlink**

```bash
git mv .agents/skills/render-truss-diagram .agents/skills/truss-diagram
git mv .agents/skills/truss-diagram/scripts/open-truss-diagram.mjs .agents/skills/truss-diagram/scripts/truss-diagram.mjs
git mv scripts/verify-render-truss-skill.mjs scripts/verify-truss-diagram-skill.mjs
rm .claude/skills/render-truss-diagram
ln -s ../../.agents/skills/truss-diagram .claude/skills/truss-diagram
```

Update `verify:unit` in `package.json` to call `node scripts/verify-truss-diagram-skill.mjs`.

- [ ] **Step 2: Add the operation dispatch to the launcher**

In `truss-diagram.mjs`, extend `parseArguments` to accept `--op <create|edit|delete>`, defaulting to `create`. **Create's path must be byte-identical in behaviour**: same `--stdin-json`, same validation, same `buildLaunchUrl`, same `/agent/new#` target. Add:

```js
export function buildPickUrl(baseUrl, { op, port, nonce, pickId }) {
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, pickId, op, port, nonce }),
    "utf8",
  ).toString("base64url");

  return `${normalizeBaseUrl(baseUrl)}/agent/pick#${encoded}`;
}
```

For `--op edit` and `--op delete`, `main()` starts the loopback, opens the pick URL, and drives the exchanges over stdout/stdin as a line-delimited JSON protocol so the agent can interleave its own questions to the user:

- Print `{"event":"projects","projects":[...]}` and read one line `{"projectId":"…"}` from stdin.
- For edit, print `{"event":"graph","graph":{…},"opaqueNodeIds":[…],"fingerprint":"…"}` and read one line `{"desiredGraph":{…}}`.
- Print `{"event":"done"}` or `{"event":"error","message":"…"}` and exit.

Never print the nonce.

- [ ] **Step 3: Rewrite `SKILL.md`**

Frontmatter:

```yaml
---
name: truss-diagram
description: Create, edit, or delete a Truss system architecture diagram in the user's browser. Use when the user asks an agent to draw, visualize, render, change, update, rename, add to, remove from, or delete a system design in Truss. Creating requires a user-specified title and description; editing and deleting resolve the target from the user's own project list.
---
```

Body: keep steps 1–9 of the current file as the **create** branch verbatim (they are the working contract), preceded by a dispatch section and followed by pointers to `references/operations.md` for edit and delete. Extend the origin preflight step so it checks `/agent/pick` as well as `/agent/new`.

- [ ] **Step 4: Write `references/operations.md`**

Document, as explicit agent procedure:

- **Dispatch.** Verb mapping; ask rather than guess when create and edit are both plausible.
- **Edit.** Run `--op edit`; on the `projects` event, resolve the target — exact case-insensitive name match, else unique substring match, else show candidates and ask; if the list is empty, tell the user they have no diagrams, ask for a title, and run the create branch using their edit request as the description. On the `graph` event, apply the change **in place**, reusing existing node IDs and assigning new kebab-case IDs only to new nodes; never reuse an ID listed in `opaqueNodeIds`. If the result removes any node or edge, state exactly what will be removed and get an explicit yes before replying.
- **Delete.** Run `--op delete`; same target resolution; if the list is empty, say so and stop — do not offer to create. Confirm by full project name, never by list index. Then hand the ID over; the browser shows the final confirm.
- **Announce the tab.** Say "opening Truss to read your projects" before running edit or delete, since the browser opens before the agent can ask anything.

- [ ] **Step 5: Extend the skill verification**

In `scripts/verify-truss-diagram-skill.mjs`, keep every existing assertion (they pin the create contract) and add: the frontmatter `name` is `truss-diagram`; `SKILL.md` references all three operations; `references/operations.md` exists and mentions the empty-library branch for both edit and delete; `buildPickUrl` produces a `/agent/pick#` URL that round-trips through `parseAgentPickFragment`; `--op create` still produces the identical `/agent/new#` URL for a fixed launch ID.

- [ ] **Step 6: Run**

Run: `node scripts/verify-truss-diagram-skill.mjs && npm run verify:unit`

- [ ] **Step 7: Commit**

```bash
git add -A .agents/skills .claude/skills scripts/verify-truss-diagram-skill.mjs package.json
git commit -m "feat: rename skill to truss:diagram with create, edit and delete"
```

---

### Task 10: Documentation and full verification

**Files:**
- Modify: `context/architecture-context.md`, `context/progress-tracker.md`

- [ ] **Step 1: Update the architecture context**

Under `## Agent Skill Launches`, rename the section to `## Agent Skill Operations` and add subsections describing: the `/agent/pick` public path and its shared handshake bypass; the loopback contract and its four defenses (loopback bind, nonce, exact-origin CORS, Host pin); the owner-only read route reading the live room rather than the blob; the diff-apply route with its fingerprint gate; and — stated as an invariant — that a node the agent never saw is never removed.

Add to `## Invariants`:

> 6. An agent edit may only remove canvas items it was able to read. Items outside the compact contract are invisible to the diff and survive every edit.

- [ ] **Step 2: Update the progress tracker**

Append an entry describing the `truss:diagram` work, its completed phase, and the resolved open question from Step 3.

- [ ] **Step 3: Resolve the spec's open question**

Determine whether Liveblocks history gives a user a working undo for a server-side `mutateFlow` batch. Check `@liveblocks/client` room history semantics for changes made through the Node client. Record the answer in `context/architecture-context.md`. If undo does **not** cover it, note in `references/operations.md` that the destructive-edit confirmation is the only safety net and must never be skipped.

- [ ] **Step 4: Full verification**

Run: `npm run verify:unit && npm run typecheck && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 5: Manual pass**

With `npm run dev` running and the origin preflight answering `200`:

1. Create a diagram from a description. Confirm it is unchanged from today's behaviour.
2. Hand-move one node in the editor. Ask the agent to add a service. Confirm the moved node keeps its position and the new node draws paced.
3. Ask the agent to remove a node. Confirm the terminal states what will be removed and waits.
4. Ask to delete a diagram. Confirm the terminal asks by name and the browser asks again.
5. With no projects, ask to edit — confirm the create reroute asks for a title. Then ask to delete — confirm it stops.

- [ ] **Step 6: Commit**

```bash
git add context/architecture-context.md context/progress-tracker.md .agents/skills
git commit -m "docs: record truss:diagram operations and the removal invariant"
```

---

## Execution Order

Tasks 1, 3, 6, 8 touch disjoint files and may run in parallel. Then 2, 4, 7, 9 (2 and 4 depend on 1; 7 on 6; 9 on 8). Then 5 (depends on 1, 2, 3). Then 10.
