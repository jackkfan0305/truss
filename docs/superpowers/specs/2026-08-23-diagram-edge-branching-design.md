# Diagram edge branching

Generated architecture diagrams are hard to read because every edge label in a
rank gap lands in the same column, and edges leave a node from scattered points
along its face rather than from its handles. This replaces the face fan with an
explicit branch: one trunk out of the handle, lanes peeling off it at staggered
columns, each lane carrying its own label and its own arrowhead.

## The three defects

Measured against `components/canvas/canvas-edge.tsx` and
`lib/canvas-geometry.ts` as they stand:

1. **Labels share a column.** `edgeTurnX()` returns `sourceX + RANK_GAP / 2`
   for every side-to-side edge, and the renderer sets `labelX = turnLabelX`.
   Every label in one rank gap therefore stacks on a single vertical line, and
   long multi-rank edges draw their vertical runs down that same line.
2. **Edges leave a node from arbitrary points.** `fanOffset()` spreads
   endpoints along the node face by `±FAN_STEP`. Connections should meet a node
   at one of its four handles, not at four different heights on one side.
3. **Parallel edges are indistinguishable.** Four edges between the same pair on
   the same row draw four identical horizontal lines; today only the face fan
   separates them.

## Decisions taken

- **Dedupe** identical `source + target + label` triples rather than render
  them apart.
- **Trunk + comb**: a shared stub out of the handle point, then lanes at
  staggered split columns. Each lane keeps its own label and arrowhead.
- **Lane order is computed at layout and persisted**, so dragging a node never
  reshuffles lanes or makes labels jump.
- **Rank gaps grow to fit the label pills.** Spacing is generous rather than
  compressed; a wider diagram is preferable to a cramped one.

## Vocabulary

- **Bundle** — the edges sharing one `(sourceNode, sourceHandle)` pair. A
  bundle is what branches.
- **Parallel group** — the edges sharing one
  `(source, target, sourceHandle, targetHandle)` tuple, after dedupe.
- **Lane** — an edge's index within its bundle. Decides its split column.
- **Split column** (`splitX`) — the x at which an edge leaves the trunk and
  turns toward its target.

## Constants

All in `types/canvas.ts` beside `EDGE_LABEL_CLEARANCE`, which stays
`{ width: 160, height: 24 }`.

| Name | Value | Meaning |
| --- | --- | --- |
| `LABEL_GAP` | `40` | Clear space a label pill keeps on every side. |
| `TRUNK_MIN` | `40` | Length of the shared stub before the first split. |
| `LANE_STEP` | `EDGE_LABEL_CLEARANCE.width + LABEL_GAP` (200) | X distance between successive split columns. |
| `PARALLEL_STEP` | `EDGE_LABEL_CLEARANCE.height + MIN_NODE_GAP` (64) | Y distance between the mid-lanes of one parallel group. |
| `CORNER_RADIUS` | `8` | Corner rounding. Passed to `getSmoothStepPath` as `borderRadius` as well, so both route builders round identically rather than one inheriting React Flow's default. |

`LANE_STEP` is a pill width plus a gap because two lanes can carry labels at
nearly the same y: lane order is by `|Δy|`, so targets at `+100` and `+90`
produce label anchors five units apart vertically and one `LANE_STEP` apart
horizontally. A step narrower than the pill would overlap them.

`PARALLEL_STEP` is a pill height plus a gap for the mirror-image reason: a
parallel group stacks its labels vertically at roughly one x.

`FAN_STEP` and `FAN_FACE_MARGIN` are deleted.

## Dedupe

`applyLayout` drops every edge whose `source`, `target` and `data.label` all
match an earlier edge, keeping the first occurrence. It runs before the graph
is handed to dagre, so the layout never reserves rank space for a duplicate.

Dropping an edge is a real deletion, so this applies only on the generated
path — the import and diagram-skill flows that call `applyLayout` on
model-authored content. A user-authored canvas save never runs it. Two edges
that differ in label are kept; only an exact triple match is a duplicate.

## Routing

Every edge anchors at its handle point exactly. `fanOffset()` and
`fanSlotIndex()` are removed.

Lanes, split columns and parallel bows apply to **side-to-side edges only** —
those leaving a left or right handle and entering the other. That is the same
`isSideToSide` gate the renderer already applies to the corridor turn, and for
the same reason: a split column is a claim about the node-free band between two
ranks, and an edge on a top or bottom handle is not crossing that band. Edges
through a vertical handle keep React Flow's default midpoint turn and midpoint
label, and are excluded from bundles when lanes are assigned.

