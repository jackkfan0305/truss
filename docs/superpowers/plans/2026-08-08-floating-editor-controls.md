# Floating Editor Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-width editor navbar with minimal floating shadcn controls, move the project title beside the left sidebar toggle, and use a mirrored right toggle to open and close AI chat.

**Architecture:** `EditorShell` remains the sole owner of both sidebar booleans and becomes the full-viewport positioning context. `EditorNavbar` remains presentational but renders three pointer-safe floating islands over the workspace; the existing sidebars stay mounted, slide with transforms, and begin below those controls. The right floating button is the only AI close path.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2.4, TypeScript 5 strict mode, Tailwind CSS 4 semantic tokens, shadcn/ui `Button`, Lucide React, Node assertions with React server rendering.

## Global Constraints

- Use existing shadcn primitives and keep the design minimal.
- Use existing semantic tokens only; no raw palette classes or hardcoded colors.
- Do not modify generated `components/ui/*` files or add dependencies.
- Preserve all workspace actions and active-project gating.
- Keep sidebar state in `EditorShell`; add no context or duplicate state.
- Keep closed sidebars mounted and `inert`; use transform-only motion.
- Only floating islands accept pointer input, leaving the canvas interactive.
- Preserve existing worktree changes and do not commit unrelated work.

---

## File Map

- Create `scripts/verify-editor-controls.tsx`: render-level chrome contract.
- Modify `components/editor/editor-navbar.tsx`: three floating control islands.
- Modify `components/editor/editor-shell.tsx`: full-height positioning context.
- Modify `components/editor/project-sidebar.tsx`: controlled ID and top inset.
- Modify `components/editor/ai-sidebar.tsx`: controlled ID, top inset, one close path.
- Modify `context/ui-context.md`: approved floating-control layout rule.
- Modify `context/progress-tracker.md`: completed unit and verification evidence.

### Task 1: Implement and verify the floating editor shell

**Files:**

- Create: `scripts/verify-editor-controls.tsx`
- Modify: `components/editor/editor-navbar.tsx:3-124`
- Modify: `components/editor/editor-shell.tsx:3-150`
- Modify: `components/editor/project-sidebar.tsx:39-60`
- Modify: `components/editor/ai-sidebar.tsx:3-116`
- Modify: `context/ui-context.md:118-123`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: existing `EditorShell` sidebar booleans, toggle callbacks, `presence`, and `saveStatus`.
- Produces: `EditorNavbar.profile?: ReactNode`; `AiSidebarProps { isOpen: boolean }`; region IDs `projects-sidebar` and `ai-sidebar`.

- [ ] **Step 1: Add the failing render contract**

Create `scripts/verify-editor-controls.tsx`:

```tsx
import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"

import { EditorNavbar } from "../components/editor/editor-navbar"

const baseProps = {
  isSidebarOpen: false,
  onToggleSidebar: () => undefined,
  projectName: "Checkout API",
  onShare: () => undefined,
  onOpenTemplates: () => undefined,
  onToggleAiSidebar: () => undefined,
  saveStatus: <span>Saved</span>,
  presence: <span>Collaborators</span>,
  profile: <span>Profile</span>,
}

const closedHtml = renderToStaticMarkup(
  <EditorNavbar {...baseProps} isAiSidebarOpen={false} />
)
const openHtml = renderToStaticMarkup(
  <EditorNavbar {...baseProps} isAiSidebarOpen />
)
const homeHtml = renderToStaticMarkup(
  <EditorNavbar
    isSidebarOpen={false}
    onToggleSidebar={() => undefined}
    profile={<span>Profile</span>}
  />
)

assert.ok(
  closedHtml.indexOf("Open projects sidebar") <
    closedHtml.indexOf("Checkout API")
)
assert.match(closedHtml, /aria-controls="projects-sidebar"/)
assert.match(closedHtml, /aria-label="Open AI sidebar"/)
assert.match(closedHtml, /aria-controls="ai-sidebar"/)
assert.match(closedHtml, /lucide-panel-right-open/)
assert.doesNotMatch(closedHtml, /lucide-sparkles/)
assert.match(closedHtml, /pointer-events-none absolute/)
assert.doesNotMatch(closedHtml, /border-b/)
assert.match(openHtml, /aria-label="Close AI sidebar"/)
assert.match(openHtml, /lucide-panel-right-close/)
assert.doesNotMatch(homeHtml, /AI sidebar/)
assert.match(homeHtml, /Profile/)

console.info("Editor floating-control checks passed")
```

