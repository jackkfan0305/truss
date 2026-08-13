# Task 7 Verification Report

## Status

`DONE_WITH_CONCERNS`: deterministic validation and local distribution checks completed. The
development Clerk instance prevents the authenticated browser steps from completing because the
sign-in flow requires interactive CAPTCHA completion.

## Deterministic checks

All commands used the configured environment with `set -a; source
/Users/jackfan/truss/.env; set +a` and exited 0:

- `npm test`
- `npm run verify:integration`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

`npm run doctor -- --verbose --scope changed` initially could not use the shared npm cache because
of an existing-cache rename permission failure. The same command, run with an isolated temporary
`NPM_CONFIG_CACHE`, exited 0 with React Doctor score 100/100 and no findings. The final fresh
run used temporary cache `/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/tmp.wBObBqKX8D`.

Known non-failing command output: the publisher verifier deliberately logs one simulated
Liveblocks write failure before proving repair. Next build warns that it inferred a broader
workspace root due to another lockfile. Neither affected exit status.

## TDD fixes during verification

- RED: `npm run typecheck` reported a missing declaration for the React test harness's internal
  dispatcher field. GREEN: the harness now narrows the React namespace through a local test-only
  shape. Focused typecheck and the full suite pass. Commit: `0a4e542`.
- RED: signed-out browser probing showed Clerk could redirect before capture, leaving no stored
  launch record. A first server-handshake bypass established capture but exposed the client-init
  ordering issue. GREEN: exact `/agent/new` bypasses only Clerk's server handshake, and a
  `beforeInteractive` bootstrap copies a bounded base64url fragment before Clerk code mounts; the
  provider gate applies the canonical capture contract before reloading the fixed opaque resume
  URL. The focused launch verifier, full suite,
  production build, and browser capture probe pass. Commit: `a9e1bdb`.

### Review remediation, round 1

- RED: the review identified that the bootstrap duplicated canonical payload limits and the live
  invalid-fragment probe remained on the capture status. The new focused verifier initially failed
  because the requested pending-handoff module did not exist.
- GREEN: the bootstrap now copies and scrubs only a bounded base64url fragment, deriving the bound
  from `MAX_AGENT_LAUNCH_FRAGMENT_LENGTH`. `consumePendingAgentLaunch` delegates decoding and
  validation to `captureAgentLaunch`; it always clears the pending value. The gate uses a local
  reducer so a canonical rejection transitions to normal Clerk mounting, while a valid record
  reloads only the opaque UUID resume route. Regressions cover valid pending capture with one
  record and opaque route, canonical rejection without a permanent capture status, absent pending
  data, and exact nested/auth/API bypass boundaries.
- Focused GREEN checks: `npx tsx scripts/verify-agent-launch-page.tsx`, `npm run typecheck`, and
  `npm run lint` each exited 0. Final configured-environment commands `npm test`,
  `npm run verify:integration`, `npm run typecheck`, `npm run lint`, and `npm run build` each
  exited 0. The final isolated-cache React Doctor command exited 0 with 100/100 and no findings
  (temporary cache `/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/tmp.SYKuzMkzla`).

## Browser evidence

- `npm run dev` started the app and Trigger worker. Port 3000 was already occupied, so this
  worktree served on port 3001.
- The configured gstack browse executable exited 137 before handling commands. The installed
  `agent-browser` fallback was used after its core guide was read.
- A signed-out synthetic launch probe reached the exact public capture route. With Clerk resources
  temporarily blocked only to observe pre-auth state, it showed: launch hash scrubbed, one
  tab-scoped launch record, and a canonical opaque `launch` query after reload.
- With normal Clerk resources, the probe reached the native sign-in UI and retained its resume
  record. The original launch payload was absent from the final URL shape; the remaining
  Clerk-owned hash did not parse as a launch payload. Browser URL/resource checks found neither
  the raw description nor its encoded launch payload.
- Full sign-in, project creation, human transcript once-only rendering, Trigger run, progressive
  canvas changes, and refresh/retry dedupe could not be exercised without completing the
  development instance's CAPTCHA. No opaque project or run IDs were recorded.
- Round 1 browser retest: an invalid bounded fragment was immediately scrubbed, left no pending
  record, and rendered the normal missing-request state rather than the capture status. In a fresh
  browser context, a valid synthetic fragment produced one canonical session record, scrubbed the
  launch-shaped hash, and reached Clerk sign-in without the capture status. The opaque return-path
  construction is asserted deterministically; the development CAPTCHA prevents completing its
  authenticated return.

## R5 deterministic review

`verify-agent-launch-page.tsx` covers valid capture, scrub/storage, fixed resume lookup, and
status markup that excludes the description. `verify-agent-launch-editor.tsx` covers the
description's exclusion from editor chrome and launch retry/dedupe boundaries. `verify-ai-chat.ts`
covers escaped chat rendering, and the complete unit suite ran these checks. Browser inspection
confirmed no launch description or payload in observed URLs. The authenticated, durable human
transcript count remains the CAPTCHA-blocked live check.

## Local distribution verification

From a clean temporary project, `npx skills add`, `npx skills list`, and `npx skills use` all
exited 0 for `render-truss-diagram`; the generated prompt contained the skill and
`open-truss-diagram.mjs`. The temporary project path is
`/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/tmp.D4d5KIIgUP`; the generated-use temporary
path is `/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/skills-use-DqD3Mn`.

The launcher completed a local synthetic `--stdin-json` validation against the running app.

After the round-1 remediation, the same local flow and launcher validation were rerun successfully
from `/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/tmp.FWWd1xBSEW`; its generated-use prompt
was `/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/tmp.wBE8S4Yyrz` and again named the skill and
bundled launcher.

R2 pending post-merge, do not run before the public default branch contains this work:

```bash
npx skills add jackkfan0305/truss --list
remote_skill_prompt="$(mktemp)"
npx skills use jackkfan0305/truss@render-truss-diagram > "$remote_skill_prompt"
rg 'render-truss-diagram|open-truss-diagram.mjs' "$remote_skill_prompt"
```