### Lane assignment

Within a bundle, edges sort by `|targetAnchorY − sourceAnchorY|` **descending**,
and take lane `0, 1, 2, …` in that order. Ties break on target x, then on edge
id, so the result is deterministic.

The ordering is not cosmetic. Lane `i` splits at

```
splitX = anchorX ± (TRUNK_MIN + i * LANE_STEP)
```

with the sign following the flow direction. Because the furthest-travelling
edge splits first, no lane's vertical run can cross another lane's horizontal
run: a later lane travels a shorter vertical distance, so its run never reaches
the y at which an earlier lane is already running horizontally. Bundle
self-crossings become impossible rather than merely uncommon, which is what
makes the invariant worth testing directly.

Sorting by target y instead would not have this property — two targets on the
same side of the source still cross.

The lane index is written to `data.lane` during `applyLayout` and persisted.
An edge that arrives without a `lane` — a hand-drawn connection that never went
through layout — is assigned one at render time by sorting the laneless members
of its bundle by edge id. Deterministic, and it costs no persistence.

### Non-parallel edges

Three segments, drawn by the existing `getSmoothStepPath` with `centerX` set to
the edge's own `splitX`:

```
anchor ──trunk──▶ splitX ──vertical──▶ targetY ──▶ target
```

The shared horizontal run from the handle to the first split *is* the trunk. It
needs no geometry of its own; it is what lanes overlapping on their first
segment look like.

### Parallel groups

A parallel group on the same row has no vertical run to stagger, so a split
column alone cannot separate its members: `getSmoothStepPath` would draw
identical overlapping lines. Members therefore bow to their own mid-lane:

```
laneY = targetAnchorY + (p − (n − 1) / 2) * PARALLEL_STEP
```

for parallel index `p` in a group of `n`, and the route becomes five segments:

```
anchor ─▶ splitX ─▶ laneY ─▶ mergeX ─▶ targetAnchorY ─▶ target
```

where `mergeX = targetAnchorX ∓ TRUNK_MIN`. Corners round at `CORNER_RADIUS`.

`getSmoothStepPath` takes a single `centerX` and cannot express five segments,
so this needs a small orthogonal path builder — `orthogonalPath(points)` in
`lib/canvas-geometry.ts`, pure, taking a list of corner points and emitting an
SVG `d` string with rounded corners. Non-parallel edges keep
`getSmoothStepPath`.

A parallel group spanning several ranks draws its mid-lane run across the
intervening columns, offset by up to `PARALLEL_STEP` from where a single edge
would have run. This is the behaviour multi-rank edges already have today,
shifted; it is not made worse and is out of scope here.

## Label placement

A label sits at the midpoint of the segment that is unique to its edge.

| Case | Anchor | Why it cannot collide |
| --- | --- | --- |
| Non-parallel, `|Δy| > EDGE_LABEL_CLEARANCE.height` | Midpoint of the vertical run, at `splitX` | `splitX` is unique within the bundle, and `LANE_STEP` exceeds the pill width |
| Parallel group member | Midpoint of the mid-lane horizontal run | `laneY` is unique within the group, and `PARALLEL_STEP` exceeds the pill height |
| Non-parallel with no usable vertical run | On the horizontal at `splitX`, offset by half a pill width | `splitX` is unique within the bundle |

Every anchor has drawn line on both sides of the pill. That is the attribution
cue the current rendering lacks: today a label sits at the corner where its
edge leaves, with nothing to its left, so a column of pills reads as a list
rather than as four separate lines.

Arrowheads need no change — `markerEnd` is already per-edge.

## Rank gap sizing

`RANK_GAP` stays exported from `lib/canvas-geometry.ts` at its current value
(280) but changes meaning: it becomes the *floor* for dagre's `ranksep` rather
than the value itself. `ranksep` is computed from the widest bundle in the
graph:

```
ranksep = TRUNK_MIN
        + maxLaneIndex * LANE_STEP
        + EDGE_LABEL_CLEARANCE.width / 2
        + LABEL_GAP
```

floored at `RANK_GAP` so a graph of single-edge bundles lays out exactly as it
does today.

### The coordinate budget, and why layout runs twice

`lib/agent-graph.ts` represents coordinates only within ±10,000, and a node
outside that range projects as opaque — invisible to an agent reading the
canvas back. Centred on the origin by `boundingCenter`, the budget is a total
width of 18,920.

