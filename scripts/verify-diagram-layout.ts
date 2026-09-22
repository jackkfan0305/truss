import assert from "node:assert/strict";
import { layoutDiagram } from "../lib/diagram-layout";
import { getDiagramEdgeLayout, parseDiagramEdgeLayout } from "../lib/diagram-route";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { CANVAS_NODE_TYPE, CANVAS_EDGE_TYPE, type CanvasNode, type CanvasEdge } from "../types/canvas";

function graph(ids: string[], pairs: string[][]): CanvasSnapshot {
  return {
    nodes: ids.map((id): CanvasNode => ({ id, type: CANVAS_NODE_TYPE, position: { x: 0, y: 0 }, data: { label: id, shape: "rectangle", color: "neutral" } })),
    edges: pairs.map(([source, target], i): CanvasEdge => ({ id: `edge-${i}`, type: CANVAS_EDGE_TYPE, source, target, data: { label: `Sends request ${i}` } })),
  };
}

const ARROW_CLEARANCE = 8;

function samePoint(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The four handle points React Flow puts on a node, from its own geometry. */
function handlePoints(node: CanvasNode): { x: number; y: number }[] {
  const { x, y } = node.position;
  const width = node.width!;
  const height = node.height!;
  return [
    { x: x + width / 2, y },
    { x: x + width, y: y + height / 2 },
    { x: x + width / 2, y: y + height },
    { x, y: y + height / 2 },
  ];
}

interface Box { x: number; y: number; width: number; height: number }
function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function verifyGeometry(snapshot: CanvasSnapshot): void {
  const boxes = snapshot.nodes.map((node): Box => {
    assert(Number.isInteger(node.position.x) && Number.isInteger(node.position.y));
    assert(node.width && node.height);
    return { ...node.position, width: node.width, height: node.height };
  });
  const labels: Box[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert(!intersects(boxes[i], boxes[j]), "nodes overlap");
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  for (const edge of snapshot.edges) {
    const route = getDiagramEdgeLayout(edge, snapshot.nodes);
    assert(route, "generated edge must carry a valid route");
    assert(route.points.length >= 2);
    // A line has to meet a block where the block says it can: the four handle
    // points it shows on hover. Anywhere else and it touches down beside the
    // handle, or, on a diamond or a circle, off the drawn shape altogether.
    const source = byId.get(edge.source)!;
    const target = byId.get(edge.target)!;
    assert(handlePoints(source).some((handle) => samePoint(handle, route.points[0])),
      `edge ${edge.id} leaves ${edge.source} away from a handle`);
    const last = route.points[route.points.length - 1];
    const arrival = handlePoints(target)
      .filter((handle) => handle.x === last.x || handle.y === last.y)
      .sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y))[0];
    assert(arrival, `edge ${edge.id} arrives at ${edge.target} away from a handle`);
    // Backed off by exactly the arrowhead clearance, so the head draws clear of
    // the block rather than half under it.
    assert.equal(Math.round(Math.hypot(arrival.x - last.x, arrival.y - last.y)), ARROW_CLEARANCE,
      `edge ${edge.id} does not leave room for its arrowhead at ${edge.target}`);

    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1];
      const b = route.points[i];
      assert(a.x === b.x || a.y === b.y, "route is orthogonal");
      const segment = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
      snapshot.nodes.forEach((node, index) => {
        if (node.id !== edge.source && node.id !== edge.target) assert(!intersects(segment, boxes[index]), "route crosses an unrelated node");
      });
    }
    if (route.label) {
      const label = { ...route.label, x: route.label.x - route.label.width / 2, y: route.label.y - route.label.height / 2 };
      for (const box of boxes) assert(!intersects(label, box), "label overlaps node");
      for (const other of labels) assert(!intersects(label, other), "labels overlap");
      labels.push(label);
    }
  }
}

