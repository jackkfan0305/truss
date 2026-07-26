# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase

- Phase 1 — Foundation: design system and UI primitives

## Current Goal

- `04-project-dialogs` complete against its spec: the editor home has its create prompt, all three project dialogs exist, and the sidebar renders project lists with owner-only actions — all on mock data. Everything is wired to one hook, so `05-prisma` → `06-project-apis` → `07-wire-editor-home` only have to replace the data source and the no-op mutations.

## Completed

- `04-project-dialogs` — project dialogs and editor home, mock data only, no API calls or persistence.
  - `types/project.ts` — `ProjectSummary` (`id`, `name`), the subset of the future Prisma `Project` the chrome renders.
  - `lib/mock-projects.ts` — `MOCK_OWNED_PROJECTS` (3) and `MOCK_SHARED_PROJECTS` (1). Imported by `app/editor/page.tsx` and passed down as props, so `07` swaps the import for real queries and nothing below changes.
  - `hooks/use-project-actions.ts` — `useProjectActions()` owns dialog state (`{kind: "create"} | {kind: "rename" | "delete", project}`), the name input, the derived `slug`, and an `isPending` flag. Also exports `slugify()` and the `ProjectActions` type. `submit()` currently just closes the dialog.
  - `components/editor/project-dialogs.tsx` — all three dialogs, each built on the existing `EditorDialog`. Create: name input + live `/editor/{slug}` preview, submit disabled while the slug is empty. Rename: prefilled auto-focused input, current name in the description. Delete: description only, no input, `variant="destructive"` confirm.
  - `components/editor/project-sidebar.tsx` — new `ownedProjects` / `sharedProjects` / `onCreateProject` / `onRenameProject` / `onDeleteProject` props. Renders a `ProjectList` (`<ul>`, `overflow-y-auto`) when a tab has projects and the existing `EmptyState` when it does not. Rename/delete icon buttons render only when the handlers are passed, so the Shared tab has no actions.
  - `components/editor/editor-shell.tsx` — takes both project lists, calls `useProjectActions()`, renders the centered home content (`h1` + description + `New Project` button, no card) and `ProjectDialogs`. Adds a `md:hidden` scrim button behind the open sidebar for tap-to-close on small screens.

- `editor-home-shell` (partial slice of `07`/`08` — chrome only, no data) — `app/editor/page.tsx` renders `components/editor/editor-shell.tsx`. The page is a Server Component; the shell is a client component owning `isSidebarOpen` and wiring `EditorNavbar` + `ProjectSidebar` together for the first time. Work area is `relative` so the sidebar overlays the canvas rather than reflowing it. Canvas region is a placeholder with a centered prompt. Verified in-browser by the project owner: sidebar toggle, slide-over behaviour, close button, both tabs, and `UserButton` all work signed-in.

- `03-auth` — Clerk wired end to end. CLI 2.3.0, app `app_3H38PhPDskCpR6kThGNHvQoo3Ku`, dev instance `ins_3H38PjqhfIpOD6AXCGSjWBfMUQR`. `@clerk/nextjs` 7.6.1 + `@clerk/ui` 1.26.0. Keys in `.env.local` (gitignored via `.env*`).
  - `proxy.ts` — `clerkMiddleware()` protecting everything by default; public paths derived from `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL`. Throws at boot if either is unset.
  - `app/layout.tsx` — `ClerkProvider` inside `<body>` with Clerk's `dark` theme as base and all 16 appearance variables pointed at the `ui-context.md` CSS custom properties.
  - `app/page.tsx` — no longer a page. `await auth()` then redirects: authenticated → `/editor`, otherwise → the sign-in env URL.
  - `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx` — both render `AuthPanel`.
  - `components/auth/auth-panel.tsx` — two-panel shell. `lg:grid-cols-2`, aside `hidden` below `lg` so small screens render the form alone. The left column is a three-part editorial stack (`justify-between`): mono wordmark at the top, an oversized statement plus a numbered text-only feature list in the middle, and a one-line footnote at the bottom. A `.surface-dot-grid` layer sits behind it at 50% opacity. Entrance motion is `motion-safe:` only.
  - `components/editor/editor-navbar.tsx` — `UserButton` added to the previously empty right section.
