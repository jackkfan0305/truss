# Diagram Edge Branching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the node-face edge fan with an explicit trunk-and-comb branch so every edge in a generated architecture diagram leaves its node at a handle point, peels off a shared trunk at its own column, and carries a label that cannot collide with its neighbours.

**Architecture:** Three pure layers, all DOM-free. `lib/canvas-geometry.ts` gains the route maths: lane ordering, split columns, an orthogonal path builder, and a label anchor. `lib/graph-layout.ts` dedupes generated edges, stamps a persisted lane index onto each edge, and sizes dagre's `ranksep` from the widest bundle across two dagre passes. `components/canvas/canvas-edge.tsx` reads the stamped lane plus a live parallel-group size from the React Flow store and draws the route. `scripts/verify-graph-layout.ts` proves the invariants from the emitted geometry.

**Tech Stack:** TypeScript, React 19 / Next.js, `@xyflow/react` (React Flow), `@dagrejs/dagre`, `tsx` + `node:assert/strict` for the verify scripts.

**Spec:** `docs/superpowers/specs/2026-08-23-diagram-edge-branching-design.md`

## Global Constraints

- **Purity.** `lib/canvas-geometry.ts` and `lib/graph-layout.ts` stay pure and DOM-free — no React, no `window`, no `document`. `scripts/verify-graph-layout.ts` runs them with no room, model, or browser.
- **Immutability.** Never mutate the `nodes` or `edges` arrays a caller passes, nor the objects inside them. Return new objects. `checkLayoutDoesNotMutateInputs` already enforces this and must keep passing.
- **Determinism.** Laying out the same graph twice must be byte-identical. Never iterate a `Set` or `Object.keys` over something rebuilt per call; iterate the caller's arrays in the order given. `checkLayoutIsDeterministic` enforces this.
- **Coordinate budget.** `lib/agent-graph.ts` represents coordinates only within plus or minus 10,000, and a node outside that range projects as opaque. Centred on the origin by `boundingCenter`, the usable total width is **18,920**.
- **Constant values, verbatim:** `EDGE_LABEL_CLEARANCE = { width: 160, height: 24 }` (unchanged), `LABEL_GAP = 40`, `TRUNK_MIN = 40`, `LANE_STEP = EDGE_LABEL_CLEARANCE.width + LABEL_GAP` (200), `PARALLEL_STEP = EDGE_LABEL_CLEARANCE.height + 40` (64), `CORNER_RADIUS = 8`, `LAYOUT_WIDTH_BUDGET = 18920`. `RANK_GAP` keeps its current value (280) and becomes the *floor* for `ranksep`.
- **Test runner:** every verify script runs via `npx tsx scripts/<name>.ts`. The full suite is `npm run verify:unit`.
- **Commits:** conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`). One commit per task at minimum.
- **Deviation from the spec, deliberate:** the spec said non-parallel edges keep `getSmoothStepPath` with a staggered `centerX`. Since Task 3 builds `orthogonalPath` anyway, **both** side-to-side cases go through it. One builder means one corner-rounding rule and one label-anchor rule instead of two that must be kept in sync. `getSmoothStepPath` survives only for top/bottom-handle routes.

---

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `types/canvas.ts` | Shared constants and the `CanvasEdgeData` shape. Gains `lane?: number` and the six new constants. |
| `lib/canvas-geometry.ts` | All pure route maths. Loses the fan (`FAN_STEP`, `FAN_FACE_MARGIN`, `fanOffset`, `fanSlotIndex`, `edgeTurnX`); gains `laneOrder`, `edgeSplitX`, `parallelLaneY`, `buildEdgeRoute`, `orthogonalPath`. |
| `lib/graph-layout.ts` | Dagre placement, handle choice, dedupe, lane stamping, computed `ranksep`. Gains `handleAnchor`, `ApplyLayoutOptions`. |
| `lib/canvas-snapshot.ts` | Storage whitelist. `parseEdge` gains `lane`. |
| `lib/design-plan.ts` | Carries `lane` through the `updateEdge` action so a relayout of an existing canvas refreshes lanes, not just handles. |
| `components/canvas/canvas-edge.tsx` | Reads lane and parallel-group size from the store, draws the route, positions the label. |
| `scripts/verify-graph-layout.ts` | The invariant harness. |
| `scripts/verify-canvas.ts` | Snapshot round-trip checks. Gains the `lane` whitelist cases. |

---

### Task 1: Constants and the persisted lane field

**Files:**
- Modify: `types/canvas.ts` (add constants beside `EDGE_LABEL_CLEARANCE` at line 84; extend `CanvasEdgeData` at line 131)
- Modify: `lib/canvas-snapshot.ts:106-142` (`parseEdge`)
- Test: `scripts/verify-canvas.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LABEL_GAP: number`, `TRUNK_MIN: number`, `LANE_STEP: number`, `PARALLEL_STEP: number`, `CORNER_RADIUS: number`, `LAYOUT_WIDTH_BUDGET: number` from `types/canvas.ts`; `CanvasEdgeData = { label: string; lane?: number }`.

- [ ] **Step 1: Write the failing test**

Add to `scripts/verify-canvas.ts`. Find the existing snapshot-parsing checks (they import from `../lib/canvas-snapshot`) and add this function, then call it from `main()`:

```ts
function checkEdgeLaneIsWhitelistedNotTrusted(): void {
  const base = {
    nodes: [
      {
        id: "a",
        type: CANVAS_NODE_TYPE,
        position: { x: 0, y: 0 },
        data: { label: "A", shape: "rectangle", color: DEFAULT_NODE_COLOR },
      },
      {
        id: "b",
        type: CANVAS_NODE_TYPE,
        position: { x: 400, y: 0 },
        data: { label: "B", shape: "rectangle", color: DEFAULT_NODE_COLOR },
      },
    ],
  };

  const parseWithLane = (lane: unknown) =>
    parseCanvasSnapshot({
      ...base,
      edges: [
        {
          id: "e",
          type: CANVAS_EDGE_TYPE,
          source: "a",
          target: "b",
          data: { label: "hop", lane },
        },
      ],
    });

  assert.equal(
    parseWithLane(2)?.edges[0].data?.lane,
    2,
    "a whole non-negative lane survives the round trip",
  );

  for (const bad of [-1, 1.5, Number.NaN, "2", null]) {
    assert.equal(
      parseWithLane(bad)?.edges[0].data?.lane,
      undefined,
      `a lane of ${String(bad)} is dropped rather than trusted`,
    );
    assert.equal(
      parseWithLane(bad)?.edges[0].data?.label,
      "hop",
      `dropping a bad lane does not take the label with it (${String(bad)})`,
    );
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-canvas.ts`
Expected: FAIL — `parseCanvasSnapshot` strips `lane` unconditionally, so the first assertion reports `undefined` where `2` was expected.

- [ ] **Step 3: Write minimal implementation**

In `types/canvas.ts`, immediately after `EDGE_LABEL_CLEARANCE` (line 84):

```ts
/**
 * The clear space a label pill keeps on every side. One `MIN_NODE_GAP`'s worth,
 * so a pill in a corridor is as far from what it sits between as a node is.
 */
export const LABEL_GAP = 40;

/**
 * The shared stub every edge in a bundle draws before the first one peels off.
 * Short on purpose: it is the cue that the lines share an origin, not a
 * corridor of its own.
 */
export const TRUNK_MIN = 40;

/**
 * The x distance between one lane's split column and the next.
 *
 * A full pill width plus a gap, because two lanes can carry labels at nearly
 * the same y: lane order is by vertical travel, so targets 100 and 90 units
 * away put their label anchors five units apart vertically and exactly one
 * `LANE_STEP` apart horizontally. Anything narrower than a pill overlaps them.
 */
export const LANE_STEP = EDGE_LABEL_CLEARANCE.width + LABEL_GAP;

/**
 * The y distance between the mid-lanes of one parallel group — the mirror of
 * `LANE_STEP`. A parallel group stacks its labels vertically at roughly one x,
 * so the separation it needs is a pill height plus a gap.
 *
 * Written as a literal 40 rather than `MIN_NODE_GAP`, which lives in
 * `lib/canvas-geometry.ts` — that module imports *from* here, and importing
 * back would recreate the exact cycle its header comment describes.
 */
export const PARALLEL_STEP = EDGE_LABEL_CLEARANCE.height + 40;

/** Corner rounding for every route this app draws, orthogonal or smoothstep. */
export const CORNER_RADIUS = 8;

/**
 * The total diagram width the compact agent graph contract can carry.
 *
 * `lib/agent-graph.ts` represents coordinates only within plus or minus
 * 10,000, and a node outside that range projects as *opaque* — invisible to an
 * agent reading the canvas back. `boundingCenter` centres the diagram on the
 * origin, so the usable span is both halves less the margin a node's own width
 * needs at each end.
 */
export const LAYOUT_WIDTH_BUDGET = 18920;
```

Then extend the data type at line 131:

```ts
export type CanvasEdgeData = {
  label: string;
  /**
   * The edge's slot among the edges leaving the same node by the same handle
   * (24-graph-layout). Decides which column it turns at, so it decides where
   * its label sits.
   *
   * Stamped by `applyLayout` from the laid-out geometry and persisted, rather
   * than recomputed per render. A geometric comparator is recomputed from live
   * positions, so dragging one node past another would flip it and two edges
   * would swap columns in a single jump of `LANE_STEP` — labels and all.
   * Absent on a hand-drawn edge that never went through layout; the renderer
   * falls back to an id sort for those.
   */
  lane?: number;
};
```

In `lib/canvas-snapshot.ts`, inside `parseEdge`, replace the `data:` line:

```ts
    data: {
      label: typeof edgeData.label === "string" ? edgeData.label : "",
      // Whitelisted, not trusted: a lane is an index into a bundle, so a
      // fractional, negative or non-numeric one names no slot. Dropping it
      // degrades to the renderer's id-sort fallback instead of throwing.
      ...(typeof edgeData.lane === "number" &&
      Number.isInteger(edgeData.lane) &&
      edgeData.lane >= 0
        ? { lane: edgeData.lane }
        : {}),
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/verify-canvas.ts`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: PASS — `lane` is optional, so nothing that builds a `CanvasEdgeData` today breaks.

- [ ] **Step 5: Commit**

```bash
git add types/canvas.ts lib/canvas-snapshot.ts scripts/verify-canvas.ts
git commit -m "feat: persist an edge's lane index and add the branch spacing constants"
```

---

### Task 2: Lane ordering and split columns

**Files:**
- Modify: `lib/canvas-geometry.ts` (add after `RANK_GAP`)
- Test: `scripts/verify-graph-layout.ts`

**Interfaces:**
- Consumes: `TRUNK_MIN`, `LANE_STEP` from Task 1.
- Produces:
  ```ts
  export interface LaneMember { id: string; deltaY: number; targetX: number }
  export function laneOrder(members: readonly LaneMember[]): Map<string, number>
  export function edgeSplitX(anchorX: number, targetX: number, lane: number): number
  ```

- [ ] **Step 1: Write the failing test**

Add to `scripts/verify-graph-layout.ts`, and call all three from `main()`:

```ts
function checkLaneOrderPutsTheLongestTravelClosestToTheSource(): void {
  // Two edges heading the same way. If the shorter one split first, the
  // longer one's vertical run would cross the shorter one's horizontal run.
  const members = [
    { id: "short", deltaY: 50, targetX: 400 },
    { id: "long", deltaY: 200, targetX: 400 },
  ];

  const order = laneOrder(members);

  assert.equal(order.get("long"), 0, "the furthest-travelling edge splits first");
  assert.equal(order.get("short"), 1, "the shorter one splits further out");

  assert.deepEqual(
    [...laneOrder([...members].reverse()).entries()].sort(),
    [...order.entries()].sort(),
    "the result does not depend on the order the members arrive in",
  );
}

function checkLaneOrderIgnoresDirectionAndBreaksTiesStably(): void {
  // Up and down are symmetric: an up-edge and a down-edge leave the trunk into
  // opposite half-planes and cannot cross, so only the magnitude matters.
  const order = laneOrder([
    { id: "up", deltaY: -200, targetX: 400 },
    { id: "down", deltaY: 200, targetX: 400 },
  ]);

  assert.equal(
    new Set([order.get("up"), order.get("down")]).size,
    2,
    "an exact magnitude tie still yields two distinct lanes",
  );

  const nearer = laneOrder([
    { id: "far", deltaY: 100, targetX: 900 },
    { id: "near", deltaY: 100, targetX: 400 },
  ]);

  assert.equal(nearer.get("near"), 0, "an equal climb breaks on the nearer target");
  assert.equal(nearer.get("far"), 1, "and the further target takes the outer lane");

  const byId = laneOrder([
    { id: "b", deltaY: 100, targetX: 400 },
    { id: "a", deltaY: 100, targetX: 400 },
  ]);

  assert.equal(byId.get("a"), 0, "a total tie falls back to edge id, so it is deterministic");
  assert.equal(byId.get("b"), 1);

  assert.deepEqual(
    laneOrder([
      { id: "a", deltaY: 100, targetX: 400 },
      { id: "b", deltaY: 100, targetX: 400 },
    ]),
    byId,
    "the id tiebreak is independent of arrival order",
  );

  assert.deepEqual(laneOrder([]), new Map(), "an empty bundle has no lanes");
}

function checkSplitColumnStaggersByLaneAndFollowsTheFlow(): void {
  assert.equal(
    edgeSplitX(100, 900, 0),
    100 + TRUNK_MIN,
    "lane 0 splits one trunk length past the anchor",
  );
  assert.equal(
    edgeSplitX(100, 900, 2),
    100 + TRUNK_MIN + 2 * LANE_STEP,
    "each further lane splits one LANE_STEP further out",
  );
  assert.equal(
    edgeSplitX(900, 100, 1),
    900 - (TRUNK_MIN + LANE_STEP),
    "a back-edge staggers backwards, not forwards",
  );
  assert.equal(
    edgeSplitX(100, 100, 0),
    100 + TRUNK_MIN,
    "a target directly above or below still splits forwards rather than at zero",
  );
}
```

Extend the import block at the top of the file: `laneOrder` and `edgeSplitX` from `../lib/canvas-geometry`, `TRUNK_MIN` and `LANE_STEP` from `../types/canvas`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: FAIL at import — `laneOrder` and `edgeSplitX` are not exported from `lib/canvas-geometry`.

- [ ] **Step 3: Write minimal implementation**

In `lib/canvas-geometry.ts`, add `TRUNK_MIN` and `LANE_STEP` to the existing `@/types/canvas` import, then add after `RANK_GAP`:

```ts
/** One edge's claim on a lane, as `laneOrder` needs to see it. */
export interface LaneMember {
  id: string;
  /** Signed vertical travel from the source anchor to the target anchor. */
  deltaY: number;
  /** The target anchor's x. Tie-break only. */
  targetX: number;
}

/**
 * Assigns each edge in one bundle its lane, keyed by edge id.
 *
 * Sorted by absolute `deltaY` **descending**, which is the whole reason a
 * bundle cannot cross itself. Lane `i` turns at `TRUNK_MIN + i * LANE_STEP`
 * past the anchor, so a later lane both turns further out *and* travels less
 * far vertically — its run can never reach the y at which an earlier lane is
 * already running horizontally. Sorting by target y instead would not have
 * this property: two targets on the same side of the source still cross.
 *
 * Direction is deliberately ignored. An up-edge and a down-edge leave the
 * trunk into opposite half-planes and cannot cross whatever order they take.
 *
 * Ties break on target x then on id, so the result is a pure function of the
 * members and not of the order they arrived in — which is what lets
 * `applyLayout` stay deterministic.
 */
export function laneOrder(members: readonly LaneMember[]): Map<string, number> {
  const sorted = [...members].sort(
    (a, b) =>
      Math.abs(b.deltaY) - Math.abs(a.deltaY) ||
      a.targetX - b.targetX ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  return new Map(sorted.map((member, index) => [member.id, index]));
}

/**
 * The column at which an edge leaves the trunk, given its lane.
 *
 * A target sitting at the anchor's own x has no direction to take, so it is
 * read as forward: turning at the anchor itself would put the label on the
 * node's own border.
 */
export function edgeSplitX(
  anchorX: number,
  targetX: number,
  lane: number
): number {
  const direction = targetX >= anchorX ? 1 : -1;

  return anchorX + direction * (TRUNK_MIN + lane * LANE_STEP);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/canvas-geometry.ts scripts/verify-graph-layout.ts
git commit -m "feat: order edge lanes by travel distance so a bundle cannot cross itself"
```

---

### Task 3: The route builder and the orthogonal path

**Files:**
- Modify: `lib/canvas-geometry.ts`
- Test: `scripts/verify-graph-layout.ts`

**Interfaces:**
- Consumes: `edgeSplitX` (Task 2); `PARALLEL_STEP`, `CORNER_RADIUS`, `EDGE_LABEL_CLEARANCE` (Task 1).
- Produces:
  ```ts
  export interface RoutePoint { x: number; y: number }
  export interface EdgeRoute { points: RoutePoint[]; labelPoint: RoutePoint }
  export function parallelLaneY(targetY: number, index: number, count: number): number
  export function buildEdgeRoute(params: {
    source: RoutePoint;
    target: RoutePoint;
    lane: number;
    parallelIndex: number;
    parallelCount: number;
  }): EdgeRoute
  export function orthogonalPath(points: readonly RoutePoint[], radius?: number): string
  ```

- [ ] **Step 1: Write the failing test**

Add to `scripts/verify-graph-layout.ts` and call all four from `main()`:

```ts
function checkNonParallelRouteIsTrunkThenTurn(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 900, y: 300 },
    lane: 1,
    parallelIndex: 0,
    parallelCount: 1,
  });

  const splitX = 100 + TRUNK_MIN + LANE_STEP;

  assert.deepEqual(
    route.points,
    [
      { x: 100, y: 0 },
      { x: splitX, y: 0 },
      { x: splitX, y: 300 },
      { x: 900, y: 300 },
    ],
    "trunk out, turn at the lane's own column, then straight in",
  );
  assert.deepEqual(
    route.labelPoint,
    { x: splitX, y: 150 },
    "the label rides the middle of the vertical run, which no other lane shares",
  );
}

function checkFlatRouteKeepsItsLabelOffTheNodeFace(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 900, y: 0 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 1,
  });

  assert.deepEqual(
    route.points,
    [
      { x: 100, y: 0 },
      { x: 900, y: 0 },
    ],
    "a straight hop collapses to two points rather than drawing a zero-height turn",
  );
  assert.equal(route.labelPoint.y, 0, "its label stays on the line");
  assert.equal(
    route.labelPoint.x,
    100 + TRUNK_MIN + EDGE_LABEL_CLEARANCE.width / 2,
    "and sits a pill's half-width past the split, so the pill clears the node",
  );
}

