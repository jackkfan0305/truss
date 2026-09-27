import assert from "node:assert/strict";

import { JSDOM } from "jsdom";
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { useCanvasAutosave, type CanvasAutosave } from "../hooks/use-canvas-autosave";

const dom = new JSDOM("<!doctype html><div id=root></div>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const puts: { version: number; canvas: unknown }[] = [];
globalThis.fetch = (async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { version: number; canvas: unknown };
  puts.push(body);
  return Response.json({ version: body.version + 1, savedAt: new Date().toISOString() });
}) as typeof fetch;

const A = JSON.stringify({ nodes: [{ id: "a" }], edges: [] });
const B = JSON.stringify({ nodes: [{ id: "b" }], edges: [] });
const C = JSON.stringify({ nodes: [{ id: "c" }], edges: [] });

function ignoreStatus() {}

let autosave!: CanvasAutosave;
let setPayload!: (payload: string) => void;

function expose(nextAutosave: CanvasAutosave, nextSetPayload: (payload: string) => void) {
  autosave = nextAutosave;
  setPayload = nextSetPayload;
}

function Harness({
  expose,
}: {
  expose: (autosave: CanvasAutosave, setPayload: (payload: string) => void) => void;
}) {
  const [payload, setPayload] = useState(A);
  const autosave = useCanvasAutosave("diagram", payload, 1, ignoreStatus);

  useEffect(() => expose(autosave, setPayload), [autosave, expose]);

  return null;
}

async function main() {
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(
      <Harness expose={expose} />,
    ));

  // An agent edit that only updates existing items replays nothing, so `run`
  // resolves before React commits the restored snapshot. The flush after the
  // pause must not submit the pre-agent canvas on top of the adopted version.
  await act(async () => {
    autosave.adopt(B, 2);
    setPayload(B);
    await autosave.whilePaused(async () => {});
  });
  assert.deepEqual(puts, [], "an empty replay must not write the stale canvas back");

  // A local edit made during the replay is still flushed once the pause ends.
  await act(async () => {
    autosave.adopt(B, 3);
    await autosave.whilePaused(async () => setPayload(C));
  });
  assert.equal(puts.length, 1, "a local edit made while paused is flushed");
  assert.deepEqual(puts[0], { version: 3, canvas: JSON.parse(C) });

  await act(async () => root.unmount());
  console.log("verify-canvas-autosave: ok");
}

main().catch((error: unknown) => {
  console.error("Canvas autosave verification failed");
  console.error(error);
  process.exitCode = 1;
});
