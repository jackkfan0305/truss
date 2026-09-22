# Edit and delete operations

Edit and delete resolve their target from the user's own Truss project list instead of taking a title up front. Both start with `truss_list_diagrams`.

**Every operation runs headless**, exactly like create: `truss_get_diagram`, `truss_apply_diagram_edit`, and `truss_delete_diagram` authenticate with a cached agent token and call the Truss API directly. No browser tab, no window stealing focus. Delete goes through the same owner-only endpoint the app uses and reports the deletion it actually completed, so the confirmation before it is yours to get.

## Dispatch

Verb mapping lives in [SKILL.md](../SKILL.md#dispatch): create/draw/render → create; change/update/rename/add to/remove from → edit; delete/remove the whole project → delete. When create and edit are both plausible — "make me a diagram of the payments flow" while a *Payments Flow* project already exists — ask which one before running anything. Never guess between them.

## Authentication

Shared with create, and described in [SKILL.md](../SKILL.md#authentication): the first tool call against an origin opens `/agent/link` once to sign in, then caches an agent token. Everything after that is silent.

`truss_list_diagrams` reads from a cache alongside that token, so resolving "which diagram did they mean" usually costs no round trip. The cache is refreshed whenever it is older than five minutes, and it is never the last word: an id that misses the cache triggers one fresh read inside `truss_get_diagram` before it reports that a project does not exist, so a diagram created since the last `truss_list_diagrams` call resolves normally.

## Step 1: call `truss_list_diagrams` and resolve the target

Resolve which project the user means:

- **Named it.** Match case-insensitively. An exact name match wins. Otherwise, if exactly one project's name contains the user's text as a substring, that one wins. Otherwise show the candidates and ask — never choose between two plausible matches on your own.
- **Didn't name it.** Print the numbered list and ask which one.
- **Empty library, editing.** Tell the user they have no diagrams yet. Ask for a title — never invent one — reuse their edit request as the description, and run the **create** branch of [SKILL.md](../SKILL.md#create) instead.
- **Empty library, deleting.** Tell the user they have no diagrams and stop. Do not offer to create one — someone asking to delete has no use for a blank diagram.

Once you have a `projectId` from the list, use it in the calls below. Never assign or invent one of your own — `truss_get_diagram` and `truss_delete_diagram` both reject an id that was not in a listing.

## Step 2 (edit only): call `truss_get_diagram` and send the desired graph

`truss_get_diagram` returns:

```json
{
  "graph": { "version": 1, "nodes": [ … ], "edges": [ … ] },
  "opaqueNodeIds": [ "…" ],
  "fingerprint": "…"
}
```

`graph` is the compact projection of the live canvas — same contract as [graph-schema.md](graph-schema.md). `opaqueNodeIds` lists canvas items the compact contract cannot express; never assign one of these ids to a node in your edit.

Apply the user's requested change **in place**, against `graph`:

- Reuse the existing `id` of every node and edge you are keeping or modifying, so the server-side diff can align it with the live canvas. Keep the `x` and `y` the read returned for it too, so the edit leaves the rest of the canvas where the user put it.
- Omit `x` and `y` on a node you are adding. Truss lays new blocks out together beside the existing diagram and routes their connections.
- Assign new kebab-case IDs, following the same rules as [graph-schema.md](graph-schema.md), only to genuinely new nodes and edges.
- Never reuse an ID that appears in `opaqueNodeIds`.
- **If the result removes any node or edge present in `graph`,** state exactly what will be removed (by label, not ID) and get an explicit yes from the user before calling `truss_apply_diagram_edit`. This confirmation is the only safety net a destructive edit gets — never skip it, even for a small change. It matters more since edit is headless: there is no tab in front of the user showing what is about to happen. Liveblocks undo does not cover it either: `history.undo()` only reverts operations made by the current browser client, and a server-side edit runs through a separate connection, so Cmd+Z cannot bring back anything this removes.

Call `truss_apply_diagram_edit` with `{ projectId, fingerprint, desiredGraph }`, where `fingerprint` is exactly the value `truss_get_diagram` returned — never invented — and `desiredGraph` is the complete graph after your change, not a diff. The tool applies the diff and animates it into the room; anyone with that project open in a browser watches it happen live, with the AI cursor, exactly as they would during a create. Nobody needs to be watching for the edit to land.

A stale fingerprint means someone changed the canvas after your read. The tool reports the conflict and changes nothing: call `truss_get_diagram` again, reapply the user's request to the graph that comes back, and submit it with the new fingerprint. Never resend the graph you already built with a fresh fingerprint — that would silently discard the other person's work.

## Step 2 (delete only): confirm by name, then delete

`truss_delete_diagram` deletes the project outright and returns once the server has finished. There is no second dialog behind it and no undo, so the confirmation in the terminal is the only one the user gets. Quote the **full project name** you resolved, never its position in the list ("Delete the project **Payments Flow**?", not "Delete #2?") — a mistyped digit must never destroy the wrong project. Only call the tool on an explicit yes.

It deletes only a project the linked user owns; anything else comes back as an error, not a silent no-op.

## Step 3: finish

Report the tool's error message to the user without inventing detail beyond it. Two are worth handling specifically:

- *"This diagram changed since you read it"* — a collaborator edited the canvas mid-edit. Read it again, reapply the change to the graph that comes back, and submit with the new fingerprint.
- *"We couldn't delete that diagram"* — the project is gone, or the linked user does not own it. Re-run `truss_list_diagrams` before saying anything about what happened to it.
- *"The agent chose a project we don't recognize"* — a bug in your own reasoning, not the user's problem. Call `truss_list_diagrams` again and use an id from its result.

Never print, reconstruct, or describe the agent token or the `/agent/pick` and `/agent/link` URL fragments — they are not for display.

If [SKILL.md step 8](../SKILL.md) started a fallback dev server, apply [SKILL.md step 10](../SKILL.md) now and kill it — don't leave it running past this turn.
