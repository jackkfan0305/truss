---
name: truss-diagram
description: Create, edit, or delete a Truss system architecture diagram. Use when the user asks an agent to create, draw, visualize, render, change, update, rename, add to, remove from, or delete a system design in Truss. Creating requires a user-specified title and description; editing and deleting resolve the target from the user's own project list instead.
---

# Truss Diagram

## Dispatch

Infer the operation from the user's wording: create/draw/render/visualize a *new* diagram → **create**; change/update/rename/add to/remove from an *existing* one → **edit**; delete/remove the whole project → **delete**. When a request could plausibly be either create or edit — for example "make me a diagram of the payments flow" while a *Payments Flow* project already exists — ask which one before running anything. Guessing wrong on create leaves a stray project; guessing wrong on edit rewrites a real one.

Create and edit both run headless. Only **delete** opens a browser, for its in-app confirm dialog. For edit or delete, follow [references/operations.md](references/operations.md) — the target has to be resolved from the user's project list first.

## Protocol

Every operation runs `scripts/truss-diagram.mjs` from this skill directory and speaks the same line-delimited JSON protocol: one event object per stdout line, one reply object per stdin line. Treat every line as a protocol event. Never inspect, print, or reconstruct the script's argv, its nonce, the agent token, or any `/agent/*` URL fragment.

The last line is always one of:

```json
{"event":"done"}
{"event":"done","editorUrl":"<origin>/editor/<projectId>"}
{"event":"error","message":"…"}
```

Report an error message without inventing detail beyond it. When `editorUrl` is present, give the user that link.

## Authentication

The script authenticates with an agent token cached at `~/.truss/credentials.json`. The first run against an origin has none, so it opens `<origin>/agent/link` once for the user to sign in, then stores the token and continues on its own. Every run after that is silent.

- **Announce that one tab.** Before the first run against an origin, tell the user: "linking Truss to this agent — a browser tab will open once so you can sign in."
- The script prints the link URL on its own line, before any JSON event, so a user on SSH or a headless box can paste it themselves. Pass that line through verbatim when no browser opens.
- `--op login` runs the link flow alone. Use it when the user asks to sign in or re-link, or after a token is revoked. It emits `{"event":"linked"}`, then a `projects` event priming the local cache, then `done`.
- Never print, log, or echo the token.

## Create

1. Preserve the user's title and description after trimming whitespace. Do not invent a title when one is missing. Ask only for the missing title or description.
2. Reject titles over 120 characters and descriptions over 2,000 characters with a concise request to shorten that value.
3. Read [the compact graph contract](references/graph-schema.md). Infer the architecture from the description and produce one positioned compact graph that conforms exactly to it. Do not include secrets in labels.
4. Keep the primary request path left to right. Keep node origins at least 240 flow units apart horizontally and 150 vertically. Put supporting systems on secondary rows. Use stable lowercase kebab-case IDs, concise labels, consistent colors, cylinders for durable stores, diamonds for decisions/routing, circles for people or external actors, and simple shapes for services.
5. Pass no graph data in shell arguments: invoke the script with only `--stdin-json` (and optionally `--base-url <origin>`) and send exactly one JSON object with `{ "title": "…", "graph": { … } }` through process stdin. Prefer a process API that passes an argument array. `--op create` is the default and may be omitted.
6. The script creates the project and draws the graph into it, then emits `done` with the `editorUrl`. Tell the user the diagram is ready and give them that link. Nobody has to be watching for it to land — but if they already have Truss open, they will see the agent draw it live.

## Origin

7. Set `--base-url` only when the user supplied one. Otherwise let the script resolve `TRUSS_APP_URL`, then `http://localhost:3000`.
8. Before the first run against an origin, confirm it serves *this* build: `curl -s -o /dev/null -w '%{http_code}' <origin>/agent/link` must answer `200`. `proxy.ts` makes `/agent/link` public and bypasses the Clerk dev handshake, so only a build containing `app/agent/link/` answers `200`. A `307` means the route is missing and Clerk gated the request first — the sign-in tab would dead-end on a 404.
9. On anything other than `200`, another checkout owns the port. Identify it with `lsof -nP -iTCP:<port> -sTCP:LISTEN` and read the serving process's path — a sibling clone on a different branch is the usual culprit. Start this repo's dev server on a free port (`npx next dev -p 3001`), re-run the step 8 check until it answers `200`, then pass that origin as `--base-url`. Tell the user which origin you used and why it differed from the default.
10. If step 9 started a fallback dev server, it is an orphaned long-running process once the operation finishes — kill it (`lsof -nP -iTCP:<port> -sTCP:LISTEN -t | xargs kill`) before ending the turn. Never kill a server you didn't start; only tear down the one this skill launched.