function checkParallelGroupBowsToItsOwnLane(): void {
  const shared = {
    source: { x: 100, y: 0 },
    target: { x: 900, y: 0 },
    lane: 0,
  } as const;

  const first = buildEdgeRoute({ ...shared, parallelIndex: 0, parallelCount: 2 });
  const second = buildEdgeRoute({ ...shared, parallelIndex: 1, parallelCount: 2 });

  assert.equal(first.points.length, 6, "a parallel member needs five segments");
  assert.equal(
    Math.abs(first.labelPoint.y - second.labelPoint.y),
    PARALLEL_STEP,
    "and its label is a full PARALLEL_STEP clear of its neighbour's",
  );
  assert.ok(
    Math.abs(first.labelPoint.y - second.labelPoint.y) > EDGE_LABEL_CLEARANCE.height,
    "which is more than a pill height, so the two cannot overlap",
  );
  assert.equal(
    (first.labelPoint.y + second.labelPoint.y) / 2,
    0,
    "the group straddles the line a single edge would have taken",
  );
}

function checkOrthogonalPathRoundsCornersAndDropsCollinearPoints(): void {
  const straight = orthogonalPath([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 0 },
  ]);

  assert.equal(
    straight,
    "M 0,0 L 100,0",
    "three points on one line draw one segment, not two",
  );

  const corner = orthogonalPath(
    [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ],
    8,
  );

  assert.ok(corner.includes("Q"), "a real corner is rounded, not mitred");
  assert.ok(corner.startsWith("M 0,0"), "the path starts at the source anchor");
  assert.ok(corner.trim().endsWith("100,100"), "and ends at the target anchor");

  const tight = orthogonalPath(
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ],
    8,
  );

  assert.ok(
    !tight.includes("NaN") && !tight.includes("-"),
    "a corner shorter than the radius clamps instead of overshooting backwards",
  );

  assert.equal(
    orthogonalPath([{ x: 5, y: 5 }]),
    "M 5,5",
    "a single point is a degenerate but valid path",
  );
  assert.equal(orthogonalPath([]), "", "no points draw nothing");
}