- `02-editor-chrome` — `components/editor/` created with three client components: `editor-navbar.tsx` (fixed `h-14` bar, three sections, sidebar toggle with `PanelLeftOpen`/`PanelLeftClose`, right section empty), `project-sidebar.tsx` (absolute overlay, `translate-x` slide, `isOpen`/`onClose` props, Projects header + close button, `Tabs` for My Projects / Shared with empty states, full-width `New Project` button with `Plus`), and `editor-dialog.tsx` (reusable title/description/footer shell — no concrete dialogs built yet).
- `01-design-system` — shadcn/ui initialized (`components.json`, `base-nova` style, `neutral` base, CSS variables). UI primitives added unmodified in `components/ui/`: Button, Card, Dialog, Input, Tabs, Textarea, ScrollArea. `lucide-react` installed. `lib/utils.ts` exports `cn()` (clsx + tailwind-merge). Dark theme tokens from `ui-context.md` defined in `app/globals.css`.

## In Progress

- None.

## Next Up

- `05-prisma` → `06-project-apis` → `07-wire-editor-home`. The UI is complete but inert: every project in the sidebar is mock data and `submit()` in `useProjectActions` only closes the dialog. `07` replaces `lib/mock-projects.ts` with server-side queries in `app/editor/page.tsx` (which is why that page is still a Server Component), adds the unique room-ID suffix on top of `slugify()`, and turns `submit()` into the POST/PATCH/DELETE branch. `isPending` is already threaded into the dialog buttons for that step.
- `08-editor-workspace-shell` — `/editor/[roomId]`, `AccessDenied`, and `lib/project-access.ts` are all still outstanding. They need Prisma before they can do the owner/collaborator checks the spec requires.
- `EditorNavbar` now imports `UserButton`, so it can no longer render outside a `ClerkProvider`. Any future harness or story for the navbar must be mounted under the root layout.

## Open Questions

- Production Clerk instance is not configured (`clerk doctor` reports development only). Needs setting up before any deploy.
- Clerk's card carries a fixed 335px min-width, so the auth pages cannot fit viewports below roughly 367px without overriding Clerk internals — which `03-auth` forbids. 320px is in the project's stated responsive range but is not currently reachable. Accept the floor or revisit the "do not customize Clerk internals" constraint.

- axe-core (WCAG 2.1 AA) flags one serious color-contrast violation on `/editor`: the **inactive** `TabsTrigger` renders `--text-muted` `#808090` on `--bg-subtle` `#1e1e23` — roughly 4.2:1, under the 4.5:1 threshold. This comes from the generated `components/ui/tabs.tsx` (`dark:text-muted-foreground`) combined with the `ui-context.md` palette, so it will recur on every tab strip in the app. Either lift `--text-muted` or override the inactive tab color at the call site — needs a palette decision, not a local patch.

- `ui-context.md` documents the border radius scale as `rounded-xl` / `rounded-2xl` / `rounded-3xl`. shadcn redefines those steps from `--radius` (0.625rem), so they resolve to 0.875 / 1.125 / 1.375rem rather than Tailwind's defaults. The scale still increases with depth, so it was left as generated — confirm the exact values are acceptable.
- `app/layout.tsx` still carries the template metadata (`title: "Create Next App"`). No spec defines the real title/description yet.

## Architecture Decisions

