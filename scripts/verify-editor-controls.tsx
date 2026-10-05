import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"

import { EditorNavbar } from "../components/editor/editor-navbar"
import { DiagramSidebar } from "../components/editor/diagram-sidebar"
import { AiSidebar } from "../components/editor/ai-sidebar"
import { ChatEntry } from "../components/editor/chat-entry"

const baseNavbarProps = {
  isSidebarOpen: false,
  onToggleSidebar: () => undefined,
  diagramName: "Checkout API",
  onOpenTemplates: () => undefined,
  saveStatus: <span>Saved</span>,
  presence: <span>Collaborators</span>,
  profile: <span>Profile</span>,
}

const closedHtml = renderToStaticMarkup(<EditorNavbar {...baseNavbarProps} />)
const diagramsOpenHtml = renderToStaticMarkup(
  <EditorNavbar {...baseNavbarProps} isSidebarOpen />
)
const homeHtml = renderToStaticMarkup(
  <EditorNavbar
    isSidebarOpen={false}
    onToggleSidebar={() => undefined}
    profile={<span>Profile</span>}
  />
)

const diagramSidebarProps = {
  isOpen: true,
  onClose: () => undefined,
  ownedDiagrams: [],
  onCreateDiagram: () => undefined,
  onRenameDiagram: () => undefined,
  onDeleteDiagram: () => undefined,
}
const openDiagramSidebarHtml = renderToStaticMarkup(
  <DiagramSidebar {...diagramSidebarProps} />
)
const closedDiagramSidebarHtml = renderToStaticMarkup(
  <DiagramSidebar {...diagramSidebarProps} isOpen={false} />
)


function controlledButton(html: string, controls: string): string {
  const tag = html.match(
    new RegExp(`<button[^>]*aria-controls="${controls}"[^>]*>`)
  )?.[0]

  assert.ok(tag, `Expected a button controlling ${controls}`)
  return tag
}

function controlledRegion(html: string, id: string): string {
  const tag = html.match(new RegExp(`<aside[^>]*id="${id}"[^>]*>`))?.[0]

  assert.ok(tag, `Expected an aside with id ${id}`)
  return tag
}

function parentDivContaining(html: string, text: string): string {
  const textIndex = html.indexOf(text)
  assert.notEqual(textIndex, -1, `Expected markup containing ${text}`)

  const tagStart = html.lastIndexOf("<div", textIndex)
  const tagEnd = html.indexOf(">", tagStart)
  assert.notEqual(tagStart, -1, `Expected a parent div for ${text}`)
  assert.notEqual(tagEnd, -1, `Expected the parent div for ${text} to close`)

  return html.slice(tagStart, tagEnd + 1)
}

const closedDiagramsToggle = controlledButton(closedHtml, "diagrams-sidebar")
const openDiagramsToggle = controlledButton(
  diagramsOpenHtml,
  "diagrams-sidebar"
)
const openDiagramSidebar = controlledRegion(
  openDiagramSidebarHtml,
  "diagrams-sidebar"
)
const closedDiagramSidebar = controlledRegion(
  closedDiagramSidebarHtml,
  "diagrams-sidebar"
)
const closedDiagramTitle = parentDivContaining(closedHtml, "Checkout API")

// The sidebar toggle is a plain icon button, not a floating chip.
assert.doesNotMatch(closedDiagramsToggle, /border-surface-border|backdrop-blur-xl/)
assert.doesNotMatch(
  closedHtml,
  /<div[^>]*(?:border-surface-border|bg-surface\/80)[^>]*>\s*<button[^>]*aria-controls="diagrams-sidebar"/
)
assert.match(closedDiagramsToggle, /top-3/)
assert.match(closedDiagramsToggle, /left-3/)
assert.ok(
  openDiagramsToggle.includes(
    "translate-x-[calc(min(18rem,calc(100vw-1.5rem))-3.75rem)]"
  ),
  "the open toggle slides to the panel's inner edge on a transform"
)
assert.match(closedDiagramsToggle, /aria-expanded="false"/)
assert.match(closedDiagramsToggle, /aria-label="Open diagrams sidebar"/)
assert.match(openDiagramsToggle, /aria-expanded="true"/)
assert.match(openDiagramsToggle, /aria-label="Close diagrams sidebar"/)
// Hugeicons SidebarLeftIcon, the same glyph open or closed (shadcn's pattern).
assert.match(closedHtml, /d="M9\.5 3L9\.5 21"/)
assert.match(diagramsOpenHtml, /d="M9\.5 3L9\.5 21"/)