function checkCloseSpanParallelForwardDoesNotOvershoot(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 280, y: 0 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 2,
  });

  for (const point of route.points) {
    assert.ok(
      point.x >= 100 && point.x <= 280,
      `point x=${point.x} is within [100, 280]`,
    );
  }
  assert.ok(
    route.points.every((p) => p.x >= 100 && p.x <= 280),
    "all points stay between source and target, no overshooting",
  );
}

function checkCloseSpanParallelBackwardDoesNotOvershoot(): void {
  const route = buildEdgeRoute({
    source: { x: 280, y: 0 },
    target: { x: 100, y: 0 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 2,
  });

  for (const point of route.points) {
    assert.ok(
      point.x >= 100 && point.x <= 280,
      `point x=${point.x} is within [100, 280]`,
    );
  }
  assert.ok(
    route.points.every((p) => p.x >= 100 && p.x <= 280),
    "all points stay between target and source, no overshooting",
  );
}

function checkSlopedButUnderThresholdRouteKeepsLabelOnSegment(): void {
  const route = buildEdgeRoute({
    source: { x: 100, y: 0 },
    target: { x: 900, y: 20 },
    lane: 0,
    parallelIndex: 0,
    parallelCount: 1,
  });

  const end = route.points[route.points.length - 1];
  const start = route.points[route.points.length - 2];

  assert.equal(
    route.labelPoint.y,
    end.y,
    "the label rides the final horizontal, not the source's row",
  );
  assert.ok(
    route.labelPoint.x >= Math.min(start.x, end.x) &&
      route.labelPoint.x <= Math.max(start.x, end.x),
    `the label's x (${route.labelPoint.x}) is on the drawn segment ${start.x}..${end.x}, not beside it`,
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: FAIL at import — `buildEdgeRoute`, `parallelLaneY` and `orthogonalPath` do not exist.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/canvas-geometry.ts` (add `PARALLEL_STEP` and `CORNER_RADIUS` to the `@/types/canvas` import):

```ts
export interface RoutePoint {
  x: number;
  y: number;
}

/** A drawn route: its corner points, and where its label pill centres. */
export interface EdgeRoute {
  /** Corner points, source anchor first, target anchor last. */
  points: RoutePoint[];
  /** Always on a drawn segment, never floating beside one. */
  labelPoint: RoutePoint;
}

/**
 * The y a parallel group's member runs at across the corridor.
 *
 * Parallel edges between the same pair on the same row have no vertical run to
 * stagger — a split column alone would draw them as one overlapping line — so
 * they bow to their own lane instead, symmetrically about the y a single edge
 * would have taken.
 */
export function parallelLaneY(
  targetY: number,
  index: number,
  count: number
): number {
  return targetY + (index - (count - 1) / 2) * PARALLEL_STEP;
}

/**
 * The corner points and label anchor for one side-to-side edge.
 *
 * Two shapes. A lone edge turns once, at its lane's column, and hangs its
 * label on the vertical run — a run no other lane in the bundle occupies,
 * because no other lane turns at that column. A parallel group member turns
 * twice more, running the corridor at its own `parallelLaneY`, and hangs its
 * label there instead — a y no other member occupies.
 *
 * Either way the label sits mid-segment with drawn line on both sides of it.
 * That is the attribution cue the old corner-anchored label lacked: a pill at
 * a corner has nothing to its left, so a column of them reads as a list rather
 * than as one label per line.
 */
export function buildEdgeRoute({
  source,
  target,
  lane,
  parallelIndex,
  parallelCount,
}: {
  source: RoutePoint;
  target: RoutePoint;
  lane: number;
  parallelIndex: number;
  parallelCount: number;
}): EdgeRoute {
  const direction = target.x >= source.x ? 1 : -1;
  const splitX = edgeSplitX(source.x, target.x, lane);

  if (parallelCount > 1) {
    const laneY = parallelLaneY(target.y, parallelIndex, parallelCount);
    // Never past the target. A merge column beyond the approach point makes the
    // route overshoot and double back on itself, which is worse than the thing
    // the pill-width floor was trying to buy. When the endpoints are too close
    // to leave a full pill's width of bow, the pill overhangs its own segment
    // instead — it stays centred on the drawn line either way, which is the
    // invariant that actually matters.
    const approach = target.x - direction * TRUNK_MIN;
    const mergeX = direction * (approach - splitX) > 0 ? approach : splitX;

    return {
      points: dropCollinear([
        source,
        { x: splitX, y: source.y },
        { x: splitX, y: laneY },
        { x: mergeX, y: laneY },
        { x: mergeX, y: target.y },
        target,
      ]),
      labelPoint: { x: (splitX + mergeX) / 2, y: laneY },
    };
  }

  const points = [
    source,
    { x: splitX, y: source.y },
    { x: splitX, y: target.y },
    target,
  ];

  // A vertical run shorter than the pill has nowhere to hang one, so the label
  // rides the final horizontal instead, a half pill-width past the split. Both
  // coordinates are on a segment the path actually draws: that run is at
  // `target.y`, not `source.y` — pinning it to the source's y would leave the
  // pill beside the line rather than on it whenever the two ends differ.
  const labelPoint =
    Math.abs(target.y - source.y) <= EDGE_LABEL_CLEARANCE.height
      ? {
          x: splitX + (direction * EDGE_LABEL_CLEARANCE.width) / 2,
          y: target.y,
        }
      : { x: splitX, y: (source.y + target.y) / 2 };

  return { points: dropCollinear(points), labelPoint };
}

/**
 * An SVG path through a list of corner points, with the corners rounded.
 *
 * Written here rather than taken from React Flow because `getSmoothStepPath`
 * accepts a single `centerX` and so can only express one turn. A parallel
 * group member turns three times. Using this for the single-turn case too
 * means one corner-rounding rule instead of two that have to be kept in sync.
 *
 * Collinear points are dropped, so a route that degenerates to a straight line
 * draws one segment. Each corner's radius is clamped to half of the shorter of
 * its two segments, so a tight corner rounds less rather than doubling back.
 */
export function orthogonalPath(
  points: readonly RoutePoint[],
  radius: number = CORNER_RADIUS
): string {
  const corners = dropCollinear(points);

  if (corners.length === 0) {
    return "";
  }

  const [start] = corners;
  let path = `M ${round(start.x)},${round(start.y)}`;

  if (corners.length === 1) {
    return path;
  }

  for (let index = 1; index < corners.length - 1; index += 1) {
    const previous = corners[index - 1];
    const corner = corners[index];
    const next = corners[index + 1];

    const r = Math.min(
      radius,
      distance(previous, corner) / 2,
      distance(corner, next) / 2
    );

    const entry = along(corner, previous, r);
    const exit = along(corner, next, r);

    path += ` L ${round(entry.x)},${round(entry.y)}`;
    path += ` Q ${round(corner.x)},${round(corner.y)} ${round(exit.x)},${round(exit.y)}`;
  }

  const end = corners[corners.length - 1];

  return `${path} L ${round(end.x)},${round(end.y)}`;
}

/**
 * Removes duplicate and collinear points, so the corner loop only ever sees
 * real turns. Both cases arise honestly: a straight hop produces two identical
 * turn points, and a target level with its source produces three collinear
 * ones.
 */
function dropCollinear(points: readonly RoutePoint[]): RoutePoint[] {
  const kept: RoutePoint[] = [];

  for (const point of points) {
    const last = kept[kept.length - 1];

    if (last && last.x === point.x && last.y === point.y) {
      continue;
    }

    const beforeLast = kept[kept.length - 2];

    if (
      last &&
      beforeLast &&
      (beforeLast.x - last.x) * (last.y - point.y) ===
        (beforeLast.y - last.y) * (last.x - point.x)
    ) {
      kept.pop();
    }

    kept.push(point);
  }

  return kept;
}

function distance(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** `length` units from `from` in the direction of `toward`. */
function along(from: RoutePoint, toward: RoutePoint, length: number): RoutePoint {
  const span = distance(from, toward);

  if (span === 0) {
    return { x: from.x, y: from.y };
  }

  return {
    x: from.x + ((toward.x - from.x) / span) * length,
    y: from.y + ((toward.y - from.y) / span) * length,
  };
}

/** Keeps the emitted `d` free of float noise, so two identical routes compare equal. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: PASS

If the `!tight.includes("-")` assertion fails, note the fixture is deliberately all-positive: a minus sign in that output means the radius clamp overshot. Fix the clamp, not the test.

- [ ] **Step 5: Commit**

```bash
git add lib/canvas-geometry.ts scripts/verify-graph-layout.ts
git commit -m "feat: build orthogonal edge routes with lane columns and parallel bows"
```

---

### Task 4: Dedupe generated edges

**Files:**
- Modify: `lib/graph-layout.ts` (`applyLayout`, near line 325)
- Modify: `lib/agent-graph.ts:193` (`materializeAgentGraph`)
- Test: `scripts/verify-graph-layout.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface ApplyLayoutOptions { dedupe?: boolean }`; `applyLayout(nodes, edges, options?: ApplyLayoutOptions)`.

- [ ] **Step 1: Write the failing test**

```ts
function checkDedupeDropsIdenticalTriplesOnlyWhenAsked(): void {
  const nodes = [makeNode("a"), makeNode("b")];
  const edges = [
    makeEdge("e1", "a", "b", "OAuth + refresh"),
    makeEdge("e2", "a", "b", "OAuth + refresh"),
    makeEdge("e3", "a", "b", "encrypted tokens"),
    makeEdge("e4", "b", "a", "OAuth + refresh"),
  ];

  assert.equal(
    applyLayout(nodes, edges).edges.length,
    4,
    "the default path never deletes a user's edge",
  );

  assert.deepEqual(
    applyLayout(nodes, edges, { dedupe: true }).edges.map((edge) => edge.id),
    ["e1", "e3", "e4"],
    "only the exact source+target+label repeat goes, and the first occurrence is kept",
  );

  assert.equal(
    applyLayout(nodes, [makeEdge("u1", "a", "b"), makeEdge("u2", "a", "b")], {
      dedupe: true,
    }).edges.length,
    1,
    "two unlabelled edges between the same pair are the same duplicate case",
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: FAIL — `applyLayout` takes two arguments, so TypeScript rejects the third and the dedupe assertions never run.

- [ ] **Step 3: Write minimal implementation**

In `lib/graph-layout.ts`, above `applyLayout`:

```ts
export interface ApplyLayoutOptions {
  /**
   * Drop edges that repeat an earlier edge's `source`, `target` and label.
   *
   * Off by default, and deliberately so: dropping an edge is a real deletion,
   * and on a shared canvas losing a user's connection is not recoverable. Only
   * the generated paths — where a model has just emitted the same relationship
   * twice — turn it on.
   */
  dedupe?: boolean;
}

/**
 * Removes edges repeating an earlier `source + target + label`, keeping the
 * first occurrence.
 *
 * Two edges differing only in label are genuinely two relationships and both
 * survive. Direction is part of the key, so a request and its response are not
 * collapsed into one.
 */
function dedupeEdges(edges: readonly CanvasEdge[]): CanvasEdge[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    const key = `${edge.source} ${edge.target} ${edge.data?.label ?? ""}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}
```

Then change `applyLayout`'s signature and first lines:

```ts
export function applyLayout(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: ApplyLayoutOptions = {}
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const sourceEdges = options.dedupe ? dedupeEdges(edges) : edges;
  const laidOutNodes = layoutGraph(nodes, sourceEdges);
```

and replace every later use of `edges` inside `applyLayout` with `sourceEdges`.

In `lib/agent-graph.ts:193`:

```ts
  // Generated content: a model that emits the same relationship twice should
  // not cost the diagram two overlapping lines and two stacked labels.
  return applyLayout(nodes, edges, { dedupe: true });
```

`lib/design-plan.ts:596` stays as it is. `layoutPlan` folds layout into a model's *actions*, including actions touching edges the user already had, so dropping one there needs action-list filtering rather than an edge filter — out of scope, and recorded as such in the spec.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/verify-graph-layout.ts && npx tsx scripts/verify-agent-graph.ts && npx tsx scripts/verify-agent-graph-import.ts && npx tsx scripts/verify-design-agent.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/graph-layout.ts lib/agent-graph.ts scripts/verify-graph-layout.ts
git commit -m "feat: dedupe repeated relationships in generated graphs before layout"
```

---

### Task 5: Stamp lanes onto laid-out edges

**Files:**
- Modify: `lib/graph-layout.ts` (`applyLayout`; add `handleAnchor`, `assignLanes`, `wireEdges`)
- Test: `scripts/verify-graph-layout.ts`

**Interfaces:**
- Consumes: `laneOrder`, `LaneMember` (Task 2); `HANDLE_ID`, `Box`, `toBox` (existing).
- Produces: `export function handleAnchor(box: Box, handle: string): XYPosition`; every side-to-side edge returned by `applyLayout` carries `data.lane`.

- [ ] **Step 1: Write the failing test**

```ts
function checkApplyLayoutStampsLanesOnSideToSideEdgesOnly(): void {
  // One source fanning out to three targets at different heights: a bundle.
  const nodes = [makeNode("hub"), makeNode("near"), makeNode("mid"), makeNode("far")];
  const edges = [
    makeEdge("to-near", "hub", "near", "a"),
    makeEdge("to-mid", "hub", "mid", "b"),
    makeEdge("to-far", "hub", "far", "c"),
  ];

  const laidOut = applyLayout(nodes, edges);
  const boxes = new Map(laidOut.nodes.map((node) => [node.id, toBox(node)]));

  const sideToSide = laidOut.edges.filter(
    (edge) =>
      (edge.sourceHandle === "left" || edge.sourceHandle === "right") &&
      (edge.targetHandle === "left" || edge.targetHandle === "right"),
  );

  assert.ok(sideToSide.length > 1, "the fixture actually produces a bundle");

  for (const edge of sideToSide) {
    assert.equal(typeof edge.data?.lane, "number", `${edge.id} comes back with a lane`);
  }

  const lanes = sideToSide.map((edge) => edge.data!.lane!).sort((a, b) => a - b);

  assert.deepEqual(
    lanes,
    lanes.map((_, index) => index),
    "one bundle's lanes are 0..n-1 with no gaps and no repeats",
  );

  // The lane order is the travel order, measured from the final geometry.
  const travel = (edge: (typeof sideToSide)[number]) => {
    const from = handleAnchor(boxes.get(edge.source)!, edge.sourceHandle!);
    const to = handleAnchor(boxes.get(edge.target)!, edge.targetHandle!);

    return Math.abs(to.y - from.y);
  };

  const ordered = sideToSide
    .slice()
    .sort((a, b) => a.data!.lane! - b.data!.lane!)
    .map(travel);

  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      ordered[index] <= ordered[index - 1],
      "lanes run from the longest vertical travel outwards",
    );
  }

  assert.deepEqual(
    applyLayout(nodes, edges),
    laidOut,
    "lane stamping keeps applyLayout deterministic",
  );
}

function checkVerticalHandleEdgeIsLeftOutOfEveryBundle(): void {
  // Two nodes in the same rank: the connection runs up the column, so both
  // ends take a vertical handle and the lane machinery has no claim on it.
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
  const edges = [makeEdge("down", "a", "b", "x"), makeEdge("across", "a", "c", "y")];

  for (const edge of applyLayout(nodes, edges).edges) {
    const isSideToSide =
      (edge.sourceHandle === "left" || edge.sourceHandle === "right") &&
      (edge.targetHandle === "left" || edge.targetHandle === "right");

    assert.equal(
      edge.data?.lane === undefined,
      !isSideToSide,
      `${edge.id}: a lane is present exactly when the route is side to side`,
    );
  }
}
```

Add `handleAnchor` to the `../lib/graph-layout` import at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: FAIL at import — `handleAnchor` is not exported; once it is, `edge.data.lane` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `lib/graph-layout.ts`, add after `chooseHandles`:

```ts
/**
 * The point on a box where a handle sits.
 *
 * React Flow gives the renderer these as `sourceX`/`sourceY`, but the layout
 * has to compute them itself: lanes are assigned before anything is measured
 * on screen, from the rectangles dagre produced.
 */
export function handleAnchor(box: Box, handle: string): XYPosition {
  switch (handle) {
    case HANDLE_ID.left:
      return { x: box.x, y: box.y + box.height / 2 };
    case HANDLE_ID.right:
      return { x: box.x + box.width, y: box.y + box.height / 2 };
    case HANDLE_ID.top:
      return { x: box.x + box.width / 2, y: box.y };
    default:
      return { x: box.x + box.width / 2, y: box.y + box.height };
  }
}

/** A route leaving one vertical face and entering the other — the only kind lanes apply to. */
function isSideToSideRoute(sourceHandle: string, targetHandle: string): boolean {
  const isSide = (handle: string) =>
    handle === HANDLE_ID.left || handle === HANDLE_ID.right;

  return isSide(sourceHandle) && isSide(targetHandle);
}

/** Every edge that has both endpoints, with its handles chosen from the given geometry. */
function wireEdges(
  placed: readonly CanvasNode[],
  edges: readonly CanvasEdge[]
): { edge: CanvasEdge; source: Box; target: Box }[] {
  const boxes = new Map(placed.map((node) => [node.id, toBox(node)]));
  // Built once so `chooseHandles` can skip an edge's own endpoints by identity.
  const allBoxes = [...boxes.values()];

  return edges.flatMap((edge) => {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);

    if (!source || !target) {
      return [];
    }

    const { sourceHandle, targetHandle } = chooseHandles(source, target, allBoxes);

    return [{ edge: { ...edge, sourceHandle, targetHandle }, source, target }];
  });
}

/**
 * Groups the side-to-side edges by the handle they leave from and assigns each
 * one its lane, returning the result keyed by edge id.
 *
 * Edges on a top or bottom handle are left out entirely. A lane is a claim
 * about the node-free band between two ranks, and an edge leaving a vertical
 * face is not crossing that band — its anchor x there is its node's own centre
 * line, not the edge of its rank.
 */
function assignLanes(
  wired: readonly { edge: CanvasEdge; source: Box; target: Box }[]
): Map<string, number> {
  const bundles = new Map<string, LaneMember[]>();

  for (const { edge, source, target } of wired) {
    if (!isSideToSideRoute(edge.sourceHandle!, edge.targetHandle!)) {
      continue;
    }

    const key = `${edge.source} ${edge.sourceHandle}`;
    const from = handleAnchor(source, edge.sourceHandle!);
    const to = handleAnchor(target, edge.targetHandle!);

    bundles.set(key, [
      ...(bundles.get(key) ?? []),
      { id: edge.id, deltaY: to.y - from.y, targetX: to.x },
    ]);
  }

  const lanes = new Map<string, number>();

  // Iterating the map is safe for determinism: its insertion order follows
  // `wired`, which follows the caller's edge array.
  for (const members of bundles.values()) {
    for (const [id, lane] of laneOrder(members)) {
      lanes.set(id, lane);
    }
  }

  return lanes;
}
```

Import `laneOrder` and `type LaneMember` from `@/lib/canvas-geometry`.

Then rework `applyLayout`'s edge pass — handles must be decided for every edge before any lane can be assigned:

```ts
  const wired = wireEdges(laidOutNodes, sourceEdges);
  const lanes = assignLanes(wired);
  const wiredById = new Map(wired.map((entry) => [entry.edge.id, entry.edge]));

  const laidOutEdges = sourceEdges.map((edge) => {
    const routed = wiredById.get(edge.id);

    // An edge whose source or target is missing from `nodes` comes back
    // unchanged rather than dropped: on a shared canvas, routing a user's edge
    // badly is recoverable, deleting it is not.
    if (!routed) {
      return edge;
    }

    const lane = lanes.get(edge.id);

    return lane === undefined
      ? routed
      : { ...routed, data: { ...(routed.data ?? { label: "" }), lane } };
  });

  return { nodes: laidOutNodes, edges: laidOutEdges };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: PASS

Run: `npm run verify:unit`
Expected: PASS. If `scripts/verify-agent-graph.ts` fails on a snapshot comparison, it is because `graphsAreEqual` now sees a `lane` — it must not. Confirm `graphsAreEqual` in `lib/agent-graph.ts:230-244` still compares only `id`, `type`, `source`, `target`, `data.label`, `style` and `markerEnd`, and leave it that way: a lane is a layout result, not authored content, and including it would make an identical graph compare unequal after a relayout.

- [ ] **Step 5: Commit**

```bash
git add lib/graph-layout.ts scripts/verify-graph-layout.ts
git commit -m "feat: stamp a lane index onto every side-to-side edge at layout time"
```

---

### Task 6: Size the rank gap from the widest bundle

**Files:**
- Modify: `lib/graph-layout.ts` (`layoutGraph`, `applyLayout`, add `computedRankSep`)
- Modify: `lib/canvas-geometry.ts` (`RANK_GAP` doc comment)
- Test: `scripts/verify-graph-layout.ts`

**Interfaces:**
- Consumes: `wireEdges`, `assignLanes` (Task 5); `TRUNK_MIN`, `LANE_STEP`, `LABEL_GAP`, `LAYOUT_WIDTH_BUDGET`, `EDGE_LABEL_CLEARANCE` (Task 1); `RANK_GAP`, `MIN_NODE_GAP` (existing).
- Produces: no new exports. `layoutGraph` gains an optional third parameter `ranksep: number = RANK_GAP`; `applyLayout` runs it twice.

- [ ] **Step 1: Write the failing test**

```ts
function checkWideBundleGetsRoomForItsLabelsAndStaysInBudget(): void {
  // One hub with six targets: six lanes, so six split columns plus a pill.
  const nodes = [makeNode("hub"), ...Array.from({ length: 6 }, (_, i) => makeNode(`t${i}`))];
  const edges = Array.from({ length: 6 }, (_, i) =>
    makeEdge(`e${i}`, "hub", `t${i}`, `label ${i}`),
  );

  const { nodes: laidOut, edges: laidOutEdges } = applyLayout(nodes, edges);
  const boxes = new Map(laidOut.map((node) => [node.id, toBox(node)]));
  const hub = boxes.get("hub")!;
  const target = boxes.get("t0")!;
  const gap = Math.abs(target.x - (hub.x + hub.width));
  const maxLane = Math.max(...laidOutEdges.map((edge) => edge.data?.lane ?? 0));

  assert.ok(
    gap >= TRUNK_MIN + maxLane * LANE_STEP + EDGE_LABEL_CLEARANCE.width / 2,
    `the rank gap (${gap}) holds every split column and the outermost label`,
  );

  const xs = laidOut.flatMap((node) => [
    node.position.x,
    node.position.x + (node.width ?? 0),
  ]);

  assert.ok(
    Math.max(...xs) - Math.min(...xs) <= LAYOUT_WIDTH_BUDGET,
    "and the whole diagram still fits the compact contract's coordinate budget",
  );
}

function checkSingleEdgeBundlesLayOutExactlyAsBefore(): void {
  // Every bundle here has one member, so the computed ranksep must land on the
  // RANK_GAP floor and nothing about this graph may move.
  const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
  const edges = [makeEdge("ab", "a", "b", "x"), makeEdge("bc", "b", "c", "y")];
  const boxes = applyLayout(nodes, edges)
    .nodes.map((node) => toBox(node))
    .sort((left, right) => left.x - right.x);

  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const gap = boxes[index].x - (previous.x + previous.width);

    // Within one grid unit, not exactly equal: `layoutGraph` snaps every
    // position to `LAYOUT_GRID` after centring the diagram on the origin, so
    // an exact match would be asserting that the snap happens to be a no-op.
    assert.ok(
      Math.abs(gap - RANK_GAP) <= LAYOUT_GRID,
      `a chain keeps the rank gap it has today (got ${gap}, want ${RANK_GAP})`,
    );
  }
}

function checkLongChainStaysInsideTheCoordinateBudget(): void {
  const nodes = Array.from({ length: 40 }, (_, i) => makeNode(`n${i}`));
  const edges = Array.from({ length: 39 }, (_, i) =>
    makeEdge(`e${i}`, `n${i}`, `n${i + 1}`, ""),
  );
  const xs = applyLayout(nodes, edges).nodes.flatMap((node) => [
    node.position.x,
    node.position.x + (node.width ?? 0),
  ]);

  assert.ok(
    Math.max(...xs) <= 10000 && Math.min(...xs) >= -10000,
    "a 40-node chain — the widest the compact contract allows — stays representable",
  );
}
```

Add `RANK_GAP`, `LABEL_GAP` and `LAYOUT_WIDTH_BUDGET` to the imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: FAIL — `checkWideBundleGetsRoomForItsLabelsAndStaysInBudget` reports a gap of 280 where six lanes need `40 + 5 * 200 + 80 = 1120`.

- [ ] **Step 3: Write minimal implementation**

Give `layoutGraph` an optional `ranksep`:

```ts
export function layoutGraph(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  ranksep: number = RANK_GAP
): CanvasNode[] {
```

and use it: `graph.setGraph({ rankdir: "LR", nodesep: RANK_ROW_GAP, ranksep })`.

Add:

```ts
/**
 * The rank gap this graph's widest bundle needs, clamped to what the compact
 * agent graph contract can represent.
 *
 * A wide bundle and a long chain never co-occur — a chain stacks nothing, so
 * its bundles have one member each and it lands on the `RANK_GAP` floor — so
 * the clamp only bites on graphs that are genuinely both. Rather than guess a
 * ceiling, it is computed from the rank count this layout actually produced.
 *
 * When the clamp does bite the lanes compress evenly, which is the same
 * give-up-evenly behaviour the old face fan had for a crowded node face:
 * squeezed still reads, overshot reads as labels anchored to thin air.
 */
function computedRankSep(maxLane: number, placed: readonly CanvasNode[]): number {
  const needed = Math.max(
    RANK_GAP,
    TRUNK_MIN + maxLane * LANE_STEP + EDGE_LABEL_CLEARANCE.width / 2 + LABEL_GAP
  );

  // Nodes in one rank share an x centre, so counting distinct centres counts
  // ranks, and the widest node in each is what that rank costs in width.
  const columns = new Map<number, number>();

  for (const node of placed) {
    const box = toBox(node);
    const center = box.x + box.width / 2;

    columns.set(center, Math.max(columns.get(center) ?? 0, box.width));
  }

  // A single-rank graph has no rank gap to size.
  if (columns.size < 2) {
    return needed;
  }

  const nodeWidth = [...columns.values()].reduce((total, width) => total + width, 0);
  const affordable = (LAYOUT_WIDTH_BUDGET - nodeWidth) / (columns.size - 1);

  return Math.max(MIN_NODE_GAP, Math.min(needed, affordable));
}
```

Then make `applyLayout` run the layout twice. Rank *assignment* does not depend on `ranksep` — it only scales coordinates — so pass 2 places nodes in the same ranks, and handles and lanes are recomputed from the final geometry regardless:

```ts
export function applyLayout(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  options: ApplyLayoutOptions = {}
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const sourceEdges = options.dedupe ? dedupeEdges(edges) : edges;

  // Pass 1 exists only to learn the shape: how many ranks, and how wide the
  // widest bundle is. Both need handles, handles need positions, and positions
  // need a rank gap — so the first gap is the floor and the second is derived.
  const probe = layoutGraph(nodes, sourceEdges);
  const probeLanes = assignLanes(wireEdges(probe, sourceEdges));
  const maxLane = Math.max(0, ...probeLanes.values());

  const laidOutNodes = layoutGraph(
    nodes,
    sourceEdges,
    computedRankSep(maxLane, probe)
  );

  const wired = wireEdges(laidOutNodes, sourceEdges);
  const lanes = assignLanes(wired);
  const wiredById = new Map(wired.map((entry) => [entry.edge.id, entry.edge]));

  const laidOutEdges = sourceEdges.map((edge) => {
    const routed = wiredById.get(edge.id);

    // An edge whose source or target is missing from `nodes` comes back
    // unchanged rather than dropped: on a shared canvas, routing a user's edge
    // badly is recoverable, deleting it is not.
    if (!routed) {
      return edge;
    }

    const lane = lanes.get(edge.id);

    return lane === undefined
      ? routed
      : { ...routed, data: { ...(routed.data ?? { label: "" }), lane } };
  });

  return { nodes: laidOutNodes, edges: laidOutEdges };
}
```

Import `TRUNK_MIN`, `LANE_STEP`, `LABEL_GAP`, `LAYOUT_WIDTH_BUDGET` and `EDGE_LABEL_CLEARANCE` from `@/types/canvas`.

Finally update the `RANK_GAP` doc comment in `lib/canvas-geometry.ts` — it currently describes itself as the literal rank separation, and it is now the floor:

```ts
/**
 * The FLOOR for the empty corridor the layout leaves between one rank of nodes
 * and the next, in flow units.
 *
 * `applyLayout` passes dagre a `ranksep` computed from the graph's widest
 * bundle and clamped to the coordinate budget (`computedRankSep` in
 * `lib/graph-layout.ts`). This is the value a graph of single-edge bundles
 * lands on, and the value the corridor had before lanes existed.
 *
 * It holds an edge label's pill (`EDGE_LABEL_CLEARANCE.width`) plus clear space
 * on both sides of it, so a lone label sits in the corridor rather than against
 * whichever node is closer.
 */
export const RANK_GAP = MIN_NODE_GAP * 3 + EDGE_LABEL_CLEARANCE.width;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: PASS

Run: `npm run verify:unit`
Expected: PASS. `scripts/verify-design-agent.ts` and `scripts/verify-agent-graph-import.ts` assert on concrete coordinates in places; a fixture with only single-edge bundles will not move, and one with a real bundle needs its expected coordinates updated to the new gap. Update the fixture's expectations, not `computedRankSep`.

- [ ] **Step 5: Commit**

```bash
git add lib/graph-layout.ts lib/canvas-geometry.ts scripts/verify-graph-layout.ts
git commit -m "feat: size the rank gap from the widest bundle, clamped to the coordinate budget"
```

---

### Task 7: Draw the comb

**Files:**
- Modify: `components/canvas/canvas-edge.tsx:44-200`
- Modify: `lib/canvas-geometry.ts` (delete `FAN_STEP`, `FAN_FACE_MARGIN`, `fanOffset`, `fanSlotIndex`, `edgeTurnX`)
- Modify: `scripts/verify-graph-layout.ts` (delete the checks for the deleted functions)

**Interfaces:**
- Consumes: `buildEdgeRoute`, `orthogonalPath`, `EdgeRoute` (Task 3); `data.lane` (Task 5); `CORNER_RADIUS` (Task 1).
- Produces: nothing other tasks read.

- [ ] **Step 1: Replace the fan selector**

In `components/canvas/canvas-edge.tsx`, replace `readFanSlots` with:

```ts
/**
 * This edge's lane, and its place among any parallel edges sharing both its
 * endpoints: `lane:parallelIndex:parallelCount`.
 *
 * Packed into a string on purpose. A selector returning an object hands back a
 * fresh reference on every store change, and the default `Object.is` compare
 * would then re-render every edge on every frame of a node drag. A string
 * compares by value.
 *
 * The lane comes from `data.lane`, stamped by `applyLayout`, so dragging never
 * reshuffles a bundle. A hand-drawn edge that never went through layout has no
 * lane; those fall back to an id sort among the laneless members of their own
 * bundle — arbitrary but fixed, which is all the fallback has to be.
 */
function readLaneSlots(store: ReactFlowState, edgeId: string): string {
  const edge = store.edgeLookup.get(edgeId);

  if (!edge) {
    return "0:0:1";
  }

  const bundle = store.edges.filter(
    (candidate) =>
      candidate.source === edge.source &&
      candidate.sourceHandle === edge.sourceHandle
  );

  const laneOf = (candidate: (typeof bundle)[number]) =>
    (candidate.data as CanvasEdgeData | undefined)?.lane;

  const lane =
    laneOf(edge) ??
    bundle
      .filter((candidate) => laneOf(candidate) === undefined)
      .map((candidate) => candidate.id)
      .sort()
      .indexOf(edgeId);

  // One `Handle` per side serves both directions (`canvas-node.tsx` renders
  // them all as `type="source"`, and the canvas runs `ConnectionMode.Loose`),
  // so a parallel group is keyed on all four of these.
  const parallel = bundle
    .filter(
      (candidate) =>
        candidate.target === edge.target &&
        candidate.targetHandle === edge.targetHandle
    )
    .map((candidate) => candidate.id)
    .sort();

  return `${Math.max(0, lane)}:${Math.max(0, parallel.indexOf(edgeId))}:${
    parallel.length || 1
  }`;
}
```

Keep `isSideFace` — the `isSideToSide` gate still needs it.

- [ ] **Step 2: Replace the path and label computation**

Replace the `const [source, target] = useMemo(...)` block, the `getSmoothStepPath` call and the `labelX` / `labelY` derivation with:

```ts
  const laneSlots = useStore(
    useCallback((store: ReactFlowState) => readLaneSlots(store, id), [id])
  );

  // A lane is a claim about the node-free band between two ranks. An edge on a
  // top or bottom handle is not crossing that band — its `sourceX` there is the
  // node's own centre line, not the edge of its rank — so those keep React
  // Flow's own route and label point.
  const isSideToSide = isSideFace(sourcePosition) && isSideFace(targetPosition);

  const route = useMemo((): EdgeRoute => {
    const [lane, parallelIndex, parallelCount] = laneSlots.split(":").map(Number);

    return buildEdgeRoute({
      source: { x: sourceX, y: sourceY },
      target: { x: targetX, y: targetY },
      lane,
      parallelIndex,
      parallelCount,
    });
  }, [laneSlots, sourceX, sourceY, targetX, targetY]);

  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: CORNER_RADIUS,
  });

  const path = isSideToSide ? orthogonalPath(route.points) : smoothPath;
  const labelX = isSideToSide ? route.labelPoint.x : smoothLabelX;
  const labelY = isSideToSide ? route.labelPoint.y : smoothLabelY;