- Next.js 16 names the middleware file `proxy.ts`, not `middleware.ts`. `config.matcher` carries `"/__clerk/:path*"` after `"/(api|trpc)(.*)"` so Clerk's auto-proxy handshake routes are not filtered out.
- Route protection is protected-first: `proxy.ts` calls `auth.protect()` for every path that is not public. Public paths are read from `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` rather than hardcoded, so the auth routes cannot drift out of sync with the middleware.
- `createRouteMatcher` is **deprecated in `@clerk/nextjs` 7.x** ("will be removed in the next major version"; Clerk now recommends resource-based checks in each page/handler). It is therefore not used. A plain prefix comparison replaces it — which is also what makes env-driven public paths possible, since matcher globs are static. Clerk's stated reason for the deprecation still applies to us: middleware path matching can diverge from how Next.js routes requests, so once real protected resources exist, add `await auth()` checks inside those pages and route handlers rather than relying on the middleware alone.
- Clerk is themed with the `dark` theme from `@clerk/ui/themes` as the base, overridden with the `ui-context.md` CSS custom properties (`colorBackground: var(--bg-elevated)`, `colorPrimary: var(--accent-primary)`, and so on). No hex values are passed. Clerk's own `shadcn` theme uses `var()` strings the same way, confirming CSS variables are supported. Palette edits propagate to Clerk with no code change. The earlier `shadcn`-theme wiring, including the `@clerk/ui/themes/shadcn.css` import in `globals.css`, was removed — `03-auth` specifies the `dark` base.
- `colorMutedForeground` maps to `--text-secondary`, not `--text-muted`. `--text-muted` on our surfaces fails WCAG AA (see the tab-contrast entry in Open Questions), and Clerk uses this token for form hint text.
- `ClerkProvider` sits inside `<body>`, not wrapping `<html>`, so the `dark` class and font variables on `<html>` stay under our control.
- `app/page.tsx` is a routing decision, not a screen. It is a Server Component that awaits `auth()` and redirects. `isAuthenticated` is used rather than `isSignedIn` — the latter is deprecated in the installed SDK.
- `AuthPanel` is shared by both auth routes rather than duplicated. It is presentational and takes the Clerk form as `children`, matching the existing convention that chrome components stay stateless.
- The auth left panel carries a `.surface-dot-grid` texture (defined in `globals.css`, built from `--border-subtle` at a 22px step) that echoes the React Flow canvas background, so the sign-in screen reads as the same surface as the product. **This is a deliberate reading of `03-auth.md`'s "no gradients" rule**: the rule targets decorative gradient washes and blob heroes, and this is a flat repeating dot pattern that happens to be built with `radial-gradient`. If the rule was meant literally, drop the class — nothing else depends on it.
- Auth panel type follows an "exaggerated minimalism" hierarchy: the statement is `clamp(2.25rem, 3.4vw, 3.25rem)` at `tracking-[-0.035em]` against 12–14px supporting text, so scale contrast does the work instead of colour or borders. The feature list is an `<ol>` with monospace `01`/`02`/`03` indices for rhythm — still text-only, as the spec requires, with no icons or cards.
- Supporting text on the auth panel uses `--text-muted`, never `--text-faint`. Measured against `--bg-surface`, muted lands at 4.85:1 (passes AA) while faint is roughly 3.2:1 and fails. `--text-faint` is for non-text decoration only.
- Auth entrance motion is gated behind Tailwind's `motion-safe:` variant rather than a hand-written `prefers-reduced-motion` block, and reuses the already-installed `tw-animate-css` utilities instead of new keyframes.

