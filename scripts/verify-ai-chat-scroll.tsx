import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { act } from "react"

import { AiChatTranscript } from "../components/editor/ai-chat-transcript"
import type { ChatMessage } from "../components/editor/chat-entry"

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
  // Reduced motion: follow snaps to the bottom instead of easing over frames.
  dom.window.matchMedia = () => ({ matches: true }) as MediaQueryList
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub })

  const { createRoot } = await import("react-dom/client")
  const container = dom.window.document.getElementById("root")
  assert.ok(container)
  const root = createRoot(container)
  const message = (id: string, sentAt: number): ChatMessage => ({
    id,
    role: "user",
    content: id,
    sentAt,
  })
  let messages = [message("first", 1)]
  const render = () => (
    <AiChatTranscript messages={messages} emptyState={<p>Empty</p>} />
  )

  await act(async () => root.render(<AiChatTranscript messages={[]} emptyState={<p>Empty</p>} />))
  assert.match(container.textContent ?? "", /Empty/, "no messages shows the empty state")

  await act(async () => root.render(render()))
  const viewport = container.querySelector<HTMLElement>('[role="log"]')
  assert.ok(viewport)
  let height = 600
  Object.defineProperty(viewport, "scrollHeight", { get: () => height })
  Object.defineProperty(viewport, "clientHeight", { get: () => 200 })

  messages = [...messages, message("second", 2)]
  await act(async () => root.render(render()))
  assert.equal(viewport.scrollTop, 600, "new lines follow to the bottom")

  viewport.scrollTop = 120
  await act(async () => viewport.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    key: "PageUp",
  })))
  height = 900
  messages = [...messages, message("third", 3)]
  await act(async () => root.render(render()))
  assert.equal(viewport.scrollTop, 120, "PageUp releases automatic follow and keeps the reader's place")
  const jump = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Jump to latest")
  )
  assert.ok(jump, "a released follow offers a jump to the latest line")

  viewport.scrollTo = (options?: ScrollToOptions | number) => {
    if (typeof options === "object" && options.top !== undefined) viewport.scrollTop = options.top
  }
  await act(async () => jump.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })))
  assert.equal(viewport.scrollTop, 900, "Jump to latest scrolls to the bottom")
  assert.ok(
    !Array.from(container.querySelectorAll("button")).some((b) => b.textContent?.includes("Jump to latest")),
    "the jump button goes away once following again"
  )

  viewport.scrollTop = 100
  await act(async () => viewport.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true })))
  height = 980
  messages = [...messages, message("fourth", 4)]
  await act(async () => root.render(render()))
  assert.equal(viewport.scrollTop, 100, "scrollbar interaction releases automatic follow")

  await act(async () => root.unmount())
  dom.window.close()
  console.log("AI chat scroll check passed")
}

void main()