```

Update the imports: drop `edgeTurnX`, `fanOffset`, `fanSlotIndex`; add `buildEdgeRoute`, `orthogonalPath` and `type EdgeRoute` from `@/lib/canvas-geometry`, and `CORNER_RADIUS` plus `type CanvasEdgeData` from `@/types/canvas`.

- [ ] **Step 3: Delete the fan from the geometry module**

In `lib/canvas-geometry.ts`, delete `FAN_STEP`, `FAN_FACE_MARGIN`, `fanOffset`, `fanSlotIndex` and `edgeTurnX` together with their doc comments.

In `scripts/verify-graph-layout.ts`, delete `checkFanSpreadsEdgesWithoutLeavingTheFace`, `checkLongEdgeTurnsInACorridorNoNodeOccupies`, `checkSameRankEdgeKeepsTheMidpointTurn` and `checkBackEdgeTurnsBackwards`, their `main()` calls, and the now-unused imports (`FAN_STEP`, `edgeTurnX`, `fanOffset`, `fanSlotIndex`).

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS — no remaining reference to the deleted exports.

Run: `npm run verify:unit`
Expected: PASS

Run `npm run dev`, open a project, and generate the diagram the spec closes on — `Identity & Sessions` with four edges into PostgreSQL, `Provider Connections & Credentials` with three. Confirm by eye: every edge meets a node at one of its four handles; each label has drawn line on both sides of it; no two pills touch.

- [ ] **Step 5: Commit**

```bash
git add components/canvas/canvas-edge.tsx lib/canvas-geometry.ts scripts/verify-graph-layout.ts
git commit -m "feat: draw edges as a trunk and comb instead of fanning them along the node face"
```

---

### Task 8: Carry the lane through a relayout of an existing canvas

**Files:**
- Modify: `lib/design-plan.ts` — the `DesignAction` union near line 89, `applyAction` near line 185, the `addEdge` fold near line 612, and `handleRefreshes` near line 648
- Test: `scripts/verify-design-agent.ts`

**Interfaces:**
- Consumes: `data.lane` on the edges `applyLayout` returns (Task 5).
- Produces: `{ type: "updateEdge"; id: string; sourceHandle: string; targetHandle: string; lane?: number }`.

Without this, relaying out a canvas that already has edges refreshes their handles but leaves their lanes stale, so an edge added to a bundle pushes nobody else's column and two edges end up sharing one.

- [ ] **Step 1: Write the failing test**

Add to `scripts/verify-design-agent.ts`, beside `checkAddEdgeHandlesMatchFinalGeometry` (line 833). It uses that file's existing helpers: `node(id, x, y)` (line 78), `edge(id, source, target)` (line 89), and `parseDesignPlan(raw, context)`, whose returned `plan.actions` are already layout-folded.

```ts
function checkRelayoutRefreshesLanesNotJustHandles(): void {
  // A hub that already has one edge, with a second added by the plan. The
  // existing edge's lane has to move: it is no longer the only member.
  const context: DesignContext = {
    nodes: [node("hub", 0, 0), node("a", 400, 0), node("b", 400, 200)],
    edges: [
      {
        ...edge("hub-a", "hub", "a"),
        sourceHandle: "right",
        targetHandle: "left",
        data: { label: "first", lane: 0 },
      },
    ],
  };

  const { actions } = parseDesignPlan(
    { actions: [{ type: "addEdge", source: "hub", target: "b", label: "second" }] },
    context,
  );

  const added = actions.find(
    (action) => action.type === "addEdge" && action.edge.target === "b",
  );

  assert.ok(
    added?.type === "addEdge" && typeof added.edge.data?.lane === "number",
    "a newly added edge is born with its lane, never lane-less then patched",
  );

  const refreshed = actions.find(
    (action) => action.type === "updateEdge" && action.id === "hub-a",
  );

  assert.ok(
    refreshed?.type === "updateEdge",
    "the pre-existing edge gets an updateEdge because its bundle grew",
  );
  assert.equal(
    typeof refreshed.lane,
    "number",
    "and that update carries the new lane, not only the handles",
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/verify-design-agent.ts`
Expected: FAIL — `updateEdge` has no `lane` property, so TypeScript rejects `refreshed.lane`.

- [ ] **Step 3: Write minimal implementation**

Extend the action variant near line 89:

```ts
  | {
      type: "updateEdge";
      id: string;
      sourceHandle: string;
      targetHandle: string;
      /**
       * The edge's refreshed lane, when layout moved it. App-emitted like the
       * handles either side of it — `DESIGN_ACTION_TYPES` deliberately keeps
       * `updateEdge` out of what raw model output can produce, and a model has
       * no geometry to derive a lane from anyway.
       */
      lane?: number;
    };
```

In `applyAction` near line 185, carry the lane without dropping the label:

```ts
    case "updateEdge":
      flow.updateEdge(action.id, {
        sourceHandle: action.sourceHandle,
        targetHandle: action.targetHandle,
        ...(action.lane === undefined
          ? {}
          : { data: { ...flow.getEdge(action.id)?.data, lane: action.lane } }),
      });
      break;
```

If the `flow` shim in this module exposes no `getEdge`, thread the existing edge's `data` through from the caller instead — the requirement is that a lane refresh never takes the label with it.

In the `addEdge` fold near line 612:

```ts
    if (action.type === "addEdge") {
      const wired = laidOutEdgesById.get(action.edge.id);

      return wired?.sourceHandle && wired.targetHandle
        ? {
            ...action,
            edge: {
              ...action.edge,
              sourceHandle: wired.sourceHandle,
              targetHandle: wired.targetHandle,
              data: {
                ...action.edge.data,
                ...(wired.data?.lane === undefined ? {} : { lane: wired.data.lane }),
              },
            },
          }
        : action;
    }
```

In `handleRefreshes` near line 648, widen the "did anything change" test:

```ts
  const handleRefreshes = context.edges.flatMap((edge): DesignAction[] => {
    const wired = laidOutEdgesById.get(edge.id);

    if (!wired?.sourceHandle || !wired.targetHandle) {
      return [];
    }

    const laneChanged = wired.data?.lane !== edge.data?.lane;
    const handlesChanged =
      wired.sourceHandle !== edge.sourceHandle ||
      wired.targetHandle !== edge.targetHandle;

    // A no-op update is a pointless AI-cursor trip and a junk activity row.
    if (!laneChanged && !handlesChanged) {
      return [];
    }

    return [
      {
        type: "updateEdge",
        id: edge.id,
        sourceHandle: wired.sourceHandle,
        targetHandle: wired.targetHandle,
        ...(wired.data?.lane === undefined ? {} : { lane: wired.data.lane }),
      },
    ];
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx scripts/verify-design-agent.ts`
Expected: PASS

Run: `npm run verify:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/design-plan.ts scripts/verify-design-agent.ts
git commit -m "feat: refresh edge lanes when a relayout changes a bundle"
```

---

### Task 9: Prove the invariants from the drawn geometry

**Files:**
- Modify: `scripts/verify-graph-layout.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-6.
- Produces: nothing.

These are the acceptance tests. They are written against the *emitted* segments rather than against the ordering that produced them — otherwise the test only restates the sort.

- [ ] **Step 1: Write the test**

```ts
/** Whether two axis-aligned segments touch, endpoints included. */
function segmentsIntersect(
  a1: RoutePoint,
  a2: RoutePoint,
  b1: RoutePoint,
  b2: RoutePoint,
): boolean {
  const overlaps = (p: number, q: number, r: number, s: number) =>
    Math.max(Math.min(p, q), Math.min(r, s)) <= Math.min(Math.max(p, q), Math.max(r, s));

  return overlaps(a1.x, a2.x, b1.x, b2.x) && overlaps(a1.y, a2.y, b1.y, b2.y);
}

/** Every route in the graph, keyed by edge id, built the way the renderer builds them. */
function routeEveryEdge(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
): Map<string, EdgeRoute> {
  const boxes = new Map(nodes.map((node) => [node.id, toBox(node)]));
  const parallelKey = (edge: CanvasEdge) =>
    `${edge.source} ${edge.target} ${edge.sourceHandle} ${edge.targetHandle}`;

  const groups = new Map<string, string[]>();

  for (const edge of edges) {
    const key = parallelKey(edge);

    groups.set(key, [...(groups.get(key) ?? []), edge.id].sort());
  }

  const routes = new Map<string, EdgeRoute>();

  for (const edge of edges) {
    const source = boxes.get(edge.source);
    const target = boxes.get(edge.target);

    if (!edge.sourceHandle || !edge.targetHandle || !source || !target) {
      continue;
    }

    const group = groups.get(parallelKey(edge))!;

    routes.set(
      edge.id,
      buildEdgeRoute({
        source: handleAnchor(source, edge.sourceHandle),
        target: handleAnchor(target, edge.targetHandle),
        lane: edge.data?.lane ?? 0,
        parallelIndex: group.indexOf(edge.id),
        parallelCount: group.length,
      }),
    );
  }

  return routes;
}

function checkNoBundleCrossesItself(): void {
  // A hub fanning out above and below, plus a parallel pair, is the shape the
  // whole design exists for.
  const nodes = [makeNode("hub"), ...Array.from({ length: 5 }, (_, i) => makeNode(`t${i}`))];
  const edges = [
    ...Array.from({ length: 5 }, (_, i) => makeEdge(`e${i}`, "hub", `t${i}`, `label ${i}`)),
    makeEdge("dup", "hub", "t0", "second relationship"),
  ];

  const laidOut = applyLayout(nodes, edges);
  const routes = routeEveryEdge(laidOut.nodes, laidOut.edges);
  const bundles = new Map<string, CanvasEdge[]>();

  for (const edge of laidOut.edges) {
    const key = `${edge.source} ${edge.sourceHandle}`;

    bundles.set(key, [...(bundles.get(key) ?? []), edge]);
  }

  for (const [key, members] of bundles) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const left = routes.get(members[i].id);
        const right = routes.get(members[j].id);

        if (!left || !right) {
          continue;
        }

        // Segment 0 is the shared trunk — every member of a bundle runs along
        // it by construction, so it is excluded. Everything after it must be
        // disjoint.
        for (let a = 1; a < left.points.length - 1; a += 1) {
          for (let b = 1; b < right.points.length - 1; b += 1) {
            assert.ok(
              !segmentsIntersect(
                left.points[a],
                left.points[a + 1],
                right.points[b],
                right.points[b + 1],
              ),
              `${key}: ${members[i].id} segment ${a} crosses ${members[j].id} segment ${b}`,
            );
          }
        }
      }
    }
  }
}

function checkNoTwoLabelsCollide(): void {
  // Two sources, not one. The spec promises no two label anchors *within one
  // rank gap* fall within a pill of each other — a rank gap, not a bundle. A
  // single-hub fixture can only ever prove the bundle-local case, and every
  // edge leaving a rank shares that gap: `edgeSplitX` derives its column from
  // the anchor's x, which is identical for every node in a rank, so lane 0 of
  // one bundle lands in the same column as lane 0 of the next.
  const nodes = [
    makeNode("hub"),
    makeNode("other"),
    ...Array.from({ length: 4 }, (_, i) => makeNode(`t${i}`)),
  ];
  const edges = [
    ...Array.from({ length: 4 }, (_, i) => makeEdge(`e${i}`, "hub", `t${i}`, `label ${i}`)),
    makeEdge("p1", "hub", "t0", "one"),
    makeEdge("p2", "hub", "t0", "two"),
    makeEdge("o1", "other", "t1", "from other"),
    makeEdge("o2", "other", "t2", "also other"),
  ];

  const laidOut = applyLayout(nodes, edges);
  const anchors = [...routeEveryEdge(laidOut.nodes, laidOut.edges).entries()];

  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      const [leftId, left] = anchors[i];
      const [rightId, right] = anchors[j];
      const apart =
        Math.abs(left.labelPoint.x - right.labelPoint.x) >= EDGE_LABEL_CLEARANCE.width ||
        Math.abs(left.labelPoint.y - right.labelPoint.y) >= EDGE_LABEL_CLEARANCE.height;

      assert.ok(apart, `${leftId} and ${rightId} put their label pills on top of each other`);
    }
  }
}
```

Add `type RoutePoint` and `type EdgeRoute` to the `../lib/canvas-geometry` import, and call both checks from `main()`.

- [ ] **Step 2: Run the test**

Run: `npx tsx scripts/verify-graph-layout.ts`
Expected: PASS if Tasks 2-6 are correct. **If either fails, that is a real defect in the implementation, not in the test** — the lane ordering exists precisely to make the first one impossible, and `LANE_STEP` / `PARALLEL_STEP` exist precisely to make the second one impossible. Fix `laneOrder`, `edgeSplitX` or the constants; do not relax the assertion.

- [ ] **Step 3: Update the summary line**

Replace the `console.log` in `main()`:

```ts
  console.log(
    "✅ Graph layout: no overlaps, grid-aligned, deterministic, acyclic rank order, handle geometry, edge dedupe, lane ordering, non-crossing bundles, label separation, computed rank gaps and edge cases verified",
  );
```

- [ ] **Step 4: Run the whole suite**

Run: `npm run verify:unit`
Expected: PASS

Run: `npx tsc --noEmit && npx next lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-graph-layout.ts
git commit -m "test: prove bundles never cross themselves and labels never collide"
```

---

### Task 10: Update the context docs

**Files:**
- Modify: `context/ui-context.md`
- Modify: `context/progress-tracker.md`

**Interfaces:** none.

`AGENTS.md` requires `context/progress-tracker.md` to be updated after each meaningful implementation change, and the relevant context file to be updated when implementation changes what it documents.

- [ ] **Step 1: Read what is there**

Run: `grep -n "fan\|edge label\|handle" context/ui-context.md context/progress-tracker.md`

- [ ] **Step 2: Rewrite the affected passages**

In `context/ui-context.md`, replace any description of edges spreading along a node face with the trunk-and-comb model: edges meet a node only at its four handles; edges sharing a handle share a trunk and peel off at staggered columns ordered by vertical travel; parallel edges between one pair bow to their own lanes; a label rides the segment unique to its edge, with drawn line on both sides.

In `context/progress-tracker.md`, add an entry naming the spec (`docs/superpowers/specs/2026-08-23-diagram-edge-branching-design.md`) and what shipped: generated-edge dedupe, persisted lane indices, orthogonal trunk-and-comb routing, parallel bows, computed rank gaps.

- [ ] **Step 3: Commit**

```bash
git add context/ui-context.md context/progress-tracker.md
git commit -m "docs: record the trunk-and-comb edge routing in the context files"
```

---

## Spec Coverage

| Spec section | Task |
| --- | --- |
| The three defects | 7 (fan deleted), 2 + 6 (shared column), 3 (parallels) |
| Decisions taken | 4, 3, 5, 6 |
| Vocabulary (bundle, parallel group, lane, split column) | 5, 7, 2 |
| Constants | 1 |
| Dedupe | 4 |
| Routing — lane assignment | 2, 5 |
| Routing — non-parallel edges | 3, via `orthogonalPath` per the recorded deviation |
| Routing — parallel groups | 3 |
| Label placement | 3, 9 |
| Rank gap sizing and the two-pass dagre | 6 |
| Persistence | 1, 5, 8 |
| Testing | 1, 2, 3, 4, 5, 6, 9 |
| Out of scope | untouched by design |
