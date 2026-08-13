---
name: render-truss-diagram
description: Open Truss in the user's browser and immediately create a new titled system architecture diagram from their description. Use when the user asks an agent to create, draw, visualize, or render a system design in Truss. Requires a user-specified title and description; asks only for whichever value is missing.
---

# Render Truss Diagram

1. Preserve the user's title and description after trimming whitespace. Do not invent a title when one is missing.
2. Reject titles over 120 characters and descriptions over 2,000 characters with a concise request to shorten that value.
3. Run `scripts/open-truss-diagram.mjs` from this skill directory. Prefer a process API that passes an argument array. With a shell-only terminal, start it with `--stdin-json` and send one JSON object through process stdin so user text is never shell-interpolated.
4. Set `--base-url` only when the user supplied one. Otherwise let the script resolve `TRUSS_APP_URL`, then `http://localhost:3000`.
5. On success, tell the user that Truss opened and will create a new project immediately. On failure, report the script's non-sensitive error without printing or reconstructing its encoded fragment.
