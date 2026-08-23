import type { XYPosition } from "@xyflow/react";

import {
  EDGE_LABEL_CLEARANCE,
  NODE_DEFAULT_SIZES,
  TRUNK_MIN,
  LANE_STEP,
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
 * The empty corridor the layout leaves between one rank of nodes and the next,
 * in flow units. Dagre reads it as `ranksep` — the literal edge-to-edge
 * distance between ranks — and `CanvasEdgeRenderer` reads it to find the
 * node-free channel to turn a long edge in.
 *
 * It holds an edge label's pill (`EDGE_LABEL_CLEARANCE.width`) plus clear space
 * on both sides of it, so a label sits in the corridor rather than against
 * whichever node is closer. The ceiling is the compact agent graph contract
 * (`lib/agent-graph.ts`), which only represents coordinates in ±10,000: the
 * widest graph it allows is a 40-node chain, which at default node sizes comes
 * to `40 * 200 + 39 * 280 = 18,920` and so ±9,460 once `boundingCenter` puts it
 * either side of the origin. A node outside that range projects as *opaque* —
 * invisible to an agent reading the canvas back — so this cannot grow much
 * further without trading legibility for reachability.
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

/**
 * Where an edge makes its vertical turn, and so where its label sits.
 *
 * Left to itself `getSmoothStepPath` turns at the midpoint between the two
 * endpoints. For a hop between adjacent ranks that midpoint is the middle of
 * the corridor the layout left empty, which is right — but an edge spanning
 * several ranks has its midpoint *inside* an intervening rank, so the vertical
 * run is drawn straight down a column of nodes and the label pill lands on top
 * of one of them. That is most of what makes a generated diagram look tangled.
 *
 * Turning half a `RANK_GAP` past the source keeps the turn in the corridor
 * immediately after the source's own rank, which `lib/graph-layout.ts`
 * guarantees is clear of nodes however many ranks the edge goes on to cross.
 * Adjacent ranks are exactly the case where that is already the midpoint, so
 * the short hops are unchanged.
 *
 * `undefined` — meaning "use the midpoint" — covers the two cases the corridor
 * argument does not: a same-rank edge running up or down its column, and a
 * hand-dragged node sitting closer than a rank gap, where turning a fixed
 * distance out could overshoot the target.
 */
export function edgeTurnX(sourceX: number, targetX: number): number | undefined {
  const span = targetX - sourceX;

  if (Math.abs(span) < RANK_GAP) {
    return undefined;
  }

  return sourceX + Math.sign(span) * (RANK_GAP / 2);
}

/**
 * The gap the fan aims to leave between two edges meeting the same handle.
 *
 * A label rides its own line, so what two neighbouring edges need at a shared
 * handle is the room their two pills need in order not to overlap — the pill's
 * height, not a hairline that only keeps the strokes apart. This is the whole
 * of "an edge label takes up room too" as far as the fan is concerned.
 */
export const FAN_STEP = EDGE_LABEL_CLEARANCE.height;

/**
 * Keeps the outermost edge of a fan off the corner of the node's face, so a
 * crowded handle still reads as edges meeting a side rather than clipping the
 * node's rounding.
 */
const FAN_FACE_MARGIN = 10;

/**
 * How far along its face an edge sits, given its slot among the edges sharing
 * one handle. Signed, measured from the handle's own centre point, along the
 * face: y for a left or right handle, x for a top or bottom one.
 *
 * The fan aims for `FAN_STEP` between neighbours and gives the room up evenly
 * when the face is too short for that — five edges on an 80-unit face take 15
 * apiece rather than spilling past the node's corners. Squeezed still reads;
 * overshot reads as edges anchored to thin air beside the node.
 */
export function fanOffset(
  index: number,
  count: number,
  faceLength: number
): number {
  if (count < 2) {
    return 0;
  }

  const usable = Math.max(0, faceLength - FAN_FACE_MARGIN * 2);
  const step = Math.min(FAN_STEP, usable / (count - 1));

  return (index - (count - 1) / 2) * step;
}

/**
 * Orders the edges meeting one handle and returns where `edgeId` sits in that
 * order, or `0` if it is not among them.
 *
 * Sorted by edge id, which is arbitrary but *fixed*. The tempting alternative
 * is to sort by where each edge's far end sits, so the fan comes out in the
 * order the lines leave and never crosses itself just off the node. That reads
 * better at rest and badly in the hand: the comparator is recomputed from live
 * positions, so dragging one node past another flips it and two edges swap
 * slots in a single jump of twice `FAN_STEP`, taking their labels with them.
 * Lines that snap rather than slide past each other are harder to follow than
 * lines that cross, so the order stays put and the crossing is allowed.
 *
 * Being independent of geometry also means the fan needs no recomputing while
 * a node is being dragged.
 */
export function fanSlotIndex(
  memberIds: readonly string[],
  edgeId: string
): number {
  const index = [...memberIds].sort().indexOf(edgeId);

  return index === -1 ? 0 : index;
}
