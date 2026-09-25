import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { act } from "react"

import { AiChatTranscript } from "../components/editor/ai-chat-transcript"
import type { ChatMessage } from "../lib/ai-chat"

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
    senderId: "self",
    senderName: "You",
    content: id,
    sentAt,
    updatedAt: sentAt,
  })
  let messages = [message("middle", 2), message("latest", 3)]
  let fetched = 0
  const render = () => (
    <AiChatTranscript
      messages={messages}
      selfId="self"
      turns={[]}
      status={null}
      isRoomActive={false}
      emptyState={<p>Empty</p>}
      projectId="test-project"
      hasOlderMessages
      isFetchingOlder={false}
      onFetchOlder={() => { fetched += 1 }}
      useCollaboratorsSource={() => []}
    />
  )

  await act(async () => root.render(render()))
  const viewport = container.querySelector<HTMLElement>('[role="log"]')
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.includes("Load older messages")
  )
  assert.ok(viewport)
  assert.ok(button)
  let height = 600
  const anchor = container.querySelector<HTMLElement>('[data-chat-message-id="middle"]')
  assert.ok(anchor)
  let anchorTop = 100
  anchor.getBoundingClientRect = () => ({ top: anchorTop }) as DOMRect
  Object.defineProperty(viewport, "scrollHeight", { get: () => height })
  Object.defineProperty(viewport, "clientHeight", { get: () => 200 })
  viewport.scrollTop = 400
  await act(async () => viewport.dispatchEvent(new dom.window.Event("scroll", { bubbles: true })))
  viewport.scrollTop = 120

  await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })))
  assert.equal(fetched, 1)
  height = 820 // Older rows add 180px while a streaming answer appends 40px.
  anchorTop = 280
  messages = [message("oldest", 1), ...messages]
  await act(async () => root.render(render()))
  assert.equal(viewport.scrollTop, 300, "prepending history preserves the visible offset")

  viewport.scrollTop = 620
  await act(async () => viewport.dispatchEvent(new dom.window.Event("scroll", { bubbles: true })))
  viewport.scrollTop = 120
  await act(async () => viewport.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    bubbles: true,
    key: "PageUp",
  })))
  height = 900
  messages = [...messages, message("newer", 4)]
  await act(async () => root.render(render()))
  assert.equal(viewport.scrollTop, 120, "PageUp releases automatic follow")

  viewport.scrollTop = 700
  await act(async () => viewport.dispatchEvent(new dom.window.Event("scroll", { bubbles: true })))
  viewport.scrollTop = 100
  await act(async () => viewport.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true })))
  height = 980
  messages = [...messages, message("newest", 5)]
  await act(async () => root.render(render()))
  assert.equal(viewport.scrollTop, 100, "scrollbar interaction releases automatic follow")

  await act(async () => root.unmount())
  dom.window.close()
  console.log("AI chat history scroll check passed")
}

void main()
