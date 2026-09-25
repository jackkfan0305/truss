# UI Context

## Theme

Dark only. No light mode. The visual language is a dark technical workspace — near-black backgrounds, layered surfaces, and vivid accent colors for interactive elements.

### AI Sidechat

The AI sidechat is intentionally monochrome. It uses only the page/surface,
border, and copy tokens from the palette, with two exceptions: the composer's
border beam and the thinking orb may use `--accent-ai` and `--accent-ai-text`,
and the send button may use a restrained chromatic metal ring. No other
sidechat surface uses an accent. State is communicated with
iconography and text, never colour alone — the beam and the orb annotate a
state that the working indicator and the running task already state in words.

- The panel has no header bar. Its close control floats at the top left, with
  space above the transcript so it does not cover the first message. The model
  selector lives in the composer. The navbar's floating toggle opens the
  panel and is hidden while it is open. The sidebar retains its elevated dark
  background. The rounded composer is the only distinct filled box at its
  bottom; human messages use subtle surfaces.
- Messages use one reading edge and minimal neutral surfaces, following modern
  AI chat conventions rather than coloured role bubbles.
- A live assistant row mounts its reply renderer before the first word arrives.
  The first text chunk publishes promptly, and any unrevealed tail continues
  appearing after the run completes. Saved replies open fully rendered.
- Each generation renders as one shared, reloadable assistant work turn placed
  directly after its prompt. The turn is a stack of tasks, one per phase of the
  run: the phase names the task, and the canvas operations and curated
  reasoning summaries it produced sit inside it. Tasks are open by default,
  because the steps are the record of what the agent did to the canvas; the
  trigger folds one away. The running task is the run's single live region.
  The initiating client reads the run's response stream only to settle its
  own composer; the transcript does not depend on it. Raw provider
  chain of thought is never displayed. Curated reasoning opens while it streams,
  with a 20px thinking orb beside the shimmering "Thinking" label and smoothly
  revealed text. The waiting state uses the same orb and label. Canvas edge
  operations remain in the durable record but stay out of the visible work log.
- Model and thinking-effort controls are compact dropdowns in the composer.
  Their menus show option names without secondary hint text.
- The composer is one compact rounded dark surface at the bottom of the panel,
  without a separate footer box. It has a short prompt above a bottom control
  row. Its focus treatment stays on the outer rounded edge; the nested input
  group adds no second ring or backdrop. Its plus glyph is decorative until
  attachment support is implemented. The send button keeps its arrow and a
  Metal FX ring, with animation paused under reduced motion. The idle form
  renders directly; Border Beam wraps it only while the agent works. The effort
  pill shows the real chosen level; the product has no automatic effort option.
- Canvas operations remain visually pending until the run's atomic canvas
  write completes. Completion and failure use both an icon and text.
- The durable `ai-chat` row is updated in place as work arrives and carries the
  final summary, so a reload reconstructs the activity without the run stream.
  A stale `running` row becomes an explicit incomplete state after the
  hard-kill timeout while retaining its partial work log.
- Another collaborator's human prompt uses a left identity rail: avatar (or
  initials fallback), name, then the message on the neutral `bg-elevated`
  surface. Own prompts do not show the other-collaborator identity treatment.

All colors are defined as CSS custom properties in `globals.css` and mapped to Tailwind tokens via `@theme inline`. Components must use these tokens — no hardcoded hex values or raw Tailwind color classes like `zinc-*`.

