import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";

import { AiChatComposer } from "../components/chat/ai-chat-composer";
import { DEFAULT_ASSISTANT_MODEL_ID } from "../lib/assistant-models";

async function main() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    FormData: dom.window.FormData,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    MouseEvent: dom.window.MouseEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  dom.window.matchMedia = () => ({
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  // jsdom has no canvas; the Metal FX ring draws nothing here.
  dom.window.HTMLCanvasElement.prototype.getContext = () => null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  const submitted: string[] = [];
  let stops = 0;
  const render = (isWorking: boolean) =>
    root.render(
      <AiChatComposer
        draft="Build a queue"
        isWorking={isWorking}
        modelId={DEFAULT_ASSISTANT_MODEL_ID}
        onDraftChange={() => {}}
        onModelChange={() => {}}
        onSubmit={(text) => { submitted.push(text); }}
        onStop={() => { stops += 1; }}
      />,
    );

  await act(async () => render(false));

  const form = container.querySelector("form");
  const textarea = container.querySelector("textarea");
  assert.ok(form);
  assert.ok(textarea);

  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Enter", shiftKey: true, bubbles: true,
    }));
  });
  assert.deepEqual(submitted, [], "Shift+Enter does not submit");

  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Enter", isComposing: true, bubbles: true,
    }));
  });
  assert.deepEqual(submitted, [], "IME composition does not submit");

  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Enter", bubbles: true,
    }));
  });
  assert.deepEqual(submitted, ["Build a queue"], "Enter sends the current text once");
  assert.equal(textarea.value, "Build a queue", "a failed send can keep the controlled draft visible");

  // While working, Enter sends nothing and the button stops the turn.
  await act(async () => render(true));
  await act(async () => {
    textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "Enter", bubbles: true,
    }));
  });
  assert.deepEqual(submitted, ["Build a queue"], "Enter does not send while a turn runs");
  const stop = container.querySelector<HTMLButtonElement>('button[aria-label="Stop"]');
  assert.ok(stop);
  await act(async () => {
    stop.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  assert.equal(stops, 1, "Stop calls onStop");
  assert.deepEqual(submitted, ["Build a queue"], "Stop does not submit");

  await act(async () => root.unmount());
  dom.window.close();
  console.log("AI Elements composer interaction checks passed");
}

void main();
