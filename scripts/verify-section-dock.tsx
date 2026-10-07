import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";

import { AWS_CATALOG, searchAwsCatalog } from "../lib/aws-catalog";
import {
  AWS_DRAG_MIME,
  CODE_DRAG_MIME,
  buildAwsDragPayload,
  buildCatalogNode,
  buildCodeDragPayload,
  parseAwsDragPayload,
  parseCodeDragPayload,
} from "../lib/canvas-drag";
import { getCodeCatalogEntry } from "../lib/code-catalog";
import { CANVAS_BOUNDARY_TYPE, CANVAS_NODE_TYPE } from "../types/canvas";

assert.deepEqual(parseAwsDragPayload('{"catalogId":"aws-s3"}'), { catalogId: "aws-s3" });
assert.deepEqual(parseAwsDragPayload(JSON.stringify(buildAwsDragPayload("aws-ec2"))), { catalogId: "aws-ec2" });
assert.equal(parseAwsDragPayload('{"catalogId":"https://example.com/icon.svg"}'), null);
assert.equal(parseAwsDragPayload('{"catalogId":"aws-s3","svg":"<svg/>"}'), null);
assert.equal(parseAwsDragPayload('{"catalogId":"missing"}'), null);
assert.equal(parseAwsDragPayload("{}"), null);
assert.equal(parseAwsDragPayload("[]"), null);
assert.equal(parseAwsDragPayload("{"), null);
assert.equal(AWS_DRAG_MIME, "application/x-truss-aws");

assert.deepEqual(parseCodeDragPayload(JSON.stringify(buildCodeDragPayload("code-type"))), { catalogId: "code-type" });
assert.equal(parseCodeDragPayload('{"catalogId":"aws-s3"}'), null, "AWS ids are not code ids");
assert.equal(parseCodeDragPayload('{"catalogId":"code-type","rows":["x"]}'), null);
assert.equal(parseAwsDragPayload('{"catalogId":"code-type"}'), null, "code ids are not AWS ids");
assert.equal(CODE_DRAG_MIME, "application/x-truss-code");

// Dropped and clicked nodes come from the catalog alone.
const typeNode = buildCatalogNode("code-type", { x: 500, y: 300 })!;
assert.equal(typeNode.type, CANVAS_NODE_TYPE);
assert.equal(typeNode.data.kind, "code");
assert.equal(typeNode.data.catalogId, "code-type");
assert.equal(typeNode.data.label, "Type");
assert.equal(typeNode.width, getCodeCatalogEntry("code-type")!.defaultSize.width);
assert.equal(typeNode.height, getCodeCatalogEntry("code-type")!.defaultSize.height);
const classNode = buildCatalogNode("code-class", { x: 0, y: 0 })!;
assert.equal(classNode.type, CANVAS_BOUNDARY_TYPE);
assert.equal(classNode.data.kind, "boundary");
assert.equal(buildCatalogNode("aws-s3", { x: 0, y: 0 })!.data.kind, "aws-service");
assert.equal(buildCatalogNode("missing", { x: 0, y: 0 }), null);

// Service and boundary VPC entries stay distinct.
const vpcs = searchAwsCatalog("vpc");
assert.ok(vpcs.some((entry) => entry.kind === "service"));
assert.ok(vpcs.some((entry) => entry.kind === "boundary"));
assert.equal(searchAwsCatalog("").length, AWS_CATALOG.length);

// pretendToBeVisual gives jsdom the animation frames liquid-gooey schedules.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  requestAnimationFrame: dom.window.requestAnimationFrame,
  cancelAnimationFrame: dom.window.cancelAnimationFrame,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  MutationObserver: dom.window.MutationObserver,
  SVGElement: dom.window.SVGElement,
  // jsdom has no layout, so there is nothing for liquid-gooey to observe.
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  IS_REACT_ACT_ENVIRONMENT: true,
});
const added: string[] = [];
const addedCode: string[] = [];


function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

