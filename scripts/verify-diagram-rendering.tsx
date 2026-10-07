import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Position, ReactFlow, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { renderToStaticMarkup } from "react-dom/server";
import { AwsIcon } from "../components/canvas/aws-icon";
import { CanvasBoundaryRenderer } from "../components/canvas/canvas-boundary";
import { CanvasNodeRenderer } from "../components/canvas/canvas-node";
import { getAwsCatalogEntry } from "../lib/aws-catalog";
import { awsNode } from "./testing/aws-diagram-fixtures";
import { useEffect } from "react";
import { CanvasEdgeRenderer } from "../components/canvas/canvas-edge";
import { CanvasEdgeRouteProvider } from "../components/canvas/canvas-edge-routes";
import { parseCanvasSnapshot, serializeCanvasSnapshot } from "../lib/canvas-snapshot";
import { diagramGeometryKey } from "../lib/diagram-route";
import { CANVAS_BOUNDARY_TYPE, CANVAS_NODE_TYPE, type CanvasNode, type CanvasEdge } from "../types/canvas";

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
async function checkAwsRendering() {
  const s3 = getAwsCatalogEntry("aws-s3")!;
  assert.ok(renderToStaticMarkup(<AwsIcon catalogId="aws-s3" />).includes(s3.iconPath));
  assert.ok(renderToStaticMarkup(<AwsIcon catalogId="missing" />).includes("Unknown AWS item"));

  Object.assign(globalThis, {
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    DOMMatrixReadOnly: dom.window.DOMMatrixReadOnly ?? class { m22 = 1; constructor() {} },
  });
  const flowNodes: CanvasNode[] = [
    { ...awsNode("vpc", "boundary-vpc"), data: { ...awsNode("vpc", "boundary-vpc").data, label: "Main VPC" } },
    { ...awsNode("bucket", "aws-s3", "vpc"), data: { ...awsNode("bucket", "aws-s3").data, label: "Uploads" } },
    { id: "plain", type: CANVAS_NODE_TYPE, position: { x: 900, y: 0 }, width: 180, height: 80, data: { label: "Plain", color: "neutral", shape: "rectangle" } },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const flowRoot = createRoot(host);
  await act(async () => {
    flowRoot.render(<div style={{ width: 1200, height: 800 }}><ReactFlow nodes={flowNodes} edges={[]} nodeTypes={{ [CANVAS_NODE_TYPE]: CanvasNodeRenderer, [CANVAS_BOUNDARY_TYPE]: CanvasBoundaryRenderer }} /></div>);
  });
  const rendered = (id: string) => host.querySelector<HTMLElement>(`[data-id="${id}"]`)!;

  // Boundary: dashed outline, named title, icon, no colour toolbar or fill.
  const boundary = rendered("vpc");
  assert.ok(boundary.querySelector(".border-dashed"), "boundary has a dashed outline");
  assert.equal(boundary.textContent, "Main VPC");
  assert.ok(boundary.querySelector(`img[src="${getAwsCatalogEntry("boundary-vpc")!.iconPath}"]`));
  // Service: catalog icon, editable label, rectangular frame.
  const service = rendered("bucket");
  assert.equal(service.textContent, "Uploads");
  const icon = service.querySelector("img")!;
  assert.equal(icon.getAttribute("src"), s3.iconPath);
  // Generic nodes keep the shape renderer.
  assert.equal(rendered("plain").textContent, "Plain");
  assert.equal(rendered("plain").querySelector("img"), null);

  // A load failure keeps the catalog name readable and leaves identity alone.
  await act(async () => { icon.dispatchEvent(new dom.window.Event("error")); });
  assert.ok(rendered("bucket").textContent?.includes(s3.name));
  assert.equal(rendered("bucket").querySelector("img"), null);
  await act(async () => { flowRoot.unmount(); });
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
  await checkAwsRendering();
  await act(async () => { root.unmount(); });
  dom.window.close();
  console.log("Diagram rendering verification passed.");
}
void main();