- [ ] **Step 2: Run the contract to confirm RED**

Run `npx tsx scripts/verify-editor-controls.tsx`.

Expected: FAIL because the current navbar owns `UserButton`, uses `Sparkles`, lacks controlled-region IDs, and still renders a full-width bottom border.

- [ ] **Step 3: Update the documented layout first**

Replace the obsolete navbar rule in `context/ui-context.md` with:

```markdown
- Editor workspace: full-viewport canvas or editor-home background with floating control islands and floating sidebar overlays.
- Floating controls: left projects toggle plus project title, a minimal utility group, and a mirrored right toggle for AI chat. Use existing shadcn primitives and semantic surface tokens.
- Sidebars: floating overlays below the control row, with dark semi-transparent backgrounds and subtle borders.
- On narrow screens, the utility group moves to a second right-aligned floating row so the title and sidebar toggles remain unobstructed.
```

- [ ] **Step 4: Rebuild `EditorNavbar` as three floating islands**

Move `UserButton` out, add `profile?: ReactNode`, replace `Sparkles` with `PanelRightOpen` / `PanelRightClose`, and use:

```tsx
const FLOATING_SURFACE =
  "rounded-xl border border-surface-border bg-surface/80 shadow-lg shadow-black/40 backdrop-blur-xl"

const LeftToggleIcon = isSidebarOpen ? PanelLeftClose : PanelLeftOpen
const RightToggleIcon = isAiSidebarOpen
  ? PanelRightClose
  : PanelRightOpen

<header className="pointer-events-none absolute inset-x-3 top-3 z-50 flex min-w-0 items-start justify-between gap-2">
  <div className={cn(FLOATING_SURFACE, "pointer-events-auto flex h-10 min-w-0 max-w-[calc(100%-3rem)] items-center p-1 sm:max-w-sm")}>
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onToggleSidebar}
      aria-controls="projects-sidebar"
      aria-expanded={isSidebarOpen}
      aria-label={isSidebarOpen ? "Close projects sidebar" : "Open projects sidebar"}
    >
      <LeftToggleIcon className="size-5 text-copy-secondary" />
    </Button>
    {projectName ? (
      <p className="min-w-0 truncate pr-2 text-sm font-medium text-copy-primary">
        {projectName}
      </p>
    ) : null}
  </div>

  <div className="flex shrink-0 items-start gap-2">
    <div className={cn(FLOATING_SURFACE, "pointer-events-auto absolute top-12 right-0 flex h-10 items-center gap-1 px-1 sm:static")}>
      {saveStatus}
      {onOpenTemplates ? (
        <Button variant="ghost" size="sm" onClick={onOpenTemplates}>
          <LayoutTemplate className="size-4" />
          <span className="hidden sm:inline">Templates</span>
        </Button>
      ) : null}
      {onShare ? (
        <Button variant="ghost" size="sm" onClick={onShare}>
          <Share2 className="size-4" />
          <span className="hidden sm:inline">Share</span>
        </Button>
      ) : null}
      {presence}
      {profile}
    </div>
    {onToggleAiSidebar ? (
      <div className={cn(FLOATING_SURFACE, "pointer-events-auto p-1")}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleAiSidebar}
          aria-controls="ai-sidebar"
          aria-expanded={isAiSidebarOpen}
          aria-label={isAiSidebarOpen ? "Close AI sidebar" : "Open AI sidebar"}
        >
          <RightToggleIcon className="size-5 text-copy-secondary" />
        </Button>
      </div>
    ) : null}
  </div>
</header>
```

Keep the existing shadcn Templates and Share buttons in the utility island, followed by `{presence}` and `{profile}`. Do not add an active accent to the AI toggle; the icon and accessible label communicate state and preserve the sidechat's monochrome rule.

- [ ] **Step 5: Make `EditorShell` the full-height positioning context**

Import `UserButton`, pass the account control through the new slot, change the
outer wrapper from a column to the full-height positioning context, and remove
the now-redundant inner work-area wrapper:

