# Task 2 — caller-generated graph skill launcher

## RED

Updated `scripts/verify-render-truss-skill.mjs` before changing the launcher,
then ran:

```text
node scripts/verify-render-truss-skill.mjs
```

Expected failure observed: the previous launcher rejected `{ title, graph }`
with `A title and description are required.`

## GREEN

- Replaced the description boundary with strict `{ title, graph }` stdin JSON.
- Added dependency-free compact graph validation, cardinality/topology checks,
  exact v1 fragment encoding, and the 16,384-character fragment cap.
- Preserved optional origin validation, argument-array browser spawning, and
  privacy-safe errors/output.
- Added the skill's graph-generation rubric and bundled graph-contract
  reference. Preserved the existing official `agents/openai.yaml` values.

## Verification commands

```text
node scripts/verify-render-truss-skill.mjs
python3 /Users/jackfan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/render-truss-diagram
npx skills add . --list
npx skills add "$repo_path" --skill render-truss-diagram --agent codex --copy --yes
npx skills list --agent codex
npx skills use "$repo_path" --skill render-truss-diagram
```

All commands above passed. The clean copied install was verified in
`/tmp/truss-skill-kriIce`, including the launcher, OpenAI metadata, and bundled
reference file. A direct invalid-input privacy probe emitted only a generic
error and did not echo graph content.

## Self-review

Reviewed the staged diff for boundary validation, argument handling, transport,
and browser launch behavior. No critical or high-severity issues found: graph
data is accepted only from stdin, unknown fields reject the whole graph, the
fragment is bounded before spawning, browser commands remain argument arrays
with `shell: false`, and launcher messages contain neither title nor graph.

## Repository-wide gate status

`npm run verify:unit` currently stops at `verify-agent-launch-page.tsx`, and
`npx tsc --noEmit` currently fails in `lib/agent-launch-runner.ts` plus launch
page/editor verifiers. Those files still reference the retired description and
prompt/run stages from downstream tasks; this Task 2 did not modify them.

## Review fix round 1

### RED

Added consumer-level launcher parsing for the documented graph example,
canonical-whitespace regressions in both launcher and app contract verifiers,
and deterministic 16,384 / 16,386 encoded-fragment boundary fixtures. The
focused checks failed first because the documented edge referenced a missing
`client` node and app Zod schemas silently trimmed padded labels/titles.

### GREEN

- Added the missing `client` node to the documented example and parse its JSON
  through the real launcher in the verifier.
- Changed app graph-label and launch-title schemas to reject rather than trim
  non-canonical whitespace, matching the launcher boundary.
- Proved the launcher accepts a 16,384-character fragment and rejects the
  smallest constructible valid encoded payload above it (16,386 characters).

### Review verification

```text
node scripts/verify-render-truss-skill.mjs
npx tsx scripts/verify-agent-graph.ts
npx tsx scripts/verify-agent-launch.ts
npx eslint lib/agent-graph.ts lib/agent-launch.ts scripts/verify-agent-graph.ts scripts/verify-agent-launch.ts scripts/verify-render-truss-skill.mjs
python3 /Users/jackfan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/render-truss-diagram
npx skills add . --list
```

All focused checks passed. A clean copied `npx skills` add/list/use install
passed at `/tmp/truss-skill-review-wJc1ys`.

### Review self-check

Reviewed the fix diff after the focused checks. No critical or high-severity
issues found: the documented JSON is parsed through the real launcher, the app
and launcher now agree on canonical whitespace rejection, and the cap fixture
measures the actual base64url fragment rather than a proxy size.