async function main() {
  const chain = graph(["client", "service", "store"], [["client", "service"], ["service", "store"]]);
  const before = JSON.stringify(chain);
  const arranged = await layoutDiagram(chain);
  assert.equal(JSON.stringify(chain), before, "layout must not mutate the input");
  assert(arranged.nodes[0].position.x < arranged.nodes[1].position.x);
  assert(arranged.nodes[1].position.x < arranged.nodes[2].position.x);
  verifyGeometry(arranged);

  const branching = graph(["entry", "left", "right", "merge"], [["entry", "left"], ["entry", "right"], ["left", "merge"], ["right", "merge"]]);
  // A labelled cycle through mixed shapes: the back edge has to climb over the
  // blocks between its ends, which a route pinned to handles after the fact
  // does not, and it comes back down through the middle of one.
  const labelledCycle = graph(["queue", "worker", "retry"], [["queue", "worker"], ["worker", "retry"], ["retry", "queue"]]);
  labelledCycle.nodes[0].data = { ...labelledCycle.nodes[0].data, shape: "cylinder" };
  labelledCycle.nodes[1].data = { ...labelledCycle.nodes[1].data, shape: "pill" };
  const fixtures = [branching, labelledCycle, graph(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"]]), graph(["a", "b", "c", "d"], [["a", "b"], ["c", "d"]]), graph(["a", "b"], [["a", "b"], ["b", "a"]])];
  for (const fixture of fixtures) verifyGeometry(await layoutDiagram(fixture));
  const normal = await layoutDiagram(branching);
  const reordered = await layoutDiagram({ nodes: [...branching.nodes].reverse(), edges: [...branching.edges].reverse() });
  const canonical = (snapshot: CanvasSnapshot) => ({ nodes: [...snapshot.nodes].sort((a,b) => a.id.localeCompare(b.id)), edges: [...snapshot.edges].sort((a,b) => a.id.localeCompare(b.id)) });
  assert.deepEqual(canonical(normal), canonical(reordered), "input order must not affect layout");
  // One fan-out per shape: two edges leaving the same side land off its
  // midpoint, where a bounding-box route misses every outline but a rectangle.
  for (const shape of ["rectangle", "diamond", "circle", "pill", "cylinder", "hexagon"] as const) {
    const fan = graph(["entry", "split", "left", "right"], [["entry", "split"], ["split", "left"], ["split", "right"]]);
    fan.nodes[1].data = { ...fan.nodes[1].data, shape };
    verifyGeometry(await layoutDiagram(fan));
  }

  const longLabels = graph(["diagram-root", "database", "external"], [["diagram-root", "database"], ["database", "external"]]);
  longLabels.nodes[0].data = { ...longLabels.nodes[0].data, shape: "diamond", label: "Validate the requested operation before accepting the incoming customer message" };
  longLabels.nodes[1].data = { ...longLabels.nodes[1].data, shape: "cylinder", label: "Store customer records" };
  longLabels.edges[0].data = { label: "A longer relationship label that must wrap safely across several lines" };
  verifyGeometry(await layoutDiagram(longLabels));
  const edge = normal.edges[0];
  assert(getDiagramEdgeLayout(edge, normal.nodes));
  assert.equal(getDiagramEdgeLayout(edge, normal.nodes.map((node, i) => i === 3 ? { ...node, position: { ...node.position, x: node.position.x + 10 } } : node)), null);
  assert.equal(getDiagramEdgeLayout({ ...edge, data: { ...edge.data, label: "changed" } }, normal.nodes), null);
  assert.equal(getDiagramEdgeLayout({ ...edge, sourceHandle: "right" }, normal.nodes), null);
  const route = getDiagramEdgeLayout(edge, normal.nodes)!;
  assert.deepEqual(parseDiagramEdgeLayout(JSON.parse(JSON.stringify(route))), route);
  for (const invalid of [null, {}, { ...route, points: [{ x: Infinity, y: 0 }, { x: 0, y: 0 }] }, { ...route, points: Array(300).fill({ x: 0, y: 0 }) }, { ...route, label: { x: 0, y: 0, width: -1, height: 10 } }, { ...route, geometryKey: "x".repeat(100_001) }]) assert.equal(parseDiagramEdgeLayout(invalid), null);
  assert.deepEqual(await layoutDiagram({ nodes: [], edges: [] }), { nodes: [], edges: [] });
  console.log("Diagram layout verification passed");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
