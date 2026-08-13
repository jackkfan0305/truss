# Task 1 — Strict compact graph and launch lifecycle

## RED

1. Added `scripts/verify-agent-graph.ts` before `lib/agent-graph.ts`.

   ```sh
   npx tsx scripts/verify-agent-graph.ts
   ```

   Expected failure: `Cannot find module '../lib/agent-graph'`.

2. Rewrote `scripts/verify-agent-launch.ts` for the graph payload and lifecycle
   before changing `lib/agent-launch.ts`.

   ```sh
   npx tsx scripts/verify-agent-launch.ts
   ```

   Expected failure: the old description-payload parser returned `null` for the
   valid graph payload.

3. Added order-insensitive canonical snapshot equality coverage before sorting
   comparison inputs.

   ```sh
   npx tsx scripts/verify-agent-graph.ts
   ```

   Expected failure: `treats ordering as non-semantic` was false.

4. Added a mutation check proving a materialized edge cannot mutate shared
   canvas style constants before copying those constant values.

   ```sh
   npx tsx scripts/verify-agent-graph.ts
   ```

   Expected failure: `materialization does not share edge constants`.

## GREEN

- Added `lib/agent-graph.ts` with strict whole-document Zod parsing, cardinality
  and topology checks, canonical canvas materialization, and order-insensitive
  canonical snapshot equality. Materialized edge constants are copied so one
  snapshot cannot mutate the next.
- Replaced agent launch descriptions/prompt stages with a compact graph and the
  graph-import lifecycle. Launch record helpers copy graph data so stage updates
  cannot mutate an earlier record.
- Changed storage to `truss.agent-launch.graph.v1:` and added the graph verifier
  to `verify:unit`.
- Updated architecture and progress documentation.

Focused verification commands and results:

```sh
npx tsx scripts/verify-agent-graph.ts && npx tsx scripts/verify-agent-launch.ts
# Agent graph contract checks passed
# Agent launch contract checks passed

npx eslint lib/agent-graph.ts lib/agent-launch.ts scripts/verify-agent-graph.ts scripts/verify-agent-launch.ts
# exit 0

git diff --check
# exit 0
```

Configured-environment attempts used:

```sh
set -a; source /Users/jackfan/truss/.env; set +a; npm run verify:unit
set -a; source /Users/jackfan/truss/.env; set +a; npm run typecheck
```

Both stop on the still-present description/prompt editor path
(`lib/agent-launch-runner.ts` and the old launch page/editor verifiers). That
path is deliberately removed/replaced by Task 4; the Task 1 files have no
reported type errors. The full unit run reaches and passes the new graph and
launch verifiers before the old page verifier fails on its obsolete payload.

## Self-review

- Whole graph failures are fail-closed; no node or edge is dropped/defaulted.
- Accepted graph data emits only canonical canvas fields/constants and default
  dimensions.
- The fragment decoding remains browser-safe (`atob`, `TextDecoder`) and capped
  at 16,384 characters.
- No graph contents are logged or added to URLs.
