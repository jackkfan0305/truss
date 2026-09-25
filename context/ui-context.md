# UI Context

## Theme

Dark only. No light mode. The visual language is a dark technical workspace — near-black backgrounds, layered surfaces, and vivid accent colors for interactive elements.

Signed-out storyboard builders show a `Sign in to save` action in the top-right
of the page. The user can keep building without signing in. If sign-in is
cancelled or fails, the page returns to the same temporary storyboard. The
invite control is hidden until the storyboard has an owner. After a successful
save, `Sign in to save` disappears and the invite control appears.

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

Smooth-step path with an arrow marker. Default edge color: `#f8fafc`. Stroke width is thin — edges are visually secondary to nodes.

### Node Shapes

6 supported shapes, defined in `types/canvas.ts` as `NODE_SHAPES`. Complex shapes (diamond, hexagon, cylinder) are rendered as inline SVGs rather than CSS borders.

- `rectangle` — default general-purpose node
- `diamond` — decision / gateway
- `circle` — event / endpoint
- `pill` — service / process
- `cylinder` — database / storage
- `hexagon` — external system / boundary

### Connection Handles

Small white circular handles, hidden by default, revealed on node hover. Appear at all four sides of a node.

### Canvas Background

React Flow `<Background>` component. Canvas sits on the base background color.

## Component Library

shadcn/ui on top of Tailwind. No custom design system. Components live in `components/ui/`. Use the `shadcn` CLI to add new components rather than writing them from scratch.

## Layout Patterns

- Editor workspace: full-viewport canvas or editor-home background with floating control islands and floating sidebar overlays.
- Floating controls: left diagrams toggle plus diagram title and a minimal utility group. The toggle is a plain ghost icon button (Hugeicons `SidebarLeftIcon`, one glyph for open and closed) that slides with its panel on a transform. The title and utility chips use the sidebar's solid `bg-elevated` surface at 40px tall; thin dividers split the utility chip into save state, actions and people. Use existing shadcn primitives and semantic surface tokens.
- Sidebars: floating overlays below the control row, on a solid `bg-elevated` surface with a subtle border. They slide on `ease-smooth-out`, 400ms open and 350ms close. Diagram row rename/delete actions appear on hover or focus, and always show on touch screens.
- Loading: full-screen and canvas loading states use `TrussLoader`, a truss triangle that draws itself edge by edge (keyframes in `app/globals.css`). Under reduced motion it shows the finished triangle and only fades in and out. The agent entry pages (`/agent/new`, `/agent/link`, `/agent/pick`) use it for every working and redirecting state, `AgentDoneStatus` (a check in a ring) when finished, and `components/agent/agent-status.tsx` card and button styles for decisions and failures.
- On narrow screens, the utility group moves to a second right-aligned floating row so the title and the sidebar toggle remain unobstructed.

## Icons

Lucide React. Stroke-based icons only — no filled variants. Icon sizes: `h-4 w-4` for inline, `h-5 w-5` for buttons, `h-8 w-8` for feature icons in empty states.
