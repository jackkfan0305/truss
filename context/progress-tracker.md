# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase

- Phase 1 — Foundation: design system and UI primitives

## Current Goal

- `01-design-system` complete. Ready to start `02-editor-chrome`.

## Completed

- `01-design-system` — shadcn/ui initialized (`components.json`, `base-nova` style, `neutral` base, CSS variables). UI primitives added unmodified in `components/ui/`: Button, Card, Dialog, Input, Tabs, Textarea, ScrollArea. `lucide-react` installed. `lib/utils.ts` exports `cn()` (clsx + tailwind-merge). Dark theme tokens from `ui-context.md` defined in `app/globals.css`.

## In Progress

- None.

## Next Up

- `02-editor-chrome`

## Open Questions

- `ui-context.md` documents the border radius scale as `rounded-xl` / `rounded-2xl` / `rounded-3xl`. shadcn redefines those steps from `--radius` (0.625rem), so they resolve to 0.875 / 1.125 / 1.375rem rather than Tailwind's defaults. The scale still increases with depth, so it was left as generated — confirm the exact values are acceptable.
- `app/layout.tsx` still carries the template metadata (`title: "Create Next App"`). No spec defines the real title/description yet.

## Architecture Decisions

- Dark-only theme implemented without a light palette. The `ui-context.md` colors live in `:root` as the single source of truth, and shadcn's semantic tokens (`--background`, `--card`, `--primary`, …) are mapped onto them rather than given independent values. Changing a palette entry updates both layers at once.
- `<html>` carries a static `dark` class. The generated `components/ui/*` files ship `dark:` variants, and the class makes them resolve without editing protected foundation components.
- `viewport.colorScheme = "dark"` set in `app/layout.tsx` so native UI (scrollbars, form controls) does not render light.
- Project tokens are exposed as Tailwind utilities via `@theme inline`: `bg-base`, `bg-surface`, `bg-elevated`, `bg-subtle`, `border-surface-border`, `border-surface-border-subtle`, `text-copy-primary` / `-secondary` / `-muted` / `-faint`, `text-brand`, `bg-accent-dim`, `text-ai`, `text-ai-text`, `text-state-error` / `-success` / `-warning`.
- `--font-sans` and `--font-mono` map to the existing `--font-geist-sans` / `--font-geist-mono` variables, replacing shadcn's self-referential default.

## Session Notes

- Verified with a temporary `app/smoke/page.tsx` that imported all 7 primitives plus `cn()` and `lucide-react`; production build compiled and prerendered clean. `cn("p-2","p-4",false && "hidden","text-copy-primary")` resolved to `p-4 text-copy-primary`, confirming conflict resolution. Built CSS showed `body` → `#080809` / `#f0f0f4`, `html` → Geist Sans, and zero occurrences of the light `oklch(1 0 0)` palette. The smoke route was deleted afterward — it is not part of the spec.
- Next.js private-folder rule: a route directory prefixed with `_` (e.g. `app/_smoke`) is excluded from routing and will silently not compile. Use a non-underscore name for throwaway verification routes.
- Project runs Next.js 16.2.12 with Tailwind v4 and React 19.2.4. `AGENTS.md` requires checking `node_modules/next/dist/docs/` before using Next APIs.
