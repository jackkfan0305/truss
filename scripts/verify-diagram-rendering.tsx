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
import { CanvasEdgeRenderer, USES_EDGE_DASH } from "../components/canvas/canvas-edge";
import { activeCodeBlock, arrowCardSide, isInsideModule, quietCardSide, setHoveredCodeBlock, setPinnedCodeBlock } from "../components/canvas/code-hover";
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

async function checkCodeRendering() {
  const codeNode = (id: string, data: Partial<CanvasNode["data"]>, size = { width: 220, height: 150 }): CanvasNode => ({
    id, type: CANVAS_NODE_TYPE, position: { x: 0, y: 0 }, ...size,
    data: { label: id, color: "neutral", shape: "rectangle", kind: "code", catalogId: "code-function", ...data },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const flowRoot = createRoot(host);
  const nodeTypes = { [CANVAS_NODE_TYPE]: CanvasNodeRenderer, [CANVAS_BOUNDARY_TYPE]: CanvasBoundaryRenderer };
  const show = async (flowNodes: CanvasNode[]) => {
    await act(async () => {
      flowRoot.render(<div style={{ width: 1200, height: 800 }}><ReactFlow nodes={flowNodes} edges={[]} nodeTypes={nodeTypes} /></div>);
    });
  };
  const rendered = (id: string) => host.querySelector<HTMLElement>(`[data-id="${id}"]`)!;

  // Signature, rows and a GitHub source link.
  await show([codeNode("reserve", {
    signature: "reserve(sku, qty)", summary: "Holds stock for an order.", rows: ["items: OrderItem[]"],
    source: { path: "lib/inventory.ts", line: 42, url: "https://github.com/o/r/blob/abc/lib/inventory.ts#L42" },
  })]);
  const linked = rendered("reserve").innerHTML;
  assert.match(linked, /Holds stock for an order\./);
  assert.doesNotMatch(linked, /reserve\(sku, qty\)/, "the signature shows on hover, not on the block");
  assert.match(linked, /items: OrderItem\[\]/);
  assert.match(linked, /href="https:\/\/github.com\/o\/r\/blob\/abc\/lib\/inventory.ts#L42"/);
  assert.match(linked, /target="_blank"/);
  assert.match(linked, /rel="noopener noreferrer"/);
  assert.match(linked, /lib\/inventory.ts:42/);

  // A URL that slipped past every other check still never becomes an anchor.
  await show([codeNode("x", { source: { path: "a.ts", url: "javascript:alert(1)" } })]);
  const hostileLink = rendered("x").innerHTML;
  assert.doesNotMatch(hostileLink, /<a /);
  assert.doesNotMatch(hostileLink, /javascript:/);
  assert.ok([...rendered("x").querySelectorAll("button")].some((b) => b.textContent === "a.ts"));

  // Copy fallback.
  const copied: string[] = [];
  Object.defineProperty(dom.window.navigator, "clipboard", { value: { writeText: async (text: string) => { copied.push(text); } }, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  await show([codeNode("y", { source: { path: "lib/a.ts", line: 3 } })]);
  const copyButton = [...rendered("y").querySelectorAll("button")].find((b) => b.textContent === "lib/a.ts:3")!;
  await act(async () => { copyButton.click(); });
  assert.deepEqual(copied, ["lib/a.ts:3"]);
  assert.ok(rendered("y").textContent?.includes("Copied"));

  // Entry marker and code boundary.
  await show([codeNode("main", { catalogId: "code-entry" }, { width: 220, height: 72 })]);
  assert.ok(rendered("main").querySelector("[data-code-entry]"));
  const classBoundary: CanvasNode = { id: "inv", type: CANVAS_BOUNDARY_TYPE, position: { x: 0, y: 0 }, width: 380, height: 240,
    data: { label: "Inventory", color: "neutral", shape: "rectangle", kind: "boundary", catalogId: "code-class" } };
  await show([classBoundary]);
  assert.ok(rendered("inv").querySelector("[data-code-boundary]"));
  assert.equal(rendered("inv").querySelector(".border-dashed"), null);
  assert.equal(rendered("inv").textContent, "Inventory");
  await show([awsNode("vpc", "boundary-vpc")]);
  assert.ok(rendered("vpc").querySelector(".border-dashed"), "AWS boundaries unchanged");
  await act(async () => { flowRoot.unmount(); });

  // Edge kinds: only `uses` is dashed.
  const dash = async (kind?: "calls" | "uses") => {
    await act(async () => { root.render(<Diagram currentNodes={nodes} currentEdge={{ ...edge, data: { label: "", ...(kind ? { kind } : {}) } }} />); });
    return rootElement.querySelector<SVGPathElement>(".react-flow__edge-path")!.style.strokeDasharray;
  };
  assert.equal(await dash("uses"), USES_EDGE_DASH);
  assert.equal(await dash("calls"), "");
  assert.equal(await dash(), "");
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
  await checkCodeRendering();
  await act(async () => { root.unmount(); });
  dom.window.close();
  console.log("Diagram rendering verification passed.");
}
void main();

// The pseudocode card opens away from the blocks its lit edges lead to.
{
  const block = { x: 0, y: 0, width: 100, height: 50 };
  const at = (x: number, y: number) => ({ x, y, width: 100, height: 50 });
  assert.equal(quietCardSide(block, []), "right");
  assert.equal(quietCardSide(block, [at(300, 0), at(300, 200)]), "left", "callees on the right");
  assert.equal(quietCardSide(block, [at(-300, 0)]), "right", "a caller on the left");
  assert.equal(quietCardSide(block, [at(300, 0), at(-300, 0), at(0, 200)]), "top", "both sides and below");
}

// Module hover keeps blocks nested at any depth lit, and nothing outside.
{
  const parents: Record<string, string | undefined> = { method: "class", class: "module", other: undefined };
  const parentOf = (id: string) => parents[id];
  assert.ok(isInsideModule("method", "module", parentOf), "nested two deep");
  assert.ok(!isInsideModule("other", "module", parentOf), "outside");
  assert.ok(!isInsideModule("module", "class", parentOf), "a parent is not inside its child");
}

// Pinning: keys act on the hovered card first, then the pinned one; arrows map to sides.
{
  setPinnedCodeBlock("a");
  assert.equal(activeCodeBlock(), "a", "the pinned card is active with nothing hovered");
  setHoveredCodeBlock("b", true);
  assert.equal(activeCodeBlock(), "b", "a hovered card takes the keys");
  setHoveredCodeBlock("b", false);
  assert.equal(activeCodeBlock(), "a");
  setPinnedCodeBlock(null);
  assert.equal(activeCodeBlock(), null);
  assert.deepEqual(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "x"].map(arrowCardSide), ["left", "right", "top", "bottom", null]);
}
