import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { act } from "react"

import { ChatEntry } from "../components/editor/chat-entry"
import type { ChatMessage } from "../lib/ai-chat"

async function main() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" })
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    IS_REACT_ACT_ENVIRONMENT: true,
  })
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  })
  dom.window.matchMedia = () => ({ matches: false }) as MediaQueryList

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
  const message = (content: string, phase: "running" | "complete"): ChatMessage => ({
    id: "chat-answer",
    role: "assistant",
    senderId: "truss-ai",
    senderName: "Truss",
    content,
    sentAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    run: { runId: "run-1", promptMessageId: "chat-prompt", phase, activity: [] },
  })
  const answer = "The gateway routes requests to three services."

  await act(async () => root.render(<ChatEntry message={message("", "running")} isOwn={false} />))
  assert.ok(container.querySelector(".wrap-anywhere"), "a running answer keeps its renderer mounted before text arrives")

  await act(async () => root.render(<ChatEntry message={message(answer, "complete")} isOwn={false} />))
  assert.notEqual(container.textContent?.includes(answer), true, "the final snapshot does not jump to the full answer")
  for (let index = 0; index < 20; index += 1) await advanceFrame()
  assert.match(container.textContent ?? "", /gateway routes requests to three services/)

  await act(async () => root.unmount())
  const historicalRoot = createRoot(container)
  await act(async () => historicalRoot.render(<ChatEntry message={message(answer, "complete")} isOwn={false} />))
  assert.match(container.textContent ?? "", /gateway routes requests to three services/, "saved answers render immediately")
  await act(async () => historicalRoot.unmount())
  dom.window.close()
  console.log("AI answer stream checks passed")
}

void main()
