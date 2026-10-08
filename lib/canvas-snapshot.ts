import { sortParentsBeforeChildren } from "@/lib/canvas-hierarchy";
import { parseDiagramEdgeLayout } from "@/lib/diagram-route";

/**
 * The canvas persistence contract (21-canvas-autosave).
 *
 * Vercel Blob holds the canvas JSON, Prisma holds only the URL — see the storage
 * model in `context/architecture-context.md`. This module is the boundary
 * between the two: it defines what a stored snapshot may contain and refuses
 * anything else, so a malformed or hostile body never reaches Blob storage and a
 * corrupted blob never reaches a canvas.
 *
 * Free of React and Prisma imports on purpose, so `scripts/verify-canvas.ts` can
 * exercise it directly.
 */

import {
  CANVAS_BOUNDARY_TYPE,
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  CANVAS_NOTE_TYPE,
  DEFAULT_NODE_COLOR,
  DEFAULT_NOTE_COLOR,
  MAX_NOTE_TEXT_LENGTH,
  DEFAULT_NODE_SHAPE,
  NODE_COLORS,
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
  type CodeSource,
  type NodeColor,
  type NodeShape,
} from "@/types/canvas";
import { isNoteColor } from "@/lib/canvas-note";
import {
  MAX_CODE_ROW_LENGTH,
  MAX_CODE_ROWS,
  MAX_CODE_SIGNATURE_LENGTH,
  MAX_CODE_SUMMARY_LENGTH,
  MAX_CODE_PSEUDOCODE_LINES,
  MAX_CODE_PSEUDOCODE_LINE_LENGTH,
  MAX_CODE_SOURCE_PATH_LENGTH,
  MAX_CODE_SOURCE_URL_LENGTH,
} from "@/lib/agent-graph-schema";
import { isGithubSourceUrl } from "@/lib/code-catalog";

export interface CanvasSnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * A ceiling on a single snapshot, not a product limit — the body is
 * authenticated but still user-controlled, and each save is a paid write to
 * Blob storage. Far above any diagram a person builds by hand; if AI generation
 * ever approaches it, raise it deliberately rather than removing the guard.
 */
export const MAX_SNAPSHOT_NODES = 2000;
export const MAX_SNAPSHOT_EDGES = 4000;

/**
 * The stable prefix for a diagram's snapshots. Each write adds a random
 * suffix, so a pointer never names a file that a later write overwrote.
 */
