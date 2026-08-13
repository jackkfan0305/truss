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
