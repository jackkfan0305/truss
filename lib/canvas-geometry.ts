import type { XYPosition } from "@xyflow/react";

import {
  EDGE_LABEL_CLEARANCE,
  NODE_DEFAULT_SIZES,
  TRUNK_MIN,
  LANE_STEP,
  PARALLEL_STEP,
  CORNER_RADIUS,
  type CanvasNode,
  type NodeSize,
} from "@/types/canvas";

/**
 * The geometry primitives every layout consumer shares.
 *
 * These lived in `lib/design-plan.ts` while it was the only thing placing
 * nodes. `lib/graph-layout.ts` now owns placement and `design-plan` calls into
 * it, so leaving them there made the two modules import each other — a real
 * cycle, not a stylistic one: whichever loaded second saw an uninitialised
 * `MIN_NODE_GAP` and threw at module scope. Owning them here breaks it at the
 * root, so both sides can use plain static imports.
 *
 * Pure and DOM-free, like both of its consumers.
 */

/** Positions snap to this, matching the canvas `Background` dot grid. */
export const LAYOUT_GRID = 20;

/** The clear space every generated node keeps from its neighbours, in flow units. */
export const MIN_NODE_GAP = 40;

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
 * single-turn bundle avoids crossing itself. Lane `i` turns at `TRUNK_MIN + i * LANE_STEP`
 * past the anchor, so a later lane both turns further out *and* travels less
 * far vertically — its run can never reach the y at which an earlier lane is
 * already running horizontally. Sorting by target y instead would not have
 * this property: two targets on the same side of the source still cross.
 *
 * Direction is deliberately ignored. An up-edge and a down-edge leave the
 * trunk into opposite half-planes and cannot cross whatever order they take.
 *
 * Parallel groups (multiple edges sharing both source and target) are proven not
 * to cross only at exactly 2 members. Groups of 3 or more draw overlapping lines
 * because all members share one merge column and placement mechanics break down.
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

export interface Box extends NodeSize, XYPosition {}

/**
 * A node's occupied rectangle.
 *
 * The layout and everything reasoning about spacing resolve a node's size the
 * same way — through here — so nothing ends up reasoning about dimensions the
 * canvas does not actually give the node.
 */
export function toBox(node: CanvasNode): Box {
  const fallback = NODE_DEFAULT_SIZES[node.data.shape] ?? NODE_DEFAULT_SIZES.rectangle;

  return {
    x: node.position.x,
    y: node.position.y,
    width: node.width ?? fallback.width,
    height: node.height ?? fallback.height,
  };
}

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
 * The `count` mid-lane rows a parallel group spreads across, as signed
 * offsets from the target row (not yet added to `targetY`).
 *
 * Symmetric about zero for an even count. An odd count is shifted by half a
 * step instead: the unshifted symmetric spread always puts one row at offset
 * zero — exactly the target's own row — and that member's route collapses
 * through `dropCollinear` into a single straight segment running the full
 * width of the bow, overlapping every other member's final approach. Shifting
 * clears every row of the target's own y at the cost of the spread no longer
 * straddling it evenly, which is the trade the task accepted.
 */
function parallelRowOffsets(count: number): number[] {
  const shift = count % 2 === 1 ? 0.5 : 0;

  return Array.from(
    { length: count },
    (_, index) => (index - (count - 1) / 2 + shift) * PARALLEL_STEP
  );
}

/**
 * The y a parallel group's member runs at across the corridor.
 *
 * Parallel edges between the same pair on the same row have no vertical run to
 * stagger — a split column alone would draw them as one overlapping line — so
 * they bow to their own lane instead, symmetrically about the y a single edge
 * would have taken.
 *
 * `laneRank` is this member's position when the group is sorted by lane
 * ascending (0 = the smallest lane, which splits closest to the source) — not
 * an arbitrary id-sort index. The row set is the same offsets either way;
 * what changed is which member gets which row. This pairing mitigates
 * crossings in the group, but only at exactly 2 members are row crossings
 * proven impossible (see `buildEdgeRoute`'s doc comment): a shared merge
 * column and this pairing prevent them there, but a staggered merge column —
 * tried and rejected, see that comment — does not extend the guarantee to
 * groups of 3 or more.
 */