async function main() {
  // React decides whether `input` events work when it loads, so it loads after jsdom.
  const { createRoot } = await import("react-dom/client");
  const { SectionDock } = await import("../components/canvas/section-dock");
  const root = createRoot(document.getElementById("root")!);
  await act(async () =>
    root.render(<SectionDock onAddShape={() => {}} onAddAws={(id) => added.push(id)} onAddCode={(id) => addedCode.push(id)} />),
  );
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="AWS items"]')!;
  const region = () => document.querySelector<HTMLElement>('[role="region"]')!;
  // Closed, the panel layer stays mounted for its blur-out but is inert (jsdom has no `inert` property).
  assert.ok(region().hasAttribute("inert"));

  // Opening the section hides the tabs and activates its panel.
  await act(async () => trigger.click());
  assert.ok(!region().hasAttribute("inert"));
  assert.ok(trigger.closest("[inert]"));
  assert.equal(region().getAttribute("aria-label"), "AWS items");
  const panel = document.querySelector("#aws-panel")!;

  // Items are native, draggable buttons whose description is reachable by name.
  const s3 = [...panel.querySelectorAll("button")].find((b) => b.textContent?.includes("Amazon S3"))!;
  assert.ok(s3.draggable);
  assert.ok(document.getElementById(s3.getAttribute("aria-describedby")!)?.textContent);
  await act(async () => s3.click());
  assert.deepEqual(added, ["aws-s3"]);

  // Category chips filter; "All" restores.
  const chip = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Categories"] button')].find((b) => b.textContent === name)!;
  await act(async () => chip("Boundaries").click());
  assert.equal(chip("Boundaries").getAttribute("aria-pressed"), "true");
  assert.ok(!document.querySelector("#aws-panel")!.textContent?.includes("Amazon S3"));
  await act(async () => chip("All").click());

  // Aliases search; no match shows the empty state.
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search AWS items"]')!;
  await act(async () => typeInto(input, "ec2"));
  assert.ok(document.querySelector("#aws-panel")!.textContent?.includes("Amazon EC2"));
  assert.ok(!document.querySelector("#aws-panel")!.textContent?.includes("Amazon S3"));
  await act(async () => typeInto(input, "zzzz-nothing"));
  assert.ok(region().textContent?.includes("No AWS items match your search"));

  // Escape closes and restores focus to the section's tab.
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.ok(region().hasAttribute("inert"));
  assert.equal(document.activeElement, trigger);

  // Code tab comes after AWS, shows seven entries, has no category chips.
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Item sections"] button')].map((b) => b.getAttribute("aria-label"));
  assert.deepEqual(tabs, ["Basic shapes", "AWS items", "Code items"]);
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Code items"]')!.click());
  const codePanel = document.querySelector("#code-panel")!;
  assert.equal(codePanel.querySelectorAll("button").length, 7);
  assert.equal(document.querySelector('[aria-label="Categories"]'), null);

  // Click adds; tiles are drag sources carrying only the id.
  const typeTile = [...codePanel.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Type"))!;
  assert.ok(typeTile.draggable);
  await act(async () => typeTile.click());
  assert.deepEqual(addedCode, ["code-type"]);
  const { handleCodeDragStart } = await import("../components/canvas/code-panel");
  const data = new Map<string, string>();
  handleCodeDragStart(
    { dataTransfer: { setData: (k: string, v: string) => data.set(k, v), effectAllowed: "" } } as never,
    "code-type",
  );
  assert.deepEqual(JSON.parse(data.get(CODE_DRAG_MIME)!), { catalogId: "code-type" });

  // Search by alias.
  const codeSearch = document.querySelector<HTMLInputElement>('input[aria-label="Search Code items"]')!;
  await act(async () => typeInto(codeSearch, "struct"));
  assert.ok(document.querySelector("#code-panel")!.textContent?.includes("Type"));
  assert.ok(!document.querySelector("#code-panel")!.textContent?.includes("Enum"));

  await act(async () => root.unmount());
  console.log("AWS picker checks passed");
}

void main();
