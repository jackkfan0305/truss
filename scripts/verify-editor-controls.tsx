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

// The sidebar toggle sits in a chip, mirroring the utility chip on the right.
function toggleChip(html: string): string {
  const tag = html.match(
    /<div[^>]*>(?=\s*<button[^>]*aria-controls="diagrams-sidebar")/
  )?.[0]
  assert.ok(tag, "Expected the diagrams toggle inside a chip")
  return tag
}
assert.match(toggleChip(closedHtml), /border-surface-border/)
assert.match(toggleChip(closedHtml), /top-3/)
assert.match(toggleChip(closedHtml), /left-3/)
assert.ok(
  toggleChip(diagramsOpenHtml).includes(
    "translate-x-[calc(min(var(--diagrams-sidebar-w),calc(100vw-1.5rem))-4.125rem)]"
  ),
  "the open chip slides to the panel's inner edge on a transform"
)
assert.match(closedDiagramsToggle, /aria-expanded="false"/)
assert.match(closedDiagramsToggle, /aria-label="Open diagrams sidebar"/)
assert.match(openDiagramsToggle, /aria-expanded="true"/)
assert.match(openDiagramsToggle, /aria-label="Close diagrams sidebar"/)
// Lucide PanelLeft, the same glyph open or closed (shadcn's pattern).
assert.match(closedHtml, /lucide-panel-left/)
assert.match(diagramsOpenHtml, /lucide-panel-left/)

// No right-hand toggle survives the AI removal (ADR 0001).
assert.doesNotMatch(closedHtml, /lucide-panel-right-open|lucide-panel-right-close/)

assert.match(closedHtml, /Checkout API/)
assert.doesNotMatch(diagramsOpenHtml, /Checkout API/)
// The title shares the toggle's chip.
assert.equal(closedDiagramTitle, toggleChip(closedHtml))

assert.match(closedHtml, /Saved/)
assert.doesNotMatch(closedHtml, /Templates/)
assert.doesNotMatch(closedHtml, /Share/)
assert.match(closedHtml, /Collaborators/)
assert.match(closedHtml, /Profile/)
assert.match(closedHtml, /pointer-events-none absolute/)
assert.doesNotMatch(closedHtml, /border-b/)
assert.match(homeHtml, /Profile/)

assert.match(openDiagramSidebar, /inset-y-0/)
assert.match(openDiagramSidebar, /left-0/)
assert.match(openDiagramSidebar, /w-\(--diagrams-sidebar-w\)/)
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
assert.match(assistantNavbarHtml, /aria-label="Open assistant"/)
assert.doesNotMatch(assistantNavbarHtml, />Assistant</, "the toggle is icon-only")
assert.match(
  renderToStaticMarkup(
    <EditorNavbar {...baseNavbarProps} isAssistantOpen onToggleAssistant={() => undefined} />
  ),
  /aria-expanded="true"[^>]*aria-label="Close assistant"|aria-label="Close assistant"[^>]*aria-expanded="true"/
)

console.info("Editor floating-control checks passed")
