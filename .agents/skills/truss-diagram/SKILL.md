---
name: truss-diagram
description: Create, edit, or delete a Truss system architecture diagram. Use when the user asks an agent to create, draw, visualize, render, change, update, rename, add to, remove from, or delete a system design in Truss. Creating requires a user-specified title and description and opens the diagram in the browser; editing runs headless against the user's own project list; deleting resolves the same way and confirms in the browser.
---

# Truss Diagram

## Dispatch

Infer the operation from the user's wording: create/draw/render/visualize a *new* diagram → **create**; change/update/rename/add to/remove from an *existing* one → **edit**; delete/remove the whole project → **delete**. When a request could plausibly be either create or edit — for example "make me a diagram of the payments flow" while a *Payments Flow* project already exists — ask which one before running anything. Guessing wrong on create leaves a stray project; guessing wrong on edit rewrites a real one.

For **edit** or **delete**, stop here and follow [references/operations.md](references/operations.md) instead of the steps below. Edit runs headless — it authenticates with a cached agent token and never opens a browser, except once per origin to sign in. Delete still opens a tab for its in-app confirm dialog.

## Create

1. Preserve the user's title and description after trimming whitespace. Do not invent a title when one is missing. Ask only for the missing title or description.
2. Reject titles over 120 characters and descriptions over 2,000 characters with a concise request to shorten that value.
3. Read [the compact graph contract](references/graph-schema.md). Infer the architecture from the description and produce one positioned compact graph that conforms exactly to it. Do not include secrets in labels.
4. Keep the primary request path left to right. Keep node origins at least 240 flow units apart horizontally and 150 vertically. Put supporting systems on secondary rows. Use stable lowercase kebab-case IDs, concise labels, consistent colors, cylinders for durable stores, diamonds for decisions/routing, circles for people or external actors, and simple shapes for services.
5. Run `scripts/truss-diagram.mjs` from this skill directory. Pass no graph data in shell arguments: invoke it with only `--stdin-json` (and optionally `--base-url <origin>`) and send exactly one JSON object with `{ "title": "…", "graph": { … } }` through process stdin. Prefer a process API that passes an argument array. `--op create` is the default and may be omitted.
6. Set `--base-url` only when the user supplied one. Otherwise let the script resolve `TRUSS_APP_URL`, then `http://localhost:3000`.
7. Before launching, confirm the resolved origin serves *this* build: `curl -s -o /dev/null -w '%{http_code}' <origin>/agent/new`, `<origin>/agent/pick`, **and** `<origin>/agent/link` must all three answer `200`. `proxy.ts` makes all three public and bypasses the Clerk dev handshake, so only a build containing `app/agent/new/`, `app/agent/pick/`, and `app/agent/link/` answers `200` on every one. A `307` on any of them means that route is missing and Clerk gated the request first; the user still sees a 404, but only after the sign-in round trip. The launcher opens whatever is listening and reports success either way, so this check is the only thing standing between a wrong port and a 404.
8. On anything other than `200`, another checkout owns the port. Identify it with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and read the serving process's path — a sibling clone on a different branch is the usual culprit. Start this repo's dev server on a free port (`npx next dev -p 3001`), re-run the step 7 check until it answers `200`, then pass that origin as `--base-url`. Tell the user which origin you used and why it differed from the default.
9. On success, tell the user that Truss opened and will create a new project immediately. On failure, report the script's non-sensitive error without printing, reconstructing, or describing its encoded fragment or graph.
10. If step 8 started a fallback dev server as a workaround, it is now an orphaned long-running process once the operation finishes — kill it (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t | xargs kill`) before ending the turn. Never kill a server you didn't start; only tear down the one this skill launched.
