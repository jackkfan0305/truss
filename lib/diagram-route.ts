import { NODE_DEFAULT_SIZES, type CanvasEdge, type CanvasNode } from "@/types/canvas";

export interface DiagramPoint { x: number; y: number }
export interface DiagramLabel extends DiagramPoint { width: number; height: number }

/** Label coordinates refer to its center, like React Flow's label renderer. */
export interface DiagramEdgeLayout {
  version: 1;
  points: DiagramPoint[];
  label: DiagramLabel | null;
  geometryKey: string;
  source: string;
  target: string;
  text: string;
}

export const DIAGRAM_LABEL_WIDTH = 160;
export const DIAGRAM_LABEL_LINE_HEIGHT = 16;
export const DIAGRAM_LABEL_PADDING = 12;
const MAX_COORDINATE = 1_000_000;
const MAX_ROUTE_POINTS = 256;
const MAX_GEOMETRY_KEY_LENGTH = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}
function parsePoint(value: unknown): DiagramPoint | null {
  return isRecord(value) && boundedNumber(value.x) && boundedNumber(value.y)
    ? { x: value.x, y: value.y } : null;
}

/** Rebuild untrusted geometry before it reaches SVG attributes or inline styles. */
export function parseDiagramEdgeLayout(value: unknown): DiagramEdgeLayout | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.points)
    || value.points.length < 2 || value.points.length > MAX_ROUTE_POINTS
    || typeof value.geometryKey !== "string" || !value.geometryKey.length
    || value.geometryKey.length > MAX_GEOMETRY_KEY_LENGTH
    || typeof value.source !== "string" || !value.source.length || value.source.length > 512
    || typeof value.target !== "string" || !value.target.length || value.target.length > 512
    || typeof value.text !== "string" || value.text.length > 1000) return null;

  const points: DiagramPoint[] = [];
  for (const item of value.points) {
    const point = parsePoint(item);
    if (!point) return null;
    points.push(point);
  }
  let label: DiagramLabel | null = null;
  if (value.label !== null) {
    const point = parsePoint(value.label);
    if (!point || !isRecord(value.label) || !boundedNumber(value.label.width)
      || !boundedNumber(value.label.height) || value.label.width <= 0
      || value.label.height <= 0 || value.label.width > 1000 || value.label.height > 1000) return null;
    label = { ...point, width: value.label.width, height: value.label.height };
  }
  return { version: 1, points, label, geometryKey: value.geometryKey, source: value.source, target: value.target, text: value.text };
}

/** Every node matters because moving an unrelated node can obstruct an edge. */
export function diagramGeometryKey(nodes: readonly CanvasNode[]): string {
  return JSON.stringify([...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((node) => {
    const size = NODE_DEFAULT_SIZES[node.data.shape];
    return [node.id, node.position.x, node.position.y,
      node.width ?? node.measured?.width ?? size.width,
      node.height ?? node.measured?.height ?? size.height, node.data.shape];
  }));
}

export function getDiagramEdgeLayout(
  edge: CanvasEdge,
  nodes: readonly CanvasNode[],
  geometryKey: string = diagramGeometryKey(nodes),
): DiagramEdgeLayout | null {
  if (edge.sourceHandle || edge.targetHandle) return null;
  const data: unknown = edge.data;
  const layout = parseDiagramEdgeLayout(isRecord(data) ? data.layout : undefined);
  if (!layout || layout.source !== edge.source || layout.target !== edge.target
    || layout.text !== (edge.data?.label ?? "")
    || layout.geometryKey !== geometryKey) return null;
  return layout;
}
