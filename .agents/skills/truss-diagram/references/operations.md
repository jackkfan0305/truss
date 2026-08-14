# Edit and delete operations

Edit and delete resolve their target from the user's own Truss project list instead of taking a title up front. Both run `scripts/truss-diagram.mjs --op <edit|delete>` (optionally with `--base-url <origin>`, using the same resolution and origin preflight as create — see [SKILL.md](../SKILL.md) steps 6–8) from this skill directory, with no `--stdin-json` payload. The script prints one JSON object per line to stdout and reads one JSON object per line from stdin. Treat every line as a protocol event; never inspect, print, or reconstruct the script's own argv, its nonce, or the `/agent/pick` URL fragment.

## Dispatch

Verb mapping lives in [SKILL.md](../SKILL.md#dispatch): create/draw/render → create; change/update/rename/add to/remove from → edit; delete/remove the whole project → delete. When create and edit are both plausible — "make me a diagram of the payments flow" while a *Payments Flow* project already exists — ask which one before running anything. Never guess between them.

## Announce the tab

Before running `--op edit` or `--op delete`, tell the user: "opening Truss to read your projects." The script opens the browser and reads the project list before the agent can ask anything else, so an unannounced tab reads as unexpected.

## Step 1: read the `projects` event and resolve the target

Start the process, then read stdout line by line. The first line is:

```json
{"event":"projects","projects":[{"id":"…","name":"…"}, …]}
```

Resolve which project the user means:

- **Named it.** Match case-insensitively. An exact name match wins. Otherwise, if exactly one project's name contains the user's text as a substring, that one wins. Otherwise show the candidates and ask — never choose between two plausible matches on your own.
- **Didn't name it.** Print the numbered list and ask which one.
- **Empty library, editing.** Tell the user they have no diagrams yet. Ask for a title — never invent one — reuse their edit request as the description, and run the **create** branch of [SKILL.md](../SKILL.md#create) instead. Do not write a `projectId` line to this process; let it exit (see Step 3) and start create fresh.
- **Empty library, deleting.** Tell the user they have no diagrams and stop. Do not offer to create one — someone asking to delete has no use for a blank diagram.

Once you have a `projectId`, write it back as one line on stdin:

```json
{"projectId":"…"}
```

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
- **If the result removes any node or edge present in `graph`,** state exactly what will be removed (by label, not ID) and get an explicit yes from the user before sending your reply. This confirmation is the only safety net a destructive edit gets — never skip it, even for a small change.

Send the complete desired graph back as one line on stdin:

```json
{"desiredGraph":{"version":1,"nodes":[…],"edges":[…]}}
```

The browser applies the diff server-side and redirects to the editor so the user watches the change animate in.

## Step 2 (delete only): confirm by name

For `--op delete`, once you write the `projectId` line there is nothing more to send — the browser shows its own final confirm dialog. Before writing that line, confirm with the user in the terminal by quoting the **full project name** you resolved, never its position in the list ("Delete the project **Payments Flow**?", not "Delete #2?") — a mistyped digit must never destroy the wrong project. Only write the `projectId` line on an explicit yes.

## Step 3: finish

The final stdout line is either:

```json
{"event":"done"}
```

or

```json
{"event":"error","message":"…"}
```

Report the error message to the user without inventing detail beyond it. Never print, reconstruct, or describe the script's nonce or the `/agent/pick` URL fragment — they are not for display.
