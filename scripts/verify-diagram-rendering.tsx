import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Position, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { useEffect } from "react";
import { CanvasEdgeRenderer } from "../components/canvas/canvas-edge";
import { CanvasEdgeRouteProvider } from "../components/canvas/canvas-edge-routes";
import { parseCanvasSnapshot, serializeCanvasSnapshot } from "../lib/canvas-snapshot";
import { diagramGeometryKey } from "../lib/diagram-route";
import { CANVAS_NODE_TYPE, type CanvasNode, type CanvasEdge } from "../types/canvas";

const nodes: CanvasNode[] = [
  { id: "a", type: CANVAS_NODE_TYPE, position: { x: 0, y: 0 }, width: 180, height: 80, data: { label: "Start", color: "neutral", shape: "rectangle" } },
  { id: "b", type: CANVAS_NODE_TYPE, position: { x: 480, y: 0 }, width: 180, height: 80, data: { label: "Finish", color: "neutral", shape: "rectangle" } },
];
const edge: CanvasEdge = {
  id: "ab", source: "a", target: "b", data: {
    label: "A longer relationship that must wrap without clipping",
    layout: { version: 1, points: [{ x: 180, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 100 }, { x: 480, y: 100 }], label: { x: 320, y: 50, width: 160, height: 54 }, geometryKey: diagramGeometryKey(nodes), source: "a", target: "b", text: "A longer relationship that must wrap without clipping" },
  },
};
const snapshot = parseCanvasSnapshot(JSON.parse(serializeCanvasSnapshot({ nodes, edges: [edge] })));
assert.ok(snapshot);
assert.deepEqual(snapshot.edges[0].data?.layout, edge.data?.layout);
const malformed = parseCanvasSnapshot({ nodes, edges: [{ ...edge, data: { ...edge.data, layout: { ...edge.data?.layout, points: [{ x: Infinity, y: 0 }] } } }] });
assert.equal(malformed?.edges[0].data?.layout, undefined);

const dom = new JSDOM('<!doctype html><div id="root"></div><div id="labels"></div>');
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const rootElement = document.getElementById("root")!;
const labelElement = document.querySelector<HTMLDivElement>("#labels")!;
const root = createRoot(rootElement);
function Portal() {
  const store = useStoreApi();
  useEffect(() => { store.setState({ domNode: labelElement }); }, [store]);
  return null;
}
// React Flow's label portal resolves this class under domNode.
labelElement.innerHTML = '<div class="react-flow__edgelabel-renderer"></div>';
function Diagram({ currentNodes, currentEdge = edge }: { currentNodes: CanvasNode[]; currentEdge?: CanvasEdge }) {
  return <ReactFlowProvider><Portal /><CanvasEdgeRouteProvider nodes={currentNodes} edges={[currentEdge, { id: "parallel", source: "a", target: "b", data: { label: "Other relationship" } }]}><svg><CanvasEdgeRenderer id="ab" source="a" target="b" sourceX={180} sourceY={40} targetX={480} targetY={40} sourcePosition={Position.Right} targetPosition={Position.Left} data={currentEdge.data} selected={false} animated={false} selectable deletable /></svg></CanvasEdgeRouteProvider></ReactFlowProvider>;
}
async function main() {
  await act(async () => { root.render(<Diagram currentNodes={nodes} />); });
  assert.equal(rootElement.querySelector(".react-flow__edge-path")?.getAttribute("d"), "M 180 40 L 300 40 L 300 100 L 480 100");
  const label = labelElement.querySelector("span")!;
  assert.ok(label, "Saved label must render through the React Flow portal");
  assert.equal(label.textContent, edge.data?.label);
  assert.equal(label.style.width, "160px");
  assert.equal(label.style.minHeight, "54px");
  assert.ok(label.classList.contains("break-words"));
  assert.ok(!label.className.includes("truncate"));
  assert.equal(label.parentElement?.style.transform, "translate(-50%, -50%) translate(320px, 50px)");
  await act(async () => { root.render(<Diagram currentNodes={nodes.map((node) => node.id === "b" ? { ...node, position: { x: 500, y: 200 } } : node)} />); });
  assert.notEqual(rootElement.querySelector(".react-flow__edge-path")?.getAttribute("d"), "M 180 40 L 300 40 L 300 100 L 480 100");
  assert.notEqual(labelElement.querySelector("span")?.parentElement?.style.transform, "translate(-50%, -50%) translate(320px, 50px)");
  await act(async () => { root.render(<Diagram currentNodes={nodes} currentEdge={{ ...edge, data: { ...edge.data, label: "Changed" } }} />); });
  assert.notEqual(rootElement.querySelector(".react-flow__edge-path")?.getAttribute("d"), "M 180 40 L 300 40 L 300 100 L 480 100");
  await act(async () => { root.unmount(); });
  dom.window.close();
  console.log("Diagram rendering verification passed.");
}
void main();
