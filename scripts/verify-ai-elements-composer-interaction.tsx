import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act } from "react";

import { AiChatComposer } from "../components/chat/ai-chat-composer";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
} from "../types/tasks";

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
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  const submitted: string[] = [];

  await act(async () => {
    root.render(
      <AiChatComposer
        draft="Build a queue"
        isDisabled={false}
        isWorking={false}
        modelId={DEFAULT_AI_DESIGN_MODEL_ID}
        thinkingLevel={DEFAULT_AI_THINKING_LEVEL}
        onDraftChange={() => {}}
        onModelChange={() => {}}
        onThinkingLevelChange={() => {}}
        onSubmit={async (text) => { submitted.push(text); }}
      />,
    );
  });

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

  await act(async () => root.unmount());
  dom.window.close();
  console.log("AI Elements composer interaction checks passed");
}

void main();
