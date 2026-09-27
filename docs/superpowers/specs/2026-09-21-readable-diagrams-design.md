# Readable diagrams and local agent operations

Truss defaults to a small overview that explains the main flow. The user approved
overview-first generation and the existing local MCP server on September 21.
Technical detail is added when requested.

## Diagram generation

The model chooses components and relationships. Truss computes new diagram
geometry with ELK layered layout, including connection routes and label placement.
The layout engine runs on the server. The browser renders its saved geometry and
falls back to interactive routing when a person moves a block or edits a label.

Generation starts with a short main flow, usually four to eight blocks. This is a
prompt preference, not a hard limit that discards requested content. Labels use
plain domain language. Connections need labels only when the relationship would
otherwise be ambiguous.

Existing positions survive small edits. Newly added blocks are laid out together
in free space beside existing content. Existing explicit move and resize actions
remain available. Previously saved positioned graphs remain valid.

The agent input boundary accepts graphs without coordinates. Import resolves
these into deterministic geometry before replay checks. Edits resolve omitted
positions against the live graph after checking the caller's fingerprint.
Opaque canvas items retain their current protection from agent edits.

## Local MCP

Keep the existing browser link and cached bearer credentials. Expose login,
list, get, create, edit, and delete. Delete calls the existing owner-authorized
endpoint and reports actual success. Keep the legacy browser picker for older
CLI callers. A stale edit returns a conflict so the agent can reread and revise
its changes. It must not silently resubmit an outdated graph with a new token.
Authentication links must not pollute the stdio protocol stream.

## Verification

Use representative chains, branches, merges, cycles, and disconnected graphs to
check geometry and label clearance. Verify deterministic import replay, unchanged
existing positions on small edits, route invalidation after manual movement,
snapshot round trips, stale edit rejection, and authenticated deletion outcomes.
Run project unit checks, TypeScript, lint, and a production build. Visually inspect
a rendered overview before completion.
