# Edit and delete operations

Edit and delete resolve their target from the user's own Truss project list instead of taking a title up front. Both run `scripts/truss-diagram.mjs --op <edit|delete>` (optionally with `--base-url <origin>`, using the same resolution and origin preflight as create — see [SKILL.md](../SKILL.md) steps 6–8) from this skill directory, with no `--stdin-json` payload. The script prints one JSON object per line to stdout and reads one JSON object per line from stdin. Treat every line as a protocol event; never inspect, print, or reconstruct the script's own argv, its nonce, the agent token, or the `/agent/pick` and `/agent/link` URL fragments.

**Edit runs headless.** It authenticates with a cached agent token and calls the Truss API directly — no browser tab, no window stealing focus. Delete still opens a tab, because its final confirmation is an in-app dialog.

## Dispatch

Verb mapping lives in [SKILL.md](../SKILL.md#dispatch): create/draw/render → create; change/update/rename/add to/remove from → edit; delete/remove the whole project → delete. When create and edit are both plausible — "make me a diagram of the payments flow" while a *Payments Flow* project already exists — ask which one before running anything. Never guess between them.

## Authentication

The first run on a given origin has no cached credential. The script then opens `<origin>/agent/link` once, the user signs in if needed, and Truss mints a long-lived agent token that the script stores at `~/.truss/credentials.json` (mode 0600). Every run after that is silent.

- **Announce that one tab.** Before the first edit against an origin, tell the user: "linking Truss to this agent — a browser tab will open once so you can sign in." An unannounced tab reads as unexpected.
- The script also prints the link URL on its own line, before any JSON event, so a user on SSH or a headless box can paste it into a browser themselves. Pass that line through verbatim when the browser does not open on its own.
- `--op login` runs the link flow on its own, without editing anything. Use it when the user asks to sign in or re-link, and after a revoked token.
- Never print, log, or echo the token itself. It never appears in the protocol events; the script stores it and moves on.

## Announce the tab (delete only)

Before running `--op delete`, tell the user: "opening Truss to confirm the delete." Delete still drives its exchange through the browser and shows Truss's own confirm dialog.

## Step 1: read the `projects` event and resolve the target

Start the process, then read stdout line by line. The first JSON line is:

```json
{"event":"projects","projects":[{"id":"…","name":"…"}, …]}
```

For a first-ever edit, the link URL line and the sign-in round trip happen *before* this event arrives, so it can take as long as the user takes to sign in.

Resolve which project the user means:

- **Named it.** Match case-insensitively. An exact name match wins. Otherwise, if exactly one project's name contains the user's text as a substring, that one wins. Otherwise show the candidates and ask — never choose between two plausible matches on your own.
- **Didn't name it.** Print the numbered list and ask which one.
- **Empty library, editing.** Tell the user they have no diagrams yet. Ask for a title — never invent one — reuse their edit request as the description, and run the **create** branch of [SKILL.md](../SKILL.md#create) instead. Do not write a `projectId` line to this process; let it exit (see Step 3) and start create fresh.
- **Empty library, deleting.** Tell the user they have no diagrams and stop. Do not offer to create one — someone asking to delete has no use for a blank diagram.

Once you have a `projectId`, write it back as one line on stdin:

```json
{"projectId":"…"}
```

It must be an `id` that appeared in the `projects` event. The script rejects anything else outright and exits with an error rather than acting on an ID it never listed.

## Step 2 (edit only): read the `graph` event and send the desired graph

For `--op edit`, the next stdout line is:

```json
{"event":"graph","graph":{"version":1,"nodes":[…],"edges":[…]},"opaqueNodeIds":["…"],"fingerprint":"…"}
```

`graph` is the compact projection of the live canvas — same contract as [graph-schema.md](graph-schema.md). `opaqueNodeIds` lists canvas items the compact contract cannot express; never assign one of these IDs to a node in your reply, even to a node you cannot otherwise identify.

Apply the user's requested change **in place**, against `graph`:

- Reuse the existing `id` of every node and edge you are keeping or modifying, so the server-side diff can align it with the live canvas.
- Assign new kebab-case IDs, following the same rules as [graph-schema.md](graph-schema.md), only to genuinely new nodes and edges.
- Never reuse an ID that appears in `opaqueNodeIds`.
- **If the result removes any node or edge present in `graph`,** state exactly what will be removed (by label, not ID) and get an explicit yes from the user before sending your reply. This confirmation is the only safety net a destructive edit gets — never skip it, even for a small change. It matters more now that edit is headless: there is no tab in front of the user showing what is about to happen. Liveblocks undo does not cover it either: `history.undo()` only reverts operations made by the current browser client, and a server-side `mutateFlow` batch runs through a separate connection, so Cmd+Z cannot bring back anything this removes.

Send the complete desired graph back as one line on stdin:

```json
{"desiredGraph":{"version":1,"nodes":[…],"edges":[…]}}
```

The server applies the diff and animates it into the room. Anyone with that project open in a browser watches it happen live, with the AI cursor, exactly as they would during a create. Nobody needs to be watching for the edit to land.

## Step 2 (delete only): confirm by name

For `--op delete`, once you write the `projectId` line there is nothing more to send — the browser shows its own final confirm dialog. Before writing that line, confirm with the user in the terminal by quoting the **full project name** you resolved, never its position in the list ("Delete the project **Payments Flow**?", not "Delete #2?") — a mistyped digit must never destroy the wrong project. Only write the `projectId` line on an explicit yes.

## Step 3: finish

The final stdout line is one of:

```json
{"event":"done"}
{"event":"done","editorUrl":"<origin>/editor/<projectId>"}
{"event":"error","message":"…"}
```

A successful edit carries `editorUrl` — give the user that link so they can open the diagram and see the change. `--op login` emits `{"event":"linked"}` before its `done`.

Report an error message to the user without inventing detail beyond it. Two are worth handling specifically:

- *"This diagram is being actively edited elsewhere"* — a collaborator changed the canvas mid-edit. Offer to retry; the script already retried once from a fresh read.
- *"The agent chose a project we don't recognize"* — a bug in your own reply, not the user's problem. Re-read the `projects` event and use an ID from it.

Never print, reconstruct, or describe the script's nonce, the agent token, or the `/agent/pick` and `/agent/link` URL fragments — they are not for display.

If [SKILL.md step 8](../SKILL.md) started a fallback dev server, apply [SKILL.md step 10](../SKILL.md) now and kill it — don't leave it running past this turn.
