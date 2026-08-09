# Mirrored Sidebar Toggles Design

## Goal

Make the Projects and AI sidebars feel like panels that grow out of their floating controls. Each control remains the only open/close affordance for its panel, and neither control is wrapped in an extra surface container.

## Interaction

### Projects

- When closed, show a standalone floating Projects toggle at the upper-left of the editor.
- Show the project title in a separate floating surface immediately beside the closed Projects toggle.
- When opened, the Projects sidebar becomes flush with the left edge and spans the full height of the editor viewport while retaining its existing `w-72` width.
- Move the Projects toggle to the open panel's top-right corner and show the close-state icon.
- Hide the separate project-title surface while Projects is open because the current project is already highlighted in the panel.
- Closing Projects restores the toggle and title to their closed positions.

### AI chat

- When closed, show a standalone floating AI toggle at the upper-right of the editor.
- When opened, the AI sidebar becomes flush with the right edge and spans the full height of the editor viewport while retaining its existing width.
- Move the AI toggle to the open panel's top-left corner and show the close-state icon.
- Keep the project title visible when only AI chat is open.
- Closing AI restores the toggle to its closed position.

## Components and Styling

- Use the existing shadcn `Button` component for both toggles.
- Put the floating border, background, backdrop blur, and shadow directly on each button. Do not wrap either button in an additional `div` for presentation.
- Keep the project title in its own floating `div` so its visibility can change independently of the Projects toggle.
- Remove the Projects sidebar's redundant internal close button.
- Preserve the existing minimal neutral visual language and semantic color tokens.

## State and Accessibility

- Keep sidebar state owned by `EditorShell` and pass it to the navbar and panels.
- Each toggle exposes `aria-expanded`, `aria-controls`, and a state-appropriate accessible label.
- Preserve the existing panel IDs so the relationships remain stable.
- Closed panels remain non-interactive and hidden from keyboard navigation through the existing inert/transition behavior.

## Responsive Behavior

- The sidebars are full-height within the editor shell at all viewport sizes when open.
- Their fixed widths remain unchanged for this iteration.
- Floating closed controls retain safe edge spacing and remain above the canvas.

## Acceptance Criteria

1. Opening Projects makes the panel full-height, moves its toggle to the panel's top-right, and hides the project title.
2. Closing Projects restores the upper-left toggle and separate title surface.
3. Opening AI makes the panel full-height and moves its toggle to the panel's top-left.
4. Closing AI restores the upper-right toggle.
5. Opening AI alone does not hide the project title.
6. Neither sidebar toggle has a presentation-only wrapper element.
7. The old internal Projects close button is removed.
8. Existing sidebar state, accessibility relationships, and unrelated editor controls continue to work.
