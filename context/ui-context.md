# UI Context

## Theme

Dark only. No light mode. The visual language is monotone graphite with one accent. The neutrals are a single OKLCH ramp (hue 264, chroma 0.004) defined in `app/globals.css`, evenly spaced in lightness from page to primary text. Electric lime `--accent-primary` (#b1ef4a, `oklch(0.88 0.2 128)`) is the only accent, with `--bg-base` text on it: focus rings, primary actions, selection and every AI state (`--accent-ai` points at it). Node colours, AWS icons and status colours are content, not accents.

Signed-out storyboard builders show a `Sign in to save` action in the top-right
of the page. The user can keep building without signing in. If sign-in is
cancelled or fails, the page returns to the same temporary storyboard. After a
successful save, `Sign in to save` disappears.

### Assistant side chat

The side chat is monochrome. It uses only the page/surface, border and copy
tokens, with one exception: the composer's border beam and the thinking orb may
use `--accent-ai` and `--accent-ai-text`. State is carried by icons and words,
never colour alone; the beam and the orb annotate a state the running task
already states in words.

- The panel sits under the floating navbar with no header. Disconnect
  OpenRouter lives in the Clerk profile menu while a key is stored. The model
  picker is the composer's settings pill.
- Not connected, the panel shows a Connect OpenRouter screen: the OpenRouter
  mark and name, a heading, one short paragraph, and one primary button.
- An empty conversation shows a centred breathing orb, a heading and one
  line of copy, with no example prompts. On macOS the orb has thinking-orbs' gravity: the pointer
  bends toward it, drawn from `public/cursor-arrow-macos.png` (off under
  reduced motion and on other platforms).
- The model pill's chevron turns 180° while the model menu is open.
- Messages share one reading edge. Your prompts sit in a `bg-subtle` bubble;
  replies render as markdown with no bubble.
- Each turn is a stack of tasks, one per tool call, with the model's visible
  reasoning inside the task it followed. A tool row with nothing inside is a
  plain row, not a disclosure. The running task is the turn's single live
  region. Live reasoning opens with a 20px thinking orb beside a shimmering
  "Thinking" label; the waiting state uses the same orb and label.
- Errors show verbatim under the reply with an icon. A stopped turn says it
  stopped rather than failed and keeps its partial work.
- The transcript follows new lines until the reader scrolls up. Jump to
  latest appears only once they are more than 240px from the bottom, so a
  small scroll up to reread a line shows no button.

## Typography

| Role      | Font       | CSS Variable        |
| --------- | ---------- | ------------------- |
| UI text   | Geist Sans | `--font-geist-sans` |
| Code/mono | Geist Mono | `--font-geist-mono` |

Both fonts are loaded via `next/font/google` and applied as CSS variables on the `<html>` element. The base `body` uses Geist Sans with `antialiased`.

### Agent Launch Capture

`/agent/new` shows one compact, centred status surface while it captures an
agent-supplied diagram request, signs the user in, or creates the diagram. The
surface names only the requested title; the launch description never renders on
this page. Status uses the neutral page, surface, border, and copy tokens. A
recoverable failure uses an accessible alert and a real Retry button, rather
than exposing transport details.

An authorized editor URL carrying a canonical opaque launch UUID imports the
stored graph through the owner-only diagram route. Importing shows a neutral
canvas status overlay; a retryable failure appears over the canvas as a compact
monochrome alert with a small Retry action. Graph labels and launch payload contents never render in
this status UI. Ordinary editor visits retain the closed diagrams sidebar.

## Border Radius

Radius increases with surface depth — smaller for inner elements, larger for outer containers.

| Context           | Class         |
| ----------------- | ------------- |
| Inline / small UI | `rounded-xl`  |
| Cards / panels    | `rounded-2xl` |
| Modal / overlay   | `rounded-3xl` |

## Canvas

### Node Color Palette

8 defined color pairs. Each pair specifies a dark node fill and a vivid contrasting text color tuned for readability on the dark canvas. Defined in `types/canvas.ts` as `NODE_COLORS`.

| Node fill | Text color | Character              |
| --------- | ---------- | ---------------------- |
| `#1F1F1F` | `#EDEDED`  | Neutral dark (default) |
| `#10233D` | `#52A8FF`  | Blue                   |
| `#2E1938` | `#BF7AF0`  | Purple                 |
| `#331B00` | `#FF990A`  | Orange                 |
| `#3C1618` | `#FF6166`  | Red                    |
| `#3A1726` | `#F75F8F`  | Pink                   |
| `#0F2E18` | `#62C073`  | Green                  |
| `#062822` | `#0AC7B4`  | Teal                   |

Default node color: `#1F1F1F` with `#EDEDED` text.

### Edge Style

Smooth-step path with an arrow marker. Default edge color: `--canvas-edge`, which points at `--text-primary`. Stroke width is thin — edges are visually secondary to nodes.

### Node Shapes

6 supported shapes, defined in `types/canvas.ts` as `NODE_SHAPES`. Complex shapes (diamond, hexagon, cylinder) are rendered as inline SVGs rather than CSS borders.

- `rectangle` — default general-purpose node
- `diamond` — decision / gateway
- `circle` — event / endpoint
- `pill` — service / process
- `cylinder` — database / storage
- `hexagon` — external system / boundary

### AWS Blocks and Boundaries

AWS service blocks are a rectangular elevated surface with the local catalog icon in its official colours above an editable name. They get no colour toolbar, since icon colours are fixed. Boundaries are a dashed `copy-muted` outline with a transparent interior; the icon and title sit in a patch of the page background (`bg-page`) straddling the top edge. Both use the standard four connection handles. A failed icon load shows the catalog name as text. Workspace controls (the bottom dock's AWS section) keep the monochrome palette styling.

### Code Blocks and Boundaries

A code block is an elevated rectangle with the catalog icon and an editable name, then the signature (or the field rows of a type or enum) in monospace `text-xs`, then a muted `path:line` line at the bottom. With a pinned GitHub URL the source line is a link that opens a new tab; without one it is a button that copies `path:line` and shows "Copied" for 1.5 seconds. An entry point has a lime left border and a `data-code-entry` marker. A code boundary (`code-class`, `code-module`) is a thin solid outline with a monospace header strip holding the icon and title, instead of the dashed AWS look. A `uses` edge is dashed (`6 4`); `calls` and unkinded edges stay solid. The dock's Code tab lists the seven code catalog entries with search and no category chips. The tab places blocks by click or drag; signature, rows and source are written only by the terminal agent.

### Sticky Notes

Notes are light paper on the dark canvas with dark ink: yellow (default), pink, blue or green (`NOTE_COLORS`). A 4px radius, a soft shadow and a folded top-right corner set them apart from diagram blocks. A new note is 200×200 and resizes down to 120×80; text past the edge scrolls inside the note. Double-click edits; Escape or clicking away commits, and Enter adds a line. Selected, a note shows the colour toolbar and resize handles. It has no connection handles.

Three ways add a note, each creating a selected yellow note in its editor: the sticky-note button beside the section dock (click, or drag onto the canvas), right-click on empty canvas ("Add sticky note"), and the `N` key.

### Connection Handles

Small white circular handles, hidden by default, revealed on node hover. Appear at all four sides of a node.

### Canvas Background

React Flow `<Background>` component. Canvas sits on the base background color.

## Component Library

shadcn/ui on top of Tailwind. No custom design system. Components live in `components/ui/`. Use the `shadcn` CLI to add new components rather than writing them from scratch.

## Layout Patterns

- Editor workspace: full-viewport canvas or editor-home background with floating control islands and floating sidebar overlays.
- Bottom bar: matches the approved artifact draft. Bottom left, the zoom and history controls fold into one 48px `+` button on a `liquid-gooey` surface (`LIQUID_SURFACE`, the same material as `FLOATING_SURFACE` written as raw CSS, with the border drawn as an inset ring). Open, undo and redo rise above it and zoom out, fit and zoom in run to its right on a 550ms overshooting ease, staggered 30ms. Bottom centre, `SectionDock` sits on `FLOATING_SURFACE` with one tab per item section (Basic, AWS) and its item count. The dock, the note button and the controls blob are all 48px tall. Opening a section grows the dock to the section's size over 500ms while the tabs blur out and the panel blurs in. The panel has a back button, the title, search, category chips and a tile grid whose tiles unblur 18ms apart (`.dock-tile` in `app/globals.css`). Escape or back reverses it and focuses the tab. A new item family is one entry in `SECTIONS` plus its panel.
- Floating controls: every floating piece sits on `FLOATING_SURFACE` (`lib/floating-surface.ts`): solid `bg-elevated`, a `surface-border` edge and `shadow-lg shadow-page/60`. The top bar is two mirrored 40px chips with 12px radius. The left chip holds the diagrams toggle (Lucide `PanelLeft`, one glyph for open and closed), a divider and the diagram title. When the sidebar opens, the title folds away and the chip slides with the panel on a transform. The right chip holds save state, people and the assistant toggle (`PanelRight`), split by thin dividers. Use existing shadcn primitives and semantic surface tokens.
- Sidebars: floating overlays below the control row, on a solid `bg-elevated` surface with a subtle border. They slide on `ease-smooth-out`, 400ms open and 350ms close, and blur in from 14px and fade as they slide, matching the bottom dock's section change. Diagram row rename/delete actions appear on hover or focus, and always show on touch screens.
- Loading: full-screen and canvas loading states use `TrussLoader`, a truss triangle that draws itself edge by edge (keyframes in `app/globals.css`). Under reduced motion it shows the finished triangle and only fades in and out. The agent entry pages (`/agent/new`, `/agent/link`, `/agent/pick`) use it for every working and redirecting state, `AgentDoneStatus` (a check in a ring) when finished, and `components/agent/agent-status.tsx` card and button styles for decisions and failures.
- On narrow screens, the utility group moves to a second right-aligned floating row so the title and the sidebar toggle remain unobstructed.

## Icons

Lucide React. Stroke-based icons only — no filled variants. Icon sizes: `h-4 w-4` for inline, `h-5 w-5` for buttons, `h-8 w-8` for feature icons in empty states.
