# Mirrored Sidebar Toggles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each sidebar expand from its one persistent floating toggle, with full-height edge-aligned panels and the project title independently visible only while Projects is closed.

**Architecture:** `EditorShell` owns one `"projects" | "ai" | null` visibility state and derives the two booleans passed to the navbar and panels, so overlapping sidebars are impossible. `EditorNavbar` renders the two toggle buttons as persistent, direct children of its pointer-transparent overlay and changes only their absolute positions; the sidebar components remain mounted, inert while closed, and transform on and off canvas.

**Tech Stack:** Next.js 16.2.12 App Router, React 19.2.4, TypeScript 5 strict mode, Tailwind CSS 4 semantic tokens, shadcn/ui `Button`, Lucide React, Node assertions with React server rendering.

## Global Constraints

- Keep sidebar state owned by `EditorShell`.
- Preserve panel IDs `projects-sidebar` and `ai-sidebar`.
- Use existing shadcn `Button` components and semantic color tokens only.
- Put floating surface chrome directly on each toggle button; add no presentation-only wrapper.
- Preserve existing fixed widths, inert behavior, transform-only transitions, utility controls, and editor-home behavior.
- Remove the Projects sidebar's internal close button.
- Do not modify generated `components/ui/*` files or add dependencies.
- Preserve unrelated worktree changes.

---

## File Map

- Modify `scripts/verify-editor-controls.tsx`: render-level toggle, title, and sidebar-panel contracts.
- Modify `components/editor/editor-navbar.tsx`: persistent direct-child toggles, stateful positions, and independent title surface.
- Modify `components/editor/editor-shell.tsx`: remove the obsolete Projects close callback and keep the mobile scrim non-interactive.
- Modify `components/editor/project-sidebar.tsx`: full-height left panel and removal of the internal close control.
- Modify `components/editor/ai-sidebar.tsx`: full-height right panel and tab inset for the overlaid toggle.
- Modify `context/progress-tracker.md`: completed implementation and fresh verification evidence.

### Task 1: Mirror the sidebar toggles and panels

**Files:**

- Modify: `scripts/verify-editor-controls.tsx`
- Modify: `components/editor/editor-navbar.tsx`
- Modify: `components/editor/project-sidebar.tsx`
- Modify: `components/editor/ai-sidebar.tsx`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: `EditorNavbarProps.isSidebarOpen`, `EditorNavbarProps.isAiSidebarOpen`, and the existing toggle callbacks derived from `EditorShell`'s mutually exclusive state.
- Produces: persistent buttons controlling `projects-sidebar` and `ai-sidebar`; unchanged `ProjectSidebarProps` minus `onClose`; unchanged `AiSidebarProps { isOpen: boolean }`.

- [x] **Step 1: Add the failing render contract**

Extend `scripts/verify-editor-controls.tsx` to render all four navbar states plus the real `ProjectSidebar` and provider-wrapped `AiSidebar`, then assert these observable contracts:

```tsx
assert.match(closedProjectsToggle, /left-3/)
assert.match(openProjectsToggle, /left-\[calc\(min\(18rem,calc\(100vw-1\.5rem\)\)-3rem\)\]/)
assert.match(closedAiToggle, /right-3/)
assert.match(openAiToggle, /right-\[calc\(min\(26rem,calc\(100vw-1\.5rem\)\)-3\.75rem\)\]/)
assert.match(closedProjectsToggle, /border-surface-border/)
assert.match(closedAiToggle, /border-surface-border/)
assert.ok(closedHtml.indexOf("Checkout API") >= 0)
assert.equal(projectsOpenHtml.indexOf("Checkout API"), -1)
assert.ok(aiOpenHtml.indexOf("Checkout API") >= 0)
assert.match(openProjectSidebarHtml, /inset-y-0/)
assert.doesNotMatch(openProjectSidebarHtml, /Close projects sidebar/)
```

