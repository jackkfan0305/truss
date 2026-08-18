# Caller-Generated Diagram Skill Design

**Status:** Approved by user direction on 2026-08-12

**Supersedes:** The skill-specific prompt/chat/Trigger generation path in
`2026-08-12-agent-invoked-diagram-skill-design.md`. The secure fragment capture,
Clerk handoff, recoverable project creation, and `npx skills` distribution
decisions remain in force.

## Outcome

`render-truss-diagram` uses the LLM that invoked the skill to create the final
diagram graph. Truss authenticates the user, creates one titled project,
strictly validates the graph, imports it into the collaborative canvas, and
renders it immediately.

The skill launch path does not create an AI chat message, start a Trigger.dev
run, consume a Truss model key, or open the AI sidebar. Manual use of Truss's AI
sidebar remains unchanged.

## User flow

1. The user asks an agent to create a Truss diagram and supplies a title and a
   system description.
2. The skill asks only for a missing title or description.
3. The calling LLM converts the description into a compact, positioned graph.
4. The skill validates the graph and opens `/agent/new#<payload>`.
5. Truss captures and scrubs the fragment before Clerk runs, then resumes after
   sign-in with only the opaque launch UUID.
6. Truss creates or recovers one project using the precomputed project ID.
7. The editor calls an owner-only graph-import endpoint.
8. The endpoint replays the graph through the native Liveblocks drawing path:
   the AI cursor moves and nodes/connections arrive incrementally with a short,
   bounded delay. An exact replay is a no-op, an exact partial import resumes,
   and divergent state is rejected.
9. Truss persists the canonical snapshot to private Blob storage and its
   project pointer, clears tab launch state, scrubs `?launch=`, and displays the
   graph. No second LLM runs.

## Compact graph contract

The launch payload remains version 1 because the feature has not shipped. Its
shape changes from a description request to a final graph request:

```ts
interface AgentLaunchPayloadV1 {
  version: 1;
  launchId: string; // canonical lowercase UUID v4
  title: string; // trimmed, 1..120
  graph: {
    version: 1;
    nodes: Array<{
      id: string; // lowercase kebab case, 1..48, unique
      label: string; // trimmed, 1..80
      shape:
        | "rectangle"
        | "diamond"
        | "circle"
        | "pill"
        | "cylinder"
        | "hexagon";
      color:
        | "neutral"
        | "blue"
        | "purple"
        | "orange"
        | "red"
        | "pink"
        | "green"
        | "teal";
      x: number; // integer, -10_000..10_000
      y: number; // integer, -10_000..10_000
    }>;
    edges: Array<{
      id: string; // lowercase kebab case, 1..48, unique
      source: string; // existing node ID
      target: string; // existing, different node ID
      label: string; // trimmed, 0..40
    }>;
  };
}
```

Limits are 1..40 nodes and 0..60 edges. Duplicate node IDs, duplicate edge IDs,
duplicate source/target pairs, self-loops, dangling endpoints, unknown enum
values, unknown keys, non-integer positions, and over-limit labels are rejected
as a whole. Nothing is silently dropped or defaulted at this boundary.

The compact contract omits React Flow implementation fields. Truss materializes
each accepted node with the canonical node type and the default dimensions for
its shape. It materializes each edge with the canonical edge type, style, and
arrow marker. Groups and viewport are absent because the current canvas schema
does not persist them and the editor already uses `fitView`.

The existing 16,384-character fragment limit remains the final transport cap.
The launcher validates both graph cardinality and the encoded payload length;
it never truncates a graph.

## Calling-LLM skill behavior

The skill owns the graph-generation rubric:

- infer architecture elements and connections from the description;
- use stable lowercase kebab IDs;
- lay the primary request path left to right;
- place supporting systems in secondary rows;
- keep at least 240 flow units horizontally and 150 vertically between node
  origins;
- use `cylinder` for durable stores, `diamond` for decisions or routing,
  `circle` for people/external actors, and simple shapes for services;
- use color consistently to communicate functional grouping;
- keep labels concise and avoid secrets;
- emit only fields in the compact graph contract.

The bundled launcher accepts graph data only through `--stdin-json`. Large JSON
is never placed in shell arguments. It stays dependency-free and portable when
installed through `npx skills`.

## Browser and launch lifecycle

The secure capture bootstrap is unchanged. The storage namespace becomes
`truss.agent-launch.graph.v1:<launchId>` so stale description-driven records
cannot be mistaken for graph launches.

