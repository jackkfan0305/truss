# Floating Editor Controls

## Goal

Remove the editor's full-width top bar so the canvas or editor-home background
fills the viewport. Preserve every existing workspace action as floating chrome,
place the project title beside the projects-sidebar toggle, and make a mirrored
right-sidebar button the sole open/close control for AI chat.

## Layout

The editor shell uses three floating control islands above the workspace:

```text
[ projects toggle | project title ]   [ workspace utilities ] [ AI toggle ]

[ floating projects sidebar ]                     [ floating AI sidebar ]

                              canvas
```

- The left island sits at the top-left and contains the existing projects
  sidebar toggle followed immediately by the active project title. On the
  editor home, where there is no active project, it contains only the toggle.
- The utility island preserves save status, Templates, Share, presence avatars,
  and the account control. Actions that require an active project remain absent
  on the editor home, matching current behavior.
- The right island contains a `PanelRightOpen` / `PanelRightClose` icon button.
  It is present only in an active workspace and mirrors the left toggle's size,
  treatment, `aria-expanded` state, and open/close labeling.
- All islands use the existing page, surface, border, copy, radius, shadow, and
  backdrop tokens. There is no full-width header background or bottom border.
- The workspace fills the shell behind the controls. Both sidebar panels begin
  below the floating controls and retain visible background around their outer
  edges.

At narrow widths, the utility island moves to a second right-aligned floating
row. The first row keeps the left title island and right AI toggle visible and
non-overlapping. Existing text-label breakpoints continue to reduce action
width, and the project title truncates before it can displace either toggle.

## Components and State

- `EditorShell` continues to own `isSidebarOpen` and `isAiSidebarOpen`. No new
  state or context is introduced.
- `EditorNavbar` becomes the floating control overlay while keeping its current
  public behavior and action slots. Renaming the component is unnecessary churn.
- `ProjectSidebar` and `AiSidebar` remain absolute overlays. Their vertical
  inset changes so their top edges clear the floating controls.
- The internal AI close button is removed. The external mirrored toggle is the
  only AI sidebar control, so open and close cannot drift into separate paths.
- The projects sidebar's existing internal close button remains available as a
  secondary close affordance, especially on compact screens; both controls call
  the same `EditorShell` state setter.

The interaction flow remains local and synchronous:

```text
floating toggle -> EditorShell state -> sidebar transform + ARIA state + icon
```

No canvas, Liveblocks, persistence, API, Trigger.dev, or chat behavior changes.

## Accessibility and Motion

- Both sidebar toggles are real buttons with state-specific accessible labels
  and `aria-expanded`.
- Closed sidebars remain `inert`, preserving the current focus behavior.
- Floating overlay wrappers do not block canvas input outside the controls;
  only the interactive islands accept pointer events.
- Existing transition timing and reduced-motion behavior are retained.
- Focus-visible styles use existing semantic tokens and remain visible against
  both the canvas and panel surfaces.

## Verification

- Add or update focused UI contract coverage for the left title placement, the
  right icon/label/expanded state, and the absence of the old Sparkles action.
- Run TypeScript, ESLint, the production build, and React Doctor on the changed
  scope.
- Inspect open and closed sidebar states at 375, 768, 1024, and 1440 pixels.
- Confirm there is no full-width header surface, no horizontal overflow, no
  control overlap, and no blocked canvas interaction outside the floating
  islands.
- Keyboard-check both toggles and verify the AI panel can be opened and closed
  with the same right-hand button.

## Out of Scope

- Changing the contents or behavior of either sidebar.
- Moving or removing existing workspace actions.
- Changing project, canvas, collaboration, AI, or persistence state.
- Introducing new design tokens or modifying generated `components/ui/*`
  primitives.