A large `ranksep` and a long chain cannot both fit. They also never co-occur: a
chain has bundles of size one, so its computed `ranksep` is small, and a graph
with wide bundles has few ranks. The cap only has to hold in the cases where
both are large, so it is computed exactly rather than guessed:

1. Run dagre with the floor `ranksep` (280).
2. Read the resulting rank count and total node width, and derive lanes from
   the handles that pass-1 geometry implies.
3. Compute `ranksep` from the widest bundle, then clamp it to
   `(18920 − totalNodeWidth) / (rankCount − 1)`. A single-rank graph has no
   rank gap to size, so the clamp is skipped when `rankCount < 2`.
4. Run dagre again with the clamped value.

Rank *assignment* does not depend on `ranksep` — it only scales coordinates —
so pass 2 places nodes in the same ranks as pass 1 and the handles stay
stable. Handles and lanes are recomputed from the final geometry regardless.

Two dagre runs on a graph capped at 40 nodes is not a cost worth avoiding.

When the clamp bites, `LANE_STEP` compresses evenly across the lanes rather
than lanes spilling past the corridor — the same give-up-evenly behaviour
`fanOffset` had for a crowded face.

## Persistence

`CanvasEdgeData` gains `lane?: number`.

`parseEdge` in `lib/canvas-snapshot.ts` whitelists it: kept when it is a finite
non-negative integer, dropped otherwise. A dropped `lane` degrades to the
id-sort fallback rather than failing.

`lane` is derived from geometry, so it stays out of the compact agent-graph
contract in `lib/agent-graph.ts` — agents do not set it, and `applyLayout`
stamps it after any import. It is likewise excluded from `graphsAreEqual`,
which compares authored content; a lane change is a layout result, not an
edit, and including it would make an identical graph compare unequal after a
relayout.

## Files

| File | Change |
| --- | --- |
| `types/canvas.ts` | `CanvasEdgeData.lane?: number`; `LABEL_GAP`, `TRUNK_MIN`, `LANE_STEP`, `PARALLEL_STEP`, `CORNER_RADIUS` |
| `lib/canvas-geometry.ts` | Delete `FAN_STEP`, `FAN_FACE_MARGIN`, `fanOffset`, `fanSlotIndex`, `edgeTurnX`. Add `laneOrder`, `edgeSplitX`, `parallelLaneY`, `orthogonalPath`, `edgeLabelPoint` |
| `lib/graph-layout.ts` | Dedupe pass; two-pass dagre with computed `ranksep`; lane assignment stamped onto edges |
| `lib/canvas-snapshot.ts` | `parseEdge` whitelists `lane` |
| `components/canvas/canvas-edge.tsx` | Read `data.lane` and parallel-group size from the store; route through `orthogonalPath` for parallel members, `getSmoothStepPath` with the staggered `centerX` otherwise; label from `edgeLabelPoint` |
| `scripts/verify-graph-layout.ts` | New checks, below |

## Testing

`scripts/verify-graph-layout.ts` stays the harness: pure, no room, no model, no
browser. New checks:

- **Dedupe.** Identical triples collapse to one; edges differing only in label
  survive; a user-path layout call does not dedupe.
- **No bundle self-crossing.** For each bundle, emit every member's segment
  list and test each pair for intersection geometrically. The invariant is
  checked from the drawn geometry, not asserted from the ordering that
  produced it — otherwise the test only restates the sort.
- **Label separation.** No two label anchors within one rank gap fall within a
  pill width and pill height of each other.
- **Lane persistence.** `lane` survives `parseEdge`; a non-integer, negative or
  `NaN` lane is dropped and the id-sort fallback takes over.
- **Coordinate budget.** A 40-node chain and a wide fan-out both stay inside
  ±9,460 after the computed `ranksep`.
- **Determinism and no mutation.** The existing checks extend to cover the
  dedupe and lane fields.

Then a visual pass on the diagram that prompted this — the one where
`Identity & Sessions` runs four edges into PostgreSQL and
`Provider Connections & Credentials` runs three.

## Out of scope

- Global crossing minimisation between different bundles. Lane ordering
  removes self-crossings; two unrelated bundles may still cross, and a router
  that prevented that is a much larger piece of work with no evidence yet that
  it is needed.
- Rerouting around nodes. Multi-rank edges cross intervening columns today and
  continue to.
- Edge label wrapping or truncation.