```tsx
import { UserButton } from "@clerk/nextjs"

<div className="relative flex flex-1 overflow-hidden">
  <EditorNavbar
    isSidebarOpen={isSidebarOpen}
    onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
    projectName={activeProject?.name}
    onShare={activeProject ? () => setIsShareOpen(true) : undefined}
    onOpenTemplates={
      activeProject ? () => setIsTemplatesOpen(true) : undefined
    }
    isAiSidebarOpen={isAiSidebarOpen}
    onToggleAiSidebar={
      activeProject
        ? () => setIsAiSidebarOpen((open) => !open)
        : undefined
    }
    presence={activeProject ? <PresenceAvatars /> : undefined}
    saveStatus={activeProject ? <SaveStatusButton /> : undefined}
    profile={<UserButton />}
  />
</div>
```

Move the current `ProjectSidebar`, mobile scrim, active-project/home branch,
`ProjectDialogs`, and conditional `ShareDialog` directly inside this wrapper in
their current order. Delete only the inner
`<div className="relative flex flex-1 overflow-hidden">` and its matching close.
Inside the active-project branch, replace the current two-prop call with exactly
`<AiSidebar isOpen={isAiSidebarOpen} />`. Preserve all current state setters and
keep room-scoped presence/save components inside `CanvasRoom` and
`CanvasSaveProvider`.

- [ ] **Step 6: Align both sidebars below the floating rows**

Add `id="projects-sidebar"` and set the complete project aside base class to:

```tsx
"absolute top-28 bottom-3 left-3 z-40 flex w-72 max-w-[calc(100%-1.5rem)] flex-col gap-4 rounded-2xl border border-surface-border bg-surface/80 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl transition-transform duration-200 ease-out sm:top-16"
```

Add `id="ai-sidebar"`; remove `onClose`, the `X` import, and the internal close
button; change its tab header padding from `pr-2 pl-4` to `px-4`; and set the
complete AI aside base class to:

```tsx
"absolute top-28 right-3 bottom-3 z-40 flex w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-2xl shadow-page/80 transition-transform duration-200 ease-out motion-reduce:transition-none sm:top-16"
```

Retain current widths, maximum widths, `inert`, transforms, surfaces, borders, shadows, and reduced-motion behavior.

- [ ] **Step 7: Run the focused contract to confirm GREEN**

Run `npx tsx scripts/verify-editor-controls.tsx`.

Expected: `Editor floating-control checks passed`.

- [ ] **Step 8: Run static verification**

Run:

```bash
npx eslint components/editor/editor-navbar.tsx components/editor/editor-shell.tsx components/editor/project-sidebar.tsx components/editor/ai-sidebar.tsx scripts/verify-editor-controls.tsx
npx tsc --noEmit
npm run build
npx react-doctor@latest . --verbose
```

Expected: every command exits 0. Run React Doctor against the working directory, not `--staged`, because the existing configuration differs between index and worktree.

- [ ] **Step 9: Verify responsive interaction in the browser**

At 375x812, 768x900, 1024x768, and 1440x900 verify:

1. The background reaches the top viewport edge with no full-width header or divider.
2. The title follows the left toggle and truncates before either right-side island.
3. Utilities form a second right-aligned row below 640px and share the first row at 640px and above.
4. The projects panel opens/closes from the left toggle, internal close button, and mobile scrim.
5. AI chat opens and closes twice using only the right toggle, whose icon, label, and `aria-expanded` update.
6. Both panels clear the controls, no horizontal overflow appears, and exposed canvas input remains usable.
7. No new console errors appear.

- [ ] **Step 10: Update the progress tracker**

Add near the top of `context/progress-tracker.md`:

```markdown
- `30-floating-editor-controls` complete: the full-width editor navbar is gone. The canvas now fills behind three minimal floating shadcn control islands; the project title sits beside the left projects toggle, workspace utilities remain grouped, and a mirrored right toggle is the single open/close control for AI chat. Both sidebars clear the responsive control rows and retain their overlay behavior.
```

Record only the focused script, lint, type-check, build, React Doctor, and browser breakpoints actually completed.

- [ ] **Step 11: Review without committing unrelated work**

Run:

```bash
git diff --check
git diff -- components/editor/editor-navbar.tsx components/editor/editor-shell.tsx components/editor/project-sidebar.tsx components/editor/ai-sidebar.tsx context/ui-context.md context/progress-tracker.md scripts/verify-editor-controls.tsx
git status --short
```

Expected: the reviewed hunks contain only the floating-shell work. Several target files already contain user changes, so leave implementation uncommitted unless the new hunks can be staged independently without including them or the user explicitly requests a commit.
