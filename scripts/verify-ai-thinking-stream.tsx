import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { act } from "react"

import { AiRunTasks } from "../components/editor/ai-run-tasks"
import type { AiRunTasksState } from "../components/editor/ai-run-tasks"

async function main() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  })
  dom.window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList
  dom.window.HTMLCanvasElement.prototype.getContext = () => null

  let nextFrameId = 0
  const frames = new Map<number, FrameRequestCallback>()
  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrameId
    frames.set(id, callback)
    return id
  }
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id) }
  const advanceFrame = async () => {
    const pending = [...frames.values()]
    frames.clear()
    await act(async () => {
      for (const callback of pending) callback(performance.now())
    })
  }

  const { createRoot } = await import("react-dom/client")
  const container = dom.window.document.getElementById("root")
  assert.ok(container)
  const root = createRoot(container)
  const state = (text: string): AiRunTasksState => ({
    id: "prompt-1",
    runId: "run-1",
    phase: "running",
    activity: [
      { id: "step", type: "step", text: "Designing" },
      { id: "reasoning", type: "reasoning", text },
    ],
  })

  await act(async () => root.render(<AiRunTasks state={{ ...state(""), activity: [] }} />))
  assert.match(container.textContent ?? "", /Thinking/)
  assert.ok(container.querySelector('canvas[role="img"]'), "the waiting label has a thinking orb")

  await act(async () => root.render(<AiRunTasks state={state("I found three services.")} />))
  assert.match(container.innerHTML, /Thinking/)
  assert.match(container.innerHTML, /data-open="" data-slot="collapsible" class="not-prose/)
  assert.ok(container.querySelector('button canvas[role="img"]'), "live reasoning has a thinking orb beside its label")
  await advanceFrame()
  assert.match(container.textContent ?? "", /I found/, "the first streaming frame reveals text")

  await act(async () => root.render(<AiRunTasks state={state("I found three services. A queue will connect them.")} />))
  assert.match(container.textContent ?? "", /I found/, "a new chunk does not rewind visible words")
  for (let index = 0; index < 20; index += 1) await advanceFrame()
  assert.match(container.textContent ?? "", /A queue will connect them/, "later words stream into the open disclosure")

  await act(async () => root.unmount())
  dom.window.close()
  console.log("AI thinking text stream checks passed")
}

void main()
