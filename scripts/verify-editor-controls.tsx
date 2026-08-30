import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"

import { EditorNavbar } from "../components/editor/editor-navbar"
import { DiagramSidebar } from "../components/editor/diagram-sidebar"

const baseNavbarProps = {
  isSidebarOpen: false,
  onToggleSidebar: () => undefined,
  diagramName: "Checkout API",
  onShare: () => undefined,
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
  sharedDiagrams: [],
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

function assertFloatingChrome(button: string): void {
  assert.match(button, /border-surface-border/)
  assert.match(button, /bg-surface\/80/)
  assert.match(button, /shadow-lg/)
  assert.match(button, /backdrop-blur-xl/)
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

assertFloatingChrome(closedDiagramsToggle)
assert.doesNotMatch(
  closedHtml,
  /<div[^>]*(?:border-surface-border|bg-surface\/80)[^>]*>\s*<button[^>]*aria-controls="diagrams-sidebar"/
)
assert.match(closedDiagramsToggle, /top-3/)
assert.match(closedDiagramsToggle, /left-3/)
assert.ok(
  openDiagramsToggle.includes(
    "left-[calc(min(18rem,calc(100vw-1.5rem))-3rem)]"
  )
)
assert.match(closedDiagramsToggle, /aria-expanded="false"/)
assert.match(closedDiagramsToggle, /aria-label="Open diagrams sidebar"/)
assert.match(openDiagramsToggle, /aria-expanded="true"/)
assert.match(openDiagramsToggle, /aria-label="Close diagrams sidebar"/)
assert.match(closedHtml, /lucide-panel-left-open/)
assert.match(diagramsOpenHtml, /lucide-panel-left-close/)

// No right-hand toggle survives the AI removal (ADR 0001).
assert.doesNotMatch(closedHtml, /lucide-panel-right-open|lucide-panel-right-close/)

assert.match(closedHtml, /Checkout API/)
assert.doesNotMatch(diagramsOpenHtml, /Checkout API/)
assert.match(closedDiagramTitle, /top-3/)
assert.match(closedDiagramTitle, /left-14/)

assert.match(closedHtml, /Saved/)
assert.match(closedHtml, /Templates/)
assert.match(closedHtml, /Share/)
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


console.info("Editor floating-control checks passed")