- One hook (`useProjectActions`) owns create/rename/delete dialog state for the whole editor, and both entry points (editor home button, sidebar `New Project`) call the same `openCreate`. The dialogs are rendered once in `EditorShell`, not per sidebar item, so the item actions only have to report which project was targeted.
- The dialog's target project lives in the `dialog` state union rather than in a separate `selectedProject` state, which makes "create has no target, rename/delete always do" a type-level fact instead of a runtime assumption.
- Dialog forms submit natively: the `<form>` sits in the dialog body with an `id`, and the footer's confirm button is a `type="submit"` with a matching `form` attribute. That gives Enter-to-submit in the rename dialog with no key handler, and it avoids adding form support to `EditorDialog`.
- Sidebar item actions are two always-visible ghost icon buttons, not a dropdown menu. No menu primitive is installed, and hover-revealed actions are unreachable on touch — which matters because the sidebar is the primary mobile navigation.
- Owner-only actions are enforced by prop absence: `ProjectList` renders the rename/delete buttons only when `onRename`/`onDelete` are passed, and the Shared tab passes neither. Once real collaborator data exists, the server-side ownership check is still the authority — this is presentation only.
- The mobile scrim is a `md:hidden` `<button>` rather than a div, so tap-to-close is also keyboard- and screen-reader-reachable. It is `z-30`, below the sidebar's `z-40`.
- Editor chrome components are presentational and stateless. `EditorNavbar` and `ProjectSidebar` take `isOpen` / `onToggle` / `onClose` from a parent; sidebar open state is owned by the workspace shell (`08-editor-workspace-shell`), not by the chrome itself.
- The sidebar is an `absolute inset-y-0 left-0` overlay inside the editor's relative container, animated with `translate-x`. It stays mounted so the slide transition runs, and carries `inert` while closed so hidden content is out of the tab order.
- `EditorDialog` wraps the shadcn `Dialog` primitive rather than editing `components/ui/dialog.tsx`. The primitive stays as generated; project styling (`rounded-3xl`, `bg-elevated`, `border-surface-border`) is applied through `className` at the wrapper.
- Dark-only theme implemented without a light palette. The `ui-context.md` colors live in `:root` as the single source of truth, and shadcn's semantic tokens (`--background`, `--card`, `--primary`, …) are mapped onto them rather than given independent values. Changing a palette entry updates both layers at once.
- `<html>` carries a static `dark` class. The generated `components/ui/*` files ship `dark:` variants, and the class makes them resolve without editing protected foundation components.
- `viewport.colorScheme = "dark"` set in `app/layout.tsx` so native UI (scrollbars, form controls) does not render light.
- The page-background utility is `bg-page`, aliased from `--bg-base`. It was `bg-base` until a `04-project-dialogs` bug report: `@theme inline`'s `--color-base` registered `base` as a color, so Tailwind's built-in `text-base` emitted `color: #080809` alongside its font size. `components/ui/input.tsx`, `textarea.tsx`, `card.tsx` and `dialog.tsx` all use `text-base`, so every input in the app rendered near-black text on a dark surface. Renaming the alias fixes it for all of them at once and cannot be reintroduced by a future `shadcn add`. Never name a color token after a font-size step (`xs`, `sm`, `base`, `lg`, `xl`, …).
- Dialog inputs carry an explicit `text-copy-primary`. Without it they inherit `EditorDialog`'s `text-copy-secondary`, and a value the user typed is primary content rather than supporting text.
- Project tokens are exposed as Tailwind utilities via `@theme inline`: `bg-page`, `bg-surface`, `bg-elevated`, `bg-subtle`, `border-surface-border`, `border-surface-border-subtle`, `text-copy-primary` / `-secondary` / `-muted` / `-faint`, `text-brand`, `bg-accent-dim`, `text-ai`, `text-ai-text`, `text-state-error` / `-success` / `-warning`.
- `--font-sans` and `--font-mono` map to the existing `--font-geist-sans` / `--font-geist-mono` variables, replacing shadcn's self-referential default.

## Session Notes

- React Doctor v0.9.1 installed as a dev dependency and initialized with its
  project installer. Setup added the `doctor` npm script, project-local agent
  skill files, `.github/workflows/react-doctor.yml`, and a local pre-commit
  hook. The first full verbose scan scored 82/100 with no errors and 8
  warnings: 2 auth-panel transition warnings, 2 generated shadcn
  non-component-export warnings, 3 intentionally unused foundation
  primitives, and the placeholder `isPending` state in
  `useProjectActions()`.