export function parallelLaneY(
  sourceY: number,
  targetY: number,
  laneRank: number,
  count: number
): number {
  const rows = parallelRowOffsets(count).map((offset) => targetY + offset);

  // Descending by distance from the source: the member whose lane splits
  // earliest (laneRank 0, closest to the trunk) takes the row FARTHEST from
  // the source. `Array.prototype.sort` is stable, so a genuine tie (the
  // source sitting exactly level with the target) keeps the rows in their
  // original, deterministic order rather than an arbitrary one.
  const byDistanceFromSource = [...rows].sort(
    (a, b) => Math.abs(b - sourceY) - Math.abs(a - sourceY)
  );

  return byDistanceFromSource[laneRank];
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
 *
 * `parallelIndex` is the member's rank within its group sorted by lane
 * ascending, not by id — see `parallelLaneY`'s `laneRank`. Pairing the lane
 * that splits closest to the source with the row farthest from the source
 * mirrors why `laneOrder` sorts a bundle by descending `|deltaY|`. This
 * pairing keeps row crossings minimal: at exactly 2 members, rows do not
 * cross; at 3 or more, the shared merge column below causes crossings.
 *
 * A merge column staggered per row — mirroring `edgeSplitX`'s split-column
 * stagger, keyed on distance from the target row instead of the source —
 * was tried and rejected. It does stop a farther row's merge-vertical from
 * crossing a nearer row's bow (the defect a shared column causes): giving
 * the row nearest the target the largest offset means its merge column
 * always sits farthest out, so a farther row's own (smaller-offset, nearer)
 * vertical never reaches into a nearer row's horizontal run, and a nearer
 * row's vertical only spans its own row down to the target row, which a
 * farther row's row value sits outside of. But every member of a parallel
 * group still shares one physical target point, and staggering the merge
 * column means their final approach segments — (mergeX, target.y) to target
 * — start at different x on the same y line and so nest, which is a
 * genuine, differently-shaped overlap the harness correctly flags; two
 * members sharing an offset (the same absolute row distance) draw the same
 * final approach and are fine, but any two at different distances are not.
 * Measured with the real route builder across counts 2..6: the row shift
 * below already cuts crossings at every odd count with no cost anywhere;
 * adding the merge stagger on top made every count from 3 up WORSE, not
 * better (see `.superpowers/sdd/2026-08-23-diagram-edge-branching/
 * parallel-edges-report.md`). Shipping a change that measurably worsens the
 * defect it was meant to fix is not the right call, so only the row shift
 * below is in the routing; the merge column stays a single value.
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
    const laneY = parallelLaneY(source.y, target.y, parallelIndex, parallelCount);
    // Never past the target. A merge column beyond the approach point makes the
    // route overshoot and double back on itself, which is worse than the thing
    // the pill-width floor was trying to buy. When the endpoints are too close
    // to leave a full pill's width of bow, the pill overhangs its own segment
    // instead — it stays centred on the drawn line either way, which is the
    // invariant that actually matters.
    const approach = target.x - direction * TRUNK_MIN;
    const mergeX = direction * (approach - splitX) > 0 ? approach : splitX;

    // Anchored to its own splitX, not the bow's midpoint: the midpoint of
    // `splitX..mergeX` only moves by half of whatever `splitX` moved, since
    // `mergeX` is the same shared merge column for every member of the group.
    // Lanes a full `LANE_STEP` apart would then anchor labels only half a
    // `LANE_STEP` apart — under the pill width — so this matches the
    // non-parallel branch below instead: the pill's near edge sits on the
    // split column, which inherits the full lane spacing. Clamped to the
    // bow's own span so a bow shorter than a pill still anchors on drawn
    // line — the pill itself is allowed to overhang past `mergeX`, the same
    // tradeoff the `mergeX` clamp above already accepted, but the anchor
    // point is not.
    const bowLow = Math.min(splitX, mergeX);
    const bowHigh = Math.max(splitX, mergeX);
    const labelX = Math.min(
      Math.max(splitX + (direction * EDGE_LABEL_CLEARANCE.width) / 2, bowLow),
      bowHigh
    );

    return {
      points: dropCollinear([
        source,
        { x: splitX, y: source.y },
        { x: splitX, y: laneY },
        { x: mergeX, y: laneY },
        { x: mergeX, y: target.y },
        target,
      ]),
      labelPoint: { x: labelX, y: laneY },
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