The durable stages become:

```text
captured
  -> creating-project
  -> project-created
  -> importing-graph
  -> graph-imported

captured | creating-project | project-created | importing-graph
  -> failed

failed -> creating-project | importing-graph | failed
```

`graph-imported` is terminal. A failed record retains its graph and the safe
error required for Retry. It never prints or renders the graph contents.

## Authenticated graph import

Add an owner-only endpoint:

```text
POST /api/projects/:projectId/agent-launch-import
Content-Type: application/json

{ "launchId": "<uuid>", "graph": { ... } }
```

Authorization runs before body parsing. `launchId` is validated but is not an
authorization token.

The server strictly parses and materializes the graph, then performs one
server-side `mutateFlow` operation. As in the native design agent, it updates
AI presence before each addition and pauses briefly so Liveblocks flushes
incremental changes while the callback remains open:

- empty nodes and edges: add the canonical snapshot in stable node-then-edge
  order with a bounded drawing cadence;
- existing state is an exact canonical subset of the requested snapshot:
  resume only the missing nodes and edges without duplication;
- existing canonical snapshot semantically equals the requested snapshot:
  return success without a second write;
- any different non-empty state: return `409` and preserve it.

After the room is imported or confirmed exact, persist the canonical snapshot
through the existing private Blob/Prisma canvas storage ordering. If persistence
fails after the Liveblocks write, return a retryable error. The next request
sees an exact canvas, skips the Liveblocks write, and retries persistence.

This is deliberately idempotent without a new database model: node and edge IDs
are stable, an interrupted import can resume only when every existing item is
an exact member of the requested graph, and exact semantic equality is the
replay key. Any extra item or changed position/data is divergent. A caller
cannot overwrite a human-edited room. AI presence is cleared in `finally`.

## Editor integration

The editor accepts the existing canonical `?launch=<uuid>`. A small launch
import hook loads the matching tab record and calls the protected endpoint.
Module-level in-flight deduplication collapses React Strict Mode replays.

On success it records `graph-imported`, removes session state, and scrubs the
query. On failure it records a generic error and renders a monochrome alert with
Retry over the canvas. The AI sidebar keeps its normal closed initial state and
contains no launch-specific behavior.

Because the endpoint writes the same Liveblocks Storage used by the mounted
canvas with paced writes and AI presence, the graph visibly draws through the
normal collaboration path instead of appearing as one bulk replacement. Canvas
autosave remains active; the endpoint also persists the canonical snapshot so
cold restore does not depend on the client remaining open.

## Security and privacy

- The encoded graph is a fragment, is scrubbed before Clerk, and never enters a
  request URL, referrer, server log, launcher output, or status/error UI.
- Base64url is transport encoding, not encryption. Skill guidance tells users
  not to put secrets in labels.
- The authenticated import request carries the graph over same-origin HTTPS.
- Authorization is owner-only and happens before parsing.
- Unknown keys and malformed entries reject the whole graph.
- Dynamic labels render through React text, not raw HTML.
- Exact replay never duplicates nodes; divergent state is never overwritten.

## Distribution

`.agents/skills/render-truss-diagram` remains the single repository source for
local agents and `npx skills`. The documented public command remains:

```bash
npx skills add jackkfan0305/truss \
  --skill render-truss-diagram \
  --agent codex
```

Remote discovery can only be verified after the change reaches the public
default branch. Local add/list/use must be verified from a clean temporary
project before handoff.

## Verification

Deterministic checks cover:

- strict compact-graph parsing and canonical materialization;
- exact fragment round trips and maximum encoded length;
- skill stdin behavior and privacy-safe errors;
- project creation recovery unchanged;
- import authorization, whole-graph rejection, empty import, exact replay,
  divergent conflict, and persistence retry;
- editor same-tab deduplication, retry, terminal cleanup, and unchanged manual
  AI sidebar behavior;
- no AI chat/orchestrator/Trigger call for graph launches;
- complete unit/integration/type/lint/build/React Doctor gates;
- clean `npx skills` add/list/use.

Manual browser verification creates a graph through an installed skill, signs
in, observes one project and immediate canvas rendering, refreshes without
duplicates, confirms the AI transcript is empty, and confirms no Trigger run
was created. Interactive authentication remains a user-run check when Clerk
CAPTCHA blocks automation.