- `04-project-dialogs` verification: `npm run build`, `tsc --noEmit` and `npm run lint` all clean. `slugify()` checked with assertions against the shipped function (`node --experimental-strip-types`): `"Checkout Service"` → `checkout-service`, `"  Payments  API  "` → `payments-api`, `"Café Service"` → `cafe-service`, `"V2 -- Auth!!"` → `v2-auth`, `"!!!"` and `""` → `""`. In-browser interaction check is still outstanding — `/editor` is behind Clerk and this session had no signed-in browser session (`/editor` correctly 307s to `/sign-in`).
- The black-input-text bug was isolated in-browser without a signed-in session: `/sign-in` is public and serves the same compiled stylesheet, so appending a throwaway `<input>` with the primitive's class list and reading `getComputedStyle(...).color` reproduced it (`rgb(8, 8, 9)`), then testing one class at a time named `text-base` as the culprit. Use that technique for any "wrong color" report — it beats reading class strings.
- `slugify` relies on NFKD plus the non-alphanumeric collapse to fold accents; there is no separate combining-mark strip, because the mark is already dropped by `[^a-z0-9]+`.
- Auth panel redesign verified at 1440×900, 1024, 768 and 375: no overflow at any width, zero console errors, aside `display: none` at 375, `npm run build` and `tsc --noEmit` clean. Contrast measured in-browser against `--bg-surface`: feature text 10.46:1, list indices 4.85:1, footnote 4.85:1 — all above the 4.5:1 AA threshold.
- Design guidance came from the `ui-ux-pro-max` skill (github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT). Its "Exaggerated Minimalism" style entry and pre-delivery checklist were applied; its colour palette and Inter typography recommendations were deliberately ignored, since the project palette and Geist pairing are fixed by `ui-context.md`. The skill is **not installed in this repo** — `uipro init --ai claude` was blocked by the permission classifier. Install with `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` then `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`.
- `03-auth` verification. Unauthenticated routing matrix: `/` → 307 `/sign-in`, `/editor` → 307, `/anything-else` → 307, `/api/whatever` → 307, `/sign-in` → 200, `/sign-up` → 200. `npm run build` and `tsc --noEmit` both clean. No hardcoded hex or raw Tailwind palette classes in any auth surface. No horizontal overflow at 375 / 768 / 1024 / 1440 on either auth page; no console errors. Two-panel layout confirmed at 1280×800 and form-only at 375×812.
- The auth pages initially overflowed 375px by 8px: Clerk's card has a fixed 335px min-width and the shell's `px-6` (48px) pushed `main` to 383px. Fixed with `px-4 sm:px-6` on the form column. Measure `document.documentElement.scrollWidth` vs `clientWidth` rather than trusting a screenshot — the overflow was not visible in the capture.
- The two-panel split is keyed to `lg` (1024px), so 768px renders form-only. That matches the spec's "large screens / small screens" split but is worth knowing when testing tablets.
- `agent-browser` sets the viewport with `agent-browser set viewport <w> <h>` — there is no top-level `resize` or `viewport` command. A wrong invocation fails quietly enough that screenshots keep rendering at the old size; confirm with `eval "window.innerWidth"` before trusting a responsive screenshot.
- Earlier `clerk init` verification at 1280×800: `clerk doctor` green apart from "production not configured", Clerk modal themed dark with GitHub + Google OAuth enabled, only console message being Clerk's expected development-keys warning.
- A freshly started `next dev` can return a transient 404 for the first request to a route while it compiles. Re-request before treating it as a routing bug — an apparent `/` 404 during this work was exactly that.
- A long-running `next dev` process kept a stale route tree after `clerk init` added routes: `/sign-in` returned 200 but `/sign-up` returned 404 with `x-middleware-rewrite: /sign-up` — the proxy rewrote correctly and Next then failed to match. `.next/dev/server/.../app-paths-manifest.json` had a `sign-in` entry and no `sign-up` one (plus a stale `editor` entry from the deleted harness). Touching the file did not help; only restarting the dev server did. Restart `next dev` after any CLI that scaffolds routes.
- Clerk's CLI is a compiled binary that shells out to `open` and ignores `$BROWSER`, so it always hits the OS default browser. To force a specific browser, put a shim named `open` earlier on `PATH` that execs `/usr/bin/open -a "Google Chrome" "$@"`.

- Verified the chrome through a temporary `app/editor/page.tsx` harness (deleted afterward — the real route arrives in `07-wire-editor-home` / `08-editor-workspace-shell`). At 1280×800 and 375×812: zero console errors, sidebar overlays without shifting the canvas, tabs switch, no horizontal overflow at 375. The closed-state accessibility snapshot listed only the navbar toggle — `inert` keeps all four sidebar controls out of the tree — and the open-state snapshot exposed heading, close button, both tabs, panel, and New Project.
- Browser tooling: use the `agent-browser` CLI (`/opt/homebrew/bin/agent-browser`, load its guide with `agent-browser skills get core --full`). gstack `browse` is SIGKILLed (exit 137) on every command here, sandboxed or not, and the Playwright MCP needs a Chrome bridge extension that is not installed.
- Verified with a temporary `app/smoke/page.tsx` that imported all 7 primitives plus `cn()` and `lucide-react`; production build compiled and prerendered clean. `cn("p-2","p-4",false && "hidden","text-copy-primary")` resolved to `p-4 text-copy-primary`, confirming conflict resolution. Built CSS showed `body` → `#080809` / `#f0f0f4`, `html` → Geist Sans, and zero occurrences of the light `oklch(1 0 0)` palette. The smoke route was deleted afterward — it is not part of the spec.
- Next.js private-folder rule: a route directory prefixed with `_` (e.g. `app/_smoke`) is excluded from routing and will silently not compile. Use a non-underscore name for throwaway verification routes.
- Project runs Next.js 16.2.12 with Tailwind v4 and React 19.2.4. `AGENTS.md` requires checking `node_modules/next/dist/docs/` before using Next APIs.