export function canvasBlobPath(diagramId: string): string {
  return `canvas/${diagramId}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects `NaN` and `Infinity` as well as non-numbers — both break layout. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The first line of `value`, capped at `maximumLength`. */
function firstLine(value: string, maximumLength: number): string {
  return value.split(/[\r\n]/)[0].slice(0, maximumLength);
}

function parseLine(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return firstLine(value.trim(), maximumLength).trim() || undefined;
}

function parseRows(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .flatMap((row) => {
      const line = typeof row === "string" ? firstLine(row.trim(), MAX_CODE_ROW_LENGTH).trim() : "";
      return line ? [line] : [];
    })
    .slice(0, MAX_CODE_ROWS);
  return rows.length ? rows : undefined;
}

/** A stored URL is re-checked: data written before the rule, or by hand, must not become a link. */
function parseSource(value: unknown): CodeSource | undefined {
  if (!isRecord(value) || typeof value.path !== "string") return undefined;
  const path = parseLine(value.path, MAX_CODE_SOURCE_PATH_LENGTH);
  if (!path) return undefined;
  return {
    path,
    ...(Number.isInteger(value.line) && (value.line as number) > 0 ? { line: value.line as number } : {}),
    ...(isGithubSourceUrl(value.url) && value.url.length <= MAX_CODE_SOURCE_URL_LENGTH ? { url: value.url } : {}),
  };
}

/** Like rows, but keeps leading spaces: they are the pseudocode's indentation. */
function parsePseudocode(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines = value
    .flatMap((line) => {
      const kept = typeof line === "string" ? firstLine(line, MAX_CODE_PSEUDOCODE_LINE_LENGTH).trimEnd() : "";
      return kept.trim() ? [kept] : [];
    })
    .slice(0, MAX_CODE_PSEUDOCODE_LINES);
  return lines.length ? lines : undefined;
}

function codeFields(data: Record<string, unknown>) {
  const signature = parseLine(data.signature, MAX_CODE_SIGNATURE_LENGTH);
  const summary = parseLine(data.summary, MAX_CODE_SUMMARY_LENGTH);
  const pseudocode = parsePseudocode(data.pseudocode);
  const rows = parseRows(data.rows);
  const source = parseSource(data.source);
  return { ...(signature ? { signature } : {}), ...(summary ? { summary } : {}), ...(pseudocode ? { pseudocode } : {}), ...(rows ? { rows } : {}), ...(source ? { source } : {}) };
}

function parseNode(value: unknown): CanvasNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, position, width, height, parentId, data } = value;

  if (typeof id !== "string" || !id) {
    return null;
  }

  if (
    !isRecord(position) ||
    !isFiniteNumber(position.x) ||
    !isFiniteNumber(position.y)
  ) {
    return null;
  }

  const nodeData = isRecord(data) ? data : {};
  const color = nodeData.color;
  const shape = nodeData.shape;
  const kind = nodeData.kind;
  const catalogId = nodeData.catalogId;

  const isNote = kind === "note";
  const nodeType = isNote ? CANVAS_NOTE_TYPE : kind === "boundary" ? CANVAS_BOUNDARY_TYPE : CANVAS_NODE_TYPE;
  const label = typeof nodeData.label === "string" ? nodeData.label : "";

  return {
    id,
    // Rebuilt field by field rather than spread: an unknown key from a stored
    // blob would otherwise flow straight into React Flow's node store.
    type: nodeType,
    position: { x: position.x, y: position.y },
    ...(isFiniteNumber(width) ? { width } : {}),
    ...(isFiniteNumber(height) ? { height } : {}),
    // Notes float free: a stored parent is dropped rather than trusted.
    ...(!isNote && typeof parentId === "string" && parentId ? { parentId } : {}),
    data: {
      // An over-long note is cut rather than failing the whole snapshot.
      label: isNote ? label.slice(0, MAX_NOTE_TEXT_LENGTH) : label,
      // An unknown colour or shape degrades to the default instead of failing
      // the whole snapshot — one retired palette key must not cost the diagram.
      color: isNodeColor(color) ? color : DEFAULT_NODE_COLOR,
      shape: isNodeShape(shape) ? shape : DEFAULT_NODE_SHAPE,
      ...(kind === "generic" || kind === "aws-service" || kind === "boundary" || kind === "note" || kind === "code" ? { kind } : {}),
      ...(isNote ? { noteColor: isNoteColor(nodeData.noteColor) ? nodeData.noteColor : DEFAULT_NOTE_COLOR } : {}),
      ...(typeof catalogId === "string" && catalogId ? { catalogId } : {}),
      ...(kind === "code" ? codeFields(nodeData) : {}),
    },
  };
}

function isNodeColor(value: unknown): value is NodeColor {
  return typeof value === "string" && value in NODE_COLORS;
}

function isNodeShape(value: unknown): value is NodeShape {
  return NODE_SHAPES.includes(value as NodeShape);
}

function parseEdge(value: unknown, nodeIds: ReadonlySet<string>): CanvasEdge | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, source, target, sourceHandle, targetHandle, data } = value;

  if (typeof id !== "string" || !id) {
    return null;
  }

  if (typeof source !== "string" || typeof target !== "string") {
    return null;
  }

  // An edge to a node that is not in the snapshot renders as nothing and keeps
  // a dangling reference alive across every future save.
  if (!nodeIds.has(source) || !nodeIds.has(target)) {
    return null;
  }

  const edgeData = isRecord(data) ? data : {};
  const layout = parseDiagramEdgeLayout(edgeData.layout);

  return {
    id,
    type: CANVAS_EDGE_TYPE,
    source,
    target,
    ...(typeof sourceHandle === "string" ? { sourceHandle } : {}),
    ...(typeof targetHandle === "string" ? { targetHandle } : {}),
    data: {
      label: typeof edgeData.label === "string" ? edgeData.label : "",
      ...(layout ? { layout } : {}),
      ...(edgeData.kind === "calls" || edgeData.kind === "uses" ? { kind: edgeData.kind } : {}),
    },
    // Reapplied from the constants rather than trusted from the blob: they are
    // the same for every edge, so storing them would only create a way for a
    // stored value to drift from the palette or to carry arbitrary CSS.
    style: CANVAS_EDGE_STYLE,
    markerEnd: CANVAS_EDGE_MARKER,
  };
}

/**
 * Validates a snapshot from an untrusted source — a request body on the way in,
 * or stored blob JSON on the way out. Returns `null` when the shape is wrong.
 *
 * Individual malformed *entries* are dropped rather than failing the whole
 * snapshot: a single bad node should not make an otherwise good diagram
 * unloadable. A body that is not a snapshot at all is still rejected outright.
 */
export function parseCanvasSnapshot(value: unknown): CanvasSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    return null;
  }

  if (
    value.nodes.length > MAX_SNAPSHOT_NODES ||
    value.edges.length > MAX_SNAPSHOT_EDGES
  ) {
    return null;
  }

  const nodes: CanvasNode[] = [];
  const seenNodeIds = new Set<string>();

  for (const candidate of value.nodes) {
    const node = parseNode(candidate);

    // Duplicate IDs would render one node and make the other uneditable.
    if (node && !seenNodeIds.has(node.id)) {
      seenNodeIds.add(node.id);
      nodes.push(node);
    }
  }

  // Notes cannot be connected, so an edge touching one drops like a dangling edge.
  const connectableIds = new Set(nodes.flatMap((node) => (node.type === CANVAS_NOTE_TYPE ? [] : [node.id])));
  const edges: CanvasEdge[] = [];
  const seenEdgeIds = new Set<string>();

  for (const candidate of value.edges) {
    const edge = parseEdge(candidate, connectableIds);

    if (edge && !seenEdgeIds.has(edge.id)) {
      seenEdgeIds.add(edge.id);
      edges.push(edge);
    }
  }

  return { nodes, edges };
}

/**
 * What actually gets written to Blob storage. Round-tripped through the same
 * parser as a read, so a save can never store something a load would reject.
 */
export function serializeCanvasSnapshot(snapshot: CanvasSnapshot): string {
  return JSON.stringify({ nodes: snapshot.nodes, edges: snapshot.edges });
}

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

  if (version === null || !snapshot) return null;

  // Old flat snapshots load tolerantly; a write must carry a sound hierarchy.
  const byId = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const parentsOk = snapshot.nodes.every(
    (n) => !n.parentId || byId.get(n.parentId)?.type === CANVAS_BOUNDARY_TYPE,
  );
  if (!parentsOk) return null;
  try {
    sortParentsBeforeChildren(snapshot.nodes);
  } catch {
    return null;
  }

  return { version, snapshot };
}

/**
 * The snapshot exactly as it would be stored. React Flow adds `measured`,
 * `selected` and `dragging` to nodes it renders; comparing raw state would
 * treat opening an editor as an edit.
 */
export function canonicalCanvasPayload(snapshot: CanvasSnapshot): string {
  return serializeCanvasSnapshot(parseCanvasSnapshot(snapshot) ?? snapshot);
}