// No right-hand toggle survives the AI removal (ADR 0001).
assert.doesNotMatch(closedHtml, /lucide-panel-right-open|lucide-panel-right-close/)

assert.match(closedHtml, /Checkout API/)
assert.doesNotMatch(diagramsOpenHtml, /Checkout API/)
assert.match(closedDiagramTitle, /top-3/)
assert.match(closedDiagramTitle, /left-14/)

assert.match(closedHtml, /Saved/)
assert.match(closedHtml, /Templates/)
assert.doesNotMatch(closedHtml, /Share/)
assert.match(closedHtml, /Collaborators/)
assert.match(closedHtml, /Profile/)
assert.match(closedHtml, /pointer-events-none absolute/)
assert.doesNotMatch(closedHtml, /border-b/)
assert.match(homeHtml, /Profile/)

assert.match(openDiagramSidebar, /inset-y-0/)
assert.match(openDiagramSidebar, /left-0/)
assert.match(openDiagramSidebar, /w-72/)
assert.match(openDiagramSidebar, /max-w-\[calc\(100%-1\.5rem\)\]/)
assert.match(openDiagramSidebar, /translate-x-0/)
assert.match(openDiagramSidebarHtml, /max-sm:pt-8/)
assert.doesNotMatch(openDiagramSidebarHtml, /Close diagrams sidebar/)
assert.doesNotMatch(openDiagramSidebarHtml, /lucide-x/)
assert.match(closedDiagramSidebar, /inert=""/)
assert.match(
  closedDiagramSidebar,
  /-translate-x-\[calc\(100%\+2rem\)\]/
)


// Signed out of OpenRouter on the server render: Connect, no composer.
const assistantHtml = renderToStaticMarkup(
  <AiSidebar isOpen diagramId="checkout-abc123" />
)
assert.match(assistantHtml, /id="assistant-sidebar"/)
assert.match(assistantHtml, /Connect OpenRouter/)
assert.match(assistantHtml, /Connect with OpenRouter/)
assert.doesNotMatch(assistantHtml, /<textarea/)

// Review focus 5: model text renders as markdown elements, never as raw HTML.
const feedHtml = renderToStaticMarkup(
  <ol>
    <ChatEntry
      message={{
        id: "assistant-1",
        role: "assistant",
        sentAt: 0,
        turn: {
          phase: "complete",
          notice: null,
          text: "<img src=x onerror=alert(1)>\n\n**Done** [bad](javascript:alert(1))",
          parts: [
            { type: "tool", id: "call-1", label: "Created Checkout", href: "/editor/checkout-abc123", status: "complete" },
          ],
        },
      }}
    />
  </ol>
)
assert.doesNotMatch(feedHtml, /<img/)
assert.match(feedHtml, /&lt;img src=x onerror=alert\(1\)&gt;/)
assert.match(feedHtml, /<strong[^>]*>Done<\/strong>/)
assert.doesNotMatch(feedHtml, /href="javascript:/)
assert.match(feedHtml, /href="\/editor\/checkout-abc123"/)

// The navbar exposes the assistant toggle in the workspace.
const assistantNavbarHtml = renderToStaticMarkup(
  <EditorNavbar {...baseNavbarProps} isAssistantOpen={false} onToggleAssistant={() => undefined} />
)
assert.match(assistantNavbarHtml, /aria-controls="assistant-sidebar"/)
assert.match(assistantNavbarHtml, /Open assistant/)

console.info("Editor floating-control checks passed")
