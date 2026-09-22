---
name: truss-diagram
description: Create, edit, or delete a Truss system architecture diagram. Use when the user asks an agent to create, draw, visualize, render, change, update, rename, add to, remove from, or delete a system design in Truss. Creating requires a user-specified title and description; editing and deleting resolve the target from the user's own project list instead.
---

# Truss Diagram

## Dispatch

Infer the operation from the user's wording: create/draw/render/visualize a *new* diagram → **create**; change/update/rename/add to/remove from an *existing* one → **edit**; delete/remove the whole project → **delete**. When a request could plausibly be either create or edit — for example "make me a diagram of the payments flow" while a *Payments Flow* project already exists — ask which one before running anything. Guessing wrong on create leaves a stray project; guessing wrong on edit rewrites a real one.

Every operation runs headless, through this skill's MCP server (`truss_*` tools); the only browser tab is the one-time sign-in below. For edit or delete, follow [references/operations.md](references/operations.md) — the target has to be resolved from the user's project list first, with `truss_list_diagrams`.

## Tools

This skill's MCP server registers:

- `truss_login` — link this agent to a Truss origin. Every other tool already does this automatically the first time it needs a credential; call this directly only when the user explicitly asks to sign in or re-link.
- `truss_list_diagrams` — the signed-in user's diagrams as `{ id, name }` pairs. Use it to resolve which diagram a request means.
- `truss_get_diagram` — one diagram's current compact graph, plus a `fingerprint` for the edit that follows.
- `truss_apply_diagram_edit` — replace a diagram's graph with a fully-specified `desiredGraph`.
- `truss_create_diagram` — make a new project and draw a graph into it in one call.
- `truss_delete_diagram` — delete one project the linked user owns. It completes the deletion itself; the confirmation you get from the user is the only one.

Report an error by passing along the tool result's message without inventing detail beyond it. Create and edit return an `editorUrl` — give the user that link when one comes back.

## Authentication

Every tool authenticates with an agent token cached at `~/.truss/credentials.json`. The first call against an origin has none, so the tool opens `<origin>/agent/link` once for the user to sign in, then stores the token and continues on its own. Every call after that is silent.

- **Announce that one tab.** Before the first tool call against an origin, tell the user: "linking Truss to this agent — a browser tab will open once so you can sign in."
- `truss_login` runs the link flow alone. Use it when the user asks to sign in or re-link, or after a token is revoked.
- Never print, log, or echo the token.

## Create

1. Preserve the user's title and description after trimming whitespace. Do not invent a title when one is missing. Ask only for the missing title or description.
2. Reject titles over 120 characters and descriptions over 2,000 characters with a concise request to shorten that value.
3. Read [the compact graph contract](references/graph-schema.md). Infer the architecture from the description and produce one compact graph that conforms exactly to it, omitting coordinates so Truss arranges it. Do not include secrets in labels.
4. Default to an overview a reader understands at a glance, normally 4-8 blocks: the actor or entry point, the main steps, the outcome. Add technical detail only when the description asks for it. Use stable lowercase kebab-case IDs, short labels in the user's own vocabulary, edge labels only where the relationship is not obvious, consistent colors, cylinders for durable stores, diamonds for decisions/routing, circles for people or external actors, and rectangles for everything else.
5. Call `truss_create_diagram` with `{ title, graph }`.
6. The tool creates the project and draws the graph into it, returning `editorUrl`. Tell the user the diagram is ready and give them that link. Nobody has to be watching for it to land — but if they already have Truss open, they will see the agent draw it live.

## Origin

7. Pass `baseUrl` to a tool only when the user supplied one. Otherwise the tool resolves `TRUSS_APP_URL`, then `http://localhost:3000`.
8. Before the first call against an origin, confirm it serves *this* build: `curl -s -o /dev/null -w '%{http_code}' <origin>/agent/link` must answer `200`. `proxy.ts` makes `/agent/link` public and bypasses the Clerk dev handshake, so only a build containing `app/agent/link/` answers `200`. A `307` means the route is missing and Clerk gated the request first — the sign-in tab would dead-end on a 404.
9. On anything other than `200`, another checkout owns the port. Identify it with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and read the serving process's path — a sibling clone on a different branch is the usual culprit. Start this repo's dev server on a free port (`npx next dev -p 3001`), re-run the step 8 check until it answers `200`, then pass that origin as `baseUrl`. Tell the user which origin you used and why it differed from the default.
10. If step 9 started a fallback dev server, it is an orphaned long-running process once the operation finishes — kill it (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t | xargs kill`) before ending the turn. Never kill a server you didn't start; only tear down the one this skill launched.
