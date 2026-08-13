---
name: render-truss-diagram
description: Open Truss in the user's browser and immediately create a new titled system architecture diagram from their description. Use when the user asks an agent to create, draw, visualize, or render a system design in Truss. Requires a user-specified title and description; asks only for whichever value is missing.
---

# Render Truss Diagram

1. Preserve the user's title and description after trimming whitespace. Do not invent a title when one is missing. Ask only for the missing title or description.
2. Reject titles over 120 characters and descriptions over 2,000 characters with a concise request to shorten that value.
3. Read [the compact graph contract](references/graph-schema.md). Infer the architecture from the description and produce one positioned compact graph that conforms exactly to it. Do not include secrets in labels.
4. Keep the primary request path left to right. Keep node origins at least 240 flow units apart horizontally and 150 vertically. Put supporting systems on secondary rows. Use stable lowercase kebab-case IDs, concise labels, consistent colors, cylinders for durable stores, diamonds for decisions/routing, circles for people or external actors, and simple shapes for services.
5. Run `scripts/open-truss-diagram.mjs` from this skill directory. Pass no graph data in shell arguments: invoke it with only `--stdin-json` (and optionally `--base-url <origin>`) and send exactly one JSON object with `{ "title": "…", "graph": { … } }` through process stdin. Prefer a process API that passes an argument array.
6. Set `--base-url` only when the user supplied one. Otherwise let the script resolve `TRUSS_APP_URL`, then `http://localhost:3000`.
7. On success, tell the user that Truss opened and will create a new project immediately. On failure, report the script's non-sensitive error without printing, reconstructing, or describing its encoded fragment or graph.