| Role             | CSS Variable           | Hex / Value               |
| ---------------- | ---------------------- | ------------------------- |
| Page background  | `--bg-base`            | `#080809`                 |
| Surface          | `--bg-surface`         | `#111114`                 |
| Elevated surface | `--bg-elevated`        | `#18181c`                 |
| Subtle surface   | `--bg-subtle`          | `#1e1e23`                 |
| Default border   | `--border-default`     | `#2a2a30`                 |
| Subtle border    | `--border-subtle`      | `#3a3a42`                 |
| Primary text     | `--text-primary`       | `#f0f0f4`                 |
| Secondary text   | `--text-secondary`     | `#c0c0cc`                 |
| Muted text       | `--text-muted`         | `#808090`                 |
| Faint text       | `--text-faint`         | `#505060`                 |
| Brand accent     | `--accent-primary`     | `#00c8d4` (cyan)          |
| Brand dim        | `--accent-primary-dim` | `rgba(0, 200, 212, 0.12)` |
| AI accent        | `--accent-ai`          | `#6457f9` (indigo-purple) |
| AI text          | `--accent-ai-text`     | `#8b82ff`                 |
| Error            | `--state-error`        | `#ff4d4f`                 |
| Success          | `--state-success`      | `#34d399`                 |
| Warning          | `--state-warning`      | `#fbbf24`                 |

Tailwind utility names map to these variables. Use `bg-page`, `bg-surface`, `text-copy-primary`, `text-copy-muted`, `border-surface-border`, `text-brand`, `bg-accent-dim`, etc.

The page background is exposed as `bg-page`, not `bg-base`. Registering a color named `base` would make Tailwind's built-in `text-base` set `color` as well as `font-size`, and four generated `components/ui` files use `text-base`. Do not name a color token after a font-size step (`xs`, `sm`, `base`, `lg`, `xl`, …).

## Typography

| Role      | Font       | CSS Variable        |
| --------- | ---------- | ------------------- |
| UI text   | Geist Sans | `--font-geist-sans` |
| Code/mono | Geist Mono | `--font-geist-mono` |

Both fonts are loaded via `next/font/google` and applied as CSS variables on the `<html>` element. The base `body` uses Geist Sans with `antialiased`.

### Agent Launch Capture

`/agent/new` shows one compact, centred status surface while it captures an
agent-supplied diagram request, signs the user in, or creates the project. The
surface names only the requested title; the launch description never renders on
this page. Status uses the neutral page, surface, border, and copy tokens. A
recoverable failure uses an accessible alert and a real Retry button, rather
than exposing transport details.

An authorized editor URL carrying a canonical opaque launch UUID imports the
stored graph through the owner-only project route. It does not open the AI
sidebar or create a chat turn. Importing shows a neutral canvas status overlay;
a retryable failure appears over the canvas as a compact monochrome alert with
a small Retry action. Graph labels and launch payload contents never render in
this status UI. Ordinary editor visits retain the closed AI sidebar.

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
- Floating controls: left projects toggle plus project title, a minimal utility group, and a mirrored right toggle for AI chat. Both sidebar toggles are plain ghost icon buttons (Hugeicons `SidebarLeftIcon` / `SidebarRightIcon`, one glyph for open and closed). The projects toggle slides with its panel on a transform. The title and utility chips use the sidebars' solid `bg-elevated` surface at 40px tall; thin dividers split the utility chip into save state, actions and people. Use existing shadcn primitives and semantic surface tokens.
- Sidebars: both panels share one solid `bg-elevated` surface, a subtle border and the same shadow. They slide on `ease-smooth-out`, 400ms open and 350ms close. Project row rename/delete actions appear on hover or focus, and always show on touch screens.
- Loading: full-screen and canvas loading states use `TrussLoader`, a truss triangle that draws itself edge by edge (keyframes in `app/globals.css`). Under reduced motion it shows the finished triangle and only fades in and out. The agent entry pages (`/agent/new`, `/agent/link`, `/agent/pick`) use it for every working and redirecting state, `AgentDoneStatus` (a check in a ring) when finished, and `components/agent/agent-status.tsx` card and button styles for decisions and failures.
- On narrow screens, the utility group moves to a second right-aligned floating row so the title and sidebar toggles remain unobstructed.

## Icons

Lucide React. Stroke-based icons only — no filled variants. Icon sizes: `h-4 w-4` for inline, `h-5 w-5` for buttons, `h-8 w-8` for feature icons in empty states.
