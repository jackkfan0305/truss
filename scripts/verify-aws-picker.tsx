import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, useState } from "react";

import { AWS_CATALOG, searchAwsCatalog } from "../lib/aws-catalog";
import { AWS_DRAG_MIME, buildAwsDragPayload, parseAwsDragPayload } from "../lib/canvas-drag";

assert.deepEqual(parseAwsDragPayload('{"catalogId":"aws-s3"}'), { catalogId: "aws-s3" });
assert.deepEqual(parseAwsDragPayload(JSON.stringify(buildAwsDragPayload("aws-ec2"))), { catalogId: "aws-ec2" });
assert.equal(parseAwsDragPayload('{"catalogId":"https://example.com/icon.svg"}'), null);
assert.equal(parseAwsDragPayload('{"catalogId":"aws-s3","svg":"<svg/>"}'), null);
assert.equal(parseAwsDragPayload('{"catalogId":"missing"}'), null);
assert.equal(parseAwsDragPayload("{}"), null);
assert.equal(parseAwsDragPayload("[]"), null);
assert.equal(parseAwsDragPayload("{"), null);
assert.equal(AWS_DRAG_MIME, "application/x-truss-aws");

// Service and boundary VPC entries stay distinct.
const vpcs = searchAwsCatalog("vpc");
assert.ok(vpcs.some((entry) => entry.kind === "service"));
assert.ok(vpcs.some((entry) => entry.kind === "boundary"));
assert.equal(searchAwsCatalog("").length, AWS_CATALOG.length);

const dom = new JSDOM('<!doctype html><div id="root"></div>');
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const added: string[] = [];

function Harness({ AwsPanel }: { AwsPanel: typeof import("../components/canvas/aws-panel").AwsPanel }) {
  const [open, setOpen] = useState(false);
  return <AwsPanel open={open} onOpenChange={setOpen} onAddEntry={(id) => added.push(id)} />;
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

async function main() {
  // React decides whether `input` events work when it loads, so it loads after jsdom.
  const { createRoot } = await import("react-dom/client");
  const { AwsPanel } = await import("../components/canvas/aws-panel");
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<Harness AwsPanel={AwsPanel} />));
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="AWS items"]')!;
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.querySelector("#aws-panel"), null);

  await act(async () => trigger.click());
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  const panel = document.querySelector("#aws-panel")!;
  assert.deepEqual(
    [...panel.querySelectorAll("section > h3")].map((h) => h.textContent),
    ["Services", "Boundaries"],
  );

  // Items are native, draggable buttons whose description is reachable by name.
  const s3 = [...panel.querySelectorAll("button")].find((b) => b.textContent?.includes("Amazon S3"))!;
  assert.ok(s3.draggable);
  assert.ok(document.getElementById(s3.getAttribute("aria-describedby")!)?.textContent);
  await act(async () => s3.click());
  assert.deepEqual(added, ["aws-s3"]);

  // Aliases search; no match shows the empty state.
  const input = panel.querySelector<HTMLInputElement>('input[aria-label="Search AWS items"]')!;
  await act(async () => typeInto(input, "ec2"));
  assert.ok(panel.textContent?.includes("Amazon EC2"));
  assert.ok(!panel.textContent?.includes("Amazon S3"));
  await act(async () => typeInto(input, "zzzz-nothing"));
  assert.ok(panel.textContent?.includes("No AWS items match your search"));

  // Escape closes and restores focus to the trigger.
  await act(async () => {
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  assert.equal(document.querySelector("#aws-panel"), null);
  assert.equal(document.activeElement, trigger);

  await act(async () => root.unmount());
  console.log("AWS picker checks passed");
}

void main();
