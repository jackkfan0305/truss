import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"

import { EditorNavbar } from "../components/editor/editor-navbar"
import { ProjectSidebar } from "../components/editor/project-sidebar"

const baseNavbarProps = {
  isSidebarOpen: false,
  onToggleSidebar: () => undefined,
  projectName: "Checkout API",
  onShare: () => undefined,
  onOpenTemplates: () => undefined,
  saveStatus: <span>Saved</span>,
  presence: <span>Collaborators</span>,
  profile: <span>Profile</span>,
}

const closedHtml = renderToStaticMarkup(<EditorNavbar {...baseNavbarProps} />)
const projectsOpenHtml = renderToStaticMarkup(
  <EditorNavbar {...baseNavbarProps} isSidebarOpen />
)
const homeHtml = renderToStaticMarkup(
  <EditorNavbar
    isSidebarOpen={false}
    onToggleSidebar={() => undefined}
    profile={<span>Profile</span>}
  />
)

const projectSidebarProps = {
  isOpen: true,
  onClose: () => undefined,
  ownedProjects: [],
  sharedProjects: [],
  onCreateProject: () => undefined,
  onRenameProject: () => undefined,
  onDeleteProject: () => undefined,
}
const openProjectSidebarHtml = renderToStaticMarkup(
  <ProjectSidebar {...projectSidebarProps} />
)
const closedProjectSidebarHtml = renderToStaticMarkup(
  <ProjectSidebar {...projectSidebarProps} isOpen={false} />
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

const closedProjectsToggle = controlledButton(closedHtml, "projects-sidebar")
const openProjectsToggle = controlledButton(
  projectsOpenHtml,
  "projects-sidebar"
)
const openProjectSidebar = controlledRegion(
  openProjectSidebarHtml,
  "projects-sidebar"
)
const closedProjectSidebar = controlledRegion(
  closedProjectSidebarHtml,
  "projects-sidebar"
)
const closedProjectTitle = parentDivContaining(closedHtml, "Checkout API")

assertFloatingChrome(closedProjectsToggle)
assert.doesNotMatch(
  closedHtml,
  /<div[^>]*(?:border-surface-border|bg-surface\/80)[^>]*>\s*<button[^>]*aria-controls="projects-sidebar"/
)
assert.match(closedProjectsToggle, /top-3/)
assert.match(closedProjectsToggle, /left-3/)
assert.ok(
  openProjectsToggle.includes(
    "left-[calc(min(18rem,calc(100vw-1.5rem))-3rem)]"
  )
)
assert.match(closedProjectsToggle, /aria-expanded="false"/)
assert.match(closedProjectsToggle, /aria-label="Open projects sidebar"/)
assert.match(openProjectsToggle, /aria-expanded="true"/)
assert.match(openProjectsToggle, /aria-label="Close projects sidebar"/)
assert.match(closedHtml, /lucide-panel-left-open/)
assert.match(projectsOpenHtml, /lucide-panel-left-close/)

// No right-hand toggle survives the AI removal (ADR 0001).
assert.doesNotMatch(closedHtml, /lucide-panel-right-open|lucide-panel-right-close/)

assert.match(closedHtml, /Checkout API/)
assert.doesNotMatch(projectsOpenHtml, /Checkout API/)
assert.match(closedProjectTitle, /top-3/)
assert.match(closedProjectTitle, /left-14/)

assert.match(closedHtml, /Saved/)
assert.match(closedHtml, /Templates/)
assert.match(closedHtml, /Share/)
assert.match(closedHtml, /Collaborators/)
assert.match(closedHtml, /Profile/)
assert.match(closedHtml, /pointer-events-none absolute/)
assert.doesNotMatch(closedHtml, /border-b/)
assert.match(homeHtml, /Profile/)

assert.match(openProjectSidebar, /inset-y-0/)
assert.match(openProjectSidebar, /left-0/)
assert.match(openProjectSidebar, /w-72/)
assert.match(openProjectSidebar, /max-w-\[calc\(100%-1\.5rem\)\]/)
assert.match(openProjectSidebar, /translate-x-0/)
assert.match(openProjectSidebarHtml, /max-sm:pt-8/)
assert.doesNotMatch(openProjectSidebarHtml, /Close projects sidebar/)
assert.doesNotMatch(openProjectSidebarHtml, /lucide-x/)
assert.match(closedProjectSidebar, /inert=""/)
assert.match(
  closedProjectSidebar,
  /-translate-x-\[calc\(100%\+2rem\)\]/
)


console.info("Editor floating-control checks passed")
