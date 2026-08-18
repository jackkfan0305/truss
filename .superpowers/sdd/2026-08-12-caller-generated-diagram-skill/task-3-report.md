# Task 3 — Caller-generated graph import

## RED

Created `scripts/verify-agent-graph-import.ts` before the controller. Its first
run failed as expected because `lib/agent-graph-import-server` did not exist:

```text
Error: Cannot find module '../lib/agent-graph-import-server'
```

## GREEN

Implemented the owner-only `POST /api/projects/:projectId/agent-launch-import`
controller with injected authorization, Liveblocks flow, persistence, presence,
and clock dependencies. It authorizes before reading JSON, strictly accepts only
the canonical launch UUID and compact graph, and uses one paced `mutateFlow` to
draw nodes then edges with AI cursor presence.

- The import calls the same shared native drawing loop as the design agent:
  540ms cursor arrival plus `getBuildStepMs` after each item. The
  40-node/60-edge cap bounds drawing to 76 seconds.
- Empty rooms import all items, exact full replays do not write the flow, and an
  exact interrupted subset resumes only missing canonical items.
- Extra or differing data returns `409` without mutation.
- Each empty/resumed/exact success persists the canonical requested snapshot.
  A post-Liveblocks persistence failure returns a safe `502`; an exact replay
  retries persistence.
- `saveCanvasSnapshot` now owns the existing private Blob-first/Prisma-pointer-
  second ordering. The collaborator canvas PUT retains its response and upload
  failure behavior.

## Verification

Passed with `/Users/jackfan/truss/.env` loaded without printing secrets:

```text
npx tsx scripts/verify-agent-graph-import.ts
npx tsx scripts/verify-canvas-drawing.ts
npx tsx scripts/verify-canvas.ts
npx tsx scripts/verify-project-api.ts
npx tsx scripts/verify-design-agent.ts
npx tsx scripts/verify-orchestrator.ts
npm run verify:integration
npm run lint
git diff --check
```

`npm run typecheck` still fails only in the pre-existing obsolete
description-launch runner/editor verifier (`agent-launch-runner` and
`verify-agent-launch-{page,editor}`); no Task 3 file appears in its errors.

## Review fix round 1

- Current Liveblocks state with duplicate node or edge IDs now returns `409`;
  duplicated canonical data cannot be treated as a replay.
- `runDesign` now uses the shared whole-run presence cleanup wrapper, so both
  zero-action outcomes and failures before drawing retire AI presence.
- The direct-import route declares `maxDuration = 120`, which exceeds the
  maximum 76-second native cursor/drawing cadence with headroom for auth and
  persistence. The verifier asserts the duration covers the complete graph cap.

Focused import, shared drawing, native design-agent, and orchestrator checks
pass for this round. The two concurrently edited plan/design documents remain
unstaged and were not changed by this fix.

The configured integration suite and full lint also pass. Full typecheck remains
blocked only by the existing obsolete description-launch runner/editor errors;
the review-fix files are absent from its output.
