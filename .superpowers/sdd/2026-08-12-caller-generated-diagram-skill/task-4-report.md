# Task 4 report: direct editor graph import

## RED

Rewrote `scripts/verify-agent-launch-editor.tsx` first to require the direct
owner-route import lifecycle, Strict Mode deduplication, retry retention,
terminal/mismatch no-ops, closed manual AI UI, and neutral canvas status. The
verifier initially failed because `hooks/use-agent-launch-import.ts` did not
exist.

## GREEN

Implemented `lib/agent-launch-import-runner.ts` and
`hooks/use-agent-launch-import.ts`; mounted the hook in the authorized active
project editor; removed launch-specific prompt/chat code and obsolete runner;
kept the AI sidebar initially closed; and added a neutral canvas import status
and retry alert. Cleanup occurs only after an exact HTTP 200. Network, 5xx, and
409 responses retain the graph in `failed` state. Also aligned the project
collision retry fixture with the graph lifecycle.

## Exact gates

- `npm run verify:unit` — PASS (exit 0)
- `npm run typecheck` — PASS (exit 0)
- `npm run lint` — PASS (exit 0)
- `npx tsx scripts/verify-agent-launch-editor.tsx` — PASS
- `npx tsx scripts/verify-agent-launch-page.tsx` — PASS
- `git diff --cached --check` — PASS
- `npx react-doctor@latest --verbose --scope changed` — PASS, 100/100, no issues

React Doctor was run with an isolated npm cache after the default npm cache
attempt failed with an external `EEXIST/EACCES` cache error.