The production regressions caught are wrong toggle placement, chrome moving onto a wrapper, title visibility coupled to the wrong sidebar, loss of full-height geometry, and restoration of a second Projects close affordance.

- [x] **Step 2: Run the focused contract and verify RED**

Run `npx tsx scripts/verify-editor-controls.tsx`.

Expected: FAIL on the first new placement assertion because the current left toggle is inside a combined toggle/title surface and does not move when Projects opens.

- [x] **Step 3: Render each toggle as one persistent floating button**

In `components/editor/editor-navbar.tsx`, replace the combined left surface and wrapped right toggle with direct `Button` children of the overlay header. Apply this surface contract to each button:

```tsx
const FLOATING_CONTROL =
  "pointer-events-auto absolute top-3 z-10 rounded-xl border border-surface-border bg-surface/80 shadow-lg shadow-page/40 backdrop-blur-xl"
```

Use `size="icon-lg"`, preserve the existing state-specific icons, labels, `aria-controls`, and `aria-expanded`, and position them with:

```tsx
isSidebarOpen
  ? "left-[calc(min(18rem,calc(100vw-1.5rem))-3rem)]"
  : "left-3"

isAiSidebarOpen
  ? "right-[calc(min(26rem,calc(100vw-1.5rem))-3.75rem)] xl:right-[calc(26rem-3rem)]"
  : "right-3"
```

Render the project title in its own floating `div` only when `projectName && !isSidebarOpen`. While AI is open below `xl`, place the title and compact utility island on a reserved second row and add matching panel-content clearance; at `xl`, return them to the first row and place utilities outside the panel.

- [x] **Step 4: Make both open panels full-height and edge-aligned**

In `components/editor/project-sidebar.tsx`, remove `onClose`, the `X` import, and the internal close button. Change the aside geometry to `inset-y-0 left-0`, retain `w-72 max-w-[calc(100%-1.5rem)]`, and reserve the top-right heading space for the overlaid toggle.

Add `max-sm:pt-8` to the Projects tabs so the compact second-row utility island does not cover its tab list.

In `components/editor/ai-sidebar.tsx`, change the aside geometry to `inset-y-0 right-0`, retain `w-[26rem] max-w-[calc(100%-1.5rem)]`, and add left padding to the tabs header so the overlaid top-left toggle does not cover the tab controls.

In `components/editor/editor-shell.tsx`, replace the independent booleans with one `OpenSidebar = "projects" | "ai" | null` state, remove the obsolete `onClose` prop passed to `ProjectSidebar`, and keep the mobile scrim visual but non-interactive, so the persistent toggle remains the only close affordance.

- [x] **Step 5: Run the focused contract and verify GREEN**

Run `npx tsx scripts/verify-editor-controls.tsx`.

Expected: `Editor floating-control checks passed` and exit code 0.

- [x] **Step 6: Update implementation progress**

Add a `31-mirrored-sidebar-toggles` entry near the top of `context/progress-tracker.md` describing the persistent repositioned toggles, independent title visibility, full-height panels, and only the verification commands actually completed.

- [x] **Step 7: Run static and React verification**

Run:

```bash
npx eslint components/editor/editor-navbar.tsx components/editor/editor-shell.tsx components/editor/project-sidebar.tsx components/editor/ai-sidebar.tsx scripts/verify-editor-controls.tsx
npx tsc --noEmit
npm run build
npx react-doctor@latest --verbose --scope changed
```

Expected: all commands exit 0; React Doctor reports no regression caused by the changed scope.

- [x] **Step 8: Review the complete scoped diff**

Run:

```bash
git diff --check
git diff -- components/editor/editor-navbar.tsx components/editor/editor-shell.tsx components/editor/project-sidebar.tsx components/editor/ai-sidebar.tsx scripts/verify-editor-controls.tsx context/progress-tracker.md docs/superpowers/plans/2026-08-08-mirrored-sidebar-toggles.md
git status --short
```

Confirm the feature satisfies all eight acceptance criteria and no unrelated existing changes were overwritten.
