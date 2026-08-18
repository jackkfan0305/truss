# Agent-Invoked Diagram Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-assisted `render-truss-diagram` skill that creates one new titled Truss project and immediately renders the user's system description through the existing authenticated orchestrator.

**Architecture:** A deterministic skill launcher places a versioned payload in the URL fragment for `/agent/new`; the public client page scrubs the fragment, preserves the launch in `sessionStorage`, resumes through Clerk sign-in, and creates a recoverable project. The editor consumes only an opaque launch UUID, writes one deterministic server-authored user prompt, and starts the existing Trigger.dev orchestrator through the existing Liveblocks room.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript strict mode, Clerk 7, Liveblocks 3, Trigger.dev 4, Node.js launcher script, Zod 4, standalone `tsx` contract verification, `npx skills`.

**Spec:** `docs/superpowers/specs/2026-08-12-agent-invoked-diagram-skill-design.md`

## Global Constraints

- V1 always creates a new project; it never targets an existing project supplied by the user.
- The user must supply a title of at most 120 trimmed characters and a description of at most 2,000 trimmed characters.
- Creation starts immediately once both inputs and authentication are available; there is no review screen.
- Sensitive title and description content travels in a URL fragment, is scrubbed before authentication or mutation, and never appears in a query string or application log.
- Clerk remains the only user authentication mechanism; the launch UUID is correlation data, not a credential.
- Existing project, chat, orchestration, Trigger.dev, Liveblocks, and canvas schemas remain authoritative.
- Manual project creation and manual AI chat behavior must remain unchanged.
- The launch uses the application's default model and thinking level.
- Do not add a database model, a new background task, or a second diagram generator.
- Use immutable state transitions and validate unknown input at every browser and server boundary.
- Use the existing dark semantic CSS tokens; do not introduce raw palette classes or hardcoded colors.
- Keep `.agents/skills/render-truss-diagram/` as the single source for both repository use and `npx skills` distribution.
- Update `context/progress-tracker.md` after every meaningful implementation task.

---

### Task 1: Define the versioned launch contract

**Files:**

- Create: `lib/agent-launch.ts`
- Create: `scripts/verify-agent-launch.ts`
- Modify: `lib/project-requests.ts:8-10,57-82`
- Modify: `package.json:14-16`
- Modify: `context/architecture-context.md:15-22,53-64`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: `MAX_CHAT_CONTENT_LENGTH` from `types/tasks.ts`; the existing project-name limit from `lib/project-requests.ts`.
- Produces:

```ts
export const AGENT_LAUNCH_VERSION = 1 as const;
export const AGENT_LAUNCH_PATH = "/agent/new";
export const AGENT_LAUNCH_QUERY_KEY = "launch";
export const AGENT_LAUNCH_STORAGE_PREFIX = "truss:agent-launch:v1:";
export const MAX_AGENT_LAUNCH_FRAGMENT_LENGTH = 16_384;

export interface AgentLaunchPayloadV1 {
  version: typeof AGENT_LAUNCH_VERSION;
  launchId: string;
  title: string;
  description: string;
}

export type AgentLaunchStage =
  | "captured"
  | "creating-project"
  | "project-created"
  | "sending-prompt"
  | "prompt-sent"
  | "starting-run"
  | "run-started"
  | "failed";

export interface AgentLaunchRecord extends AgentLaunchPayloadV1 {
  stage: AgentLaunchStage;
  projectId?: string;
  promptMessageId?: string;
  error?: string;
}

export function isAgentLaunchId(value: unknown): value is string;
export function parseAgentLaunchFragment(hash: string): AgentLaunchPayloadV1 | null;
export function parseAgentLaunchRecord(raw: string | null): AgentLaunchRecord | null;
export function createAgentLaunchRecord(payload: AgentLaunchPayloadV1): AgentLaunchRecord;
export function agentLaunchStorageKey(launchId: string): string;
export function withAgentLaunchStage(
  record: AgentLaunchRecord,
  stage: AgentLaunchStage,
  fields?: Pick<AgentLaunchRecord, "projectId" | "promptMessageId" | "error">,
): AgentLaunchRecord;
```

`withAgentLaunchStage` throws for transitions outside this explicit graph:

```text
captured -> creating-project | failed
creating-project -> creating-project | project-created | failed
project-created -> sending-prompt | failed
sending-prompt -> prompt-sent | failed
prompt-sent -> starting-run | failed
starting-run -> run-started | failed
failed -> creating-project | sending-prompt | starting-run | failed
run-started -> no further stage
```

The same-stage `creating-project` transition is only for replacing a collided precomputed ID. The `failed` exits support retry at the last safe boundary, chosen from the IDs already persisted on the record.

- Exposes `MAX_PROJECT_NAME_LENGTH = 120` from `lib/project-requests.ts`; `parseProjectName` must use that exported constant.

- [ ] **Step 1: Write the failing launch-contract verification**

Create `scripts/verify-agent-launch.ts` with boundary and immutability checks:

```ts
import assert from "node:assert/strict";

import {
  AGENT_LAUNCH_VERSION,
  agentLaunchStorageKey,
  createAgentLaunchRecord,
  isAgentLaunchId,
  parseAgentLaunchFragment,
  parseAgentLaunchRecord,
  withAgentLaunchStage,
} from "../lib/agent-launch";

const launchId = "00000000-0000-4000-8000-000000000001";
const payload = {
  version: AGENT_LAUNCH_VERSION,
  launchId,
  title: "Global Checkout Platform",
  description: "Show regional gateways, orders, payments, and failure queues.",
};
const fragment = Buffer.from(JSON.stringify(payload)).toString("base64url");

assert.deepEqual(parseAgentLaunchFragment(`#${fragment}`), payload);
assert.equal(agentLaunchStorageKey(launchId), `truss:agent-launch:v1:${launchId}`);
assert.equal(isAgentLaunchId(launchId), true);
assert.equal(isAgentLaunchId(launchId.toUpperCase()), false);
assert.equal(parseAgentLaunchFragment("#not-base64url"), null);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, version: 2 })).toString("base64url")}`,
  ),
  null,
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, title: "x".repeat(121) })).toString("base64url")}`,
  ),
  null,
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, description: "x".repeat(2_001) })).toString("base64url")}`,
  ),
  null,
);

const captured = createAgentLaunchRecord(payload);
const creating = withAgentLaunchStage(captured, "creating-project", {
  projectId: "global-checkout-a1b2c3",
});
assert.equal(captured.stage, "captured", "the original record is immutable");
assert.equal(creating.stage, "creating-project");
assert.equal(creating.projectId, "global-checkout-a1b2c3");
assert.deepEqual(parseAgentLaunchRecord(JSON.stringify(creating)), creating);
assert.equal(parseAgentLaunchRecord("{}"), null);
assert.throws(() => withAgentLaunchStage(captured, "run-started"));
assert.throws(() => withAgentLaunchStage(
  withAgentLaunchStage(creating, "project-created"),
  "captured",
));

console.info("Agent launch contract checks passed");
```

Append `tsx scripts/verify-agent-launch.ts` to `verify:unit` in `package.json`.

- [ ] **Step 2: Run the focused verification and confirm RED**

Run: `npx tsx scripts/verify-agent-launch.ts`

Expected: FAIL because `lib/agent-launch.ts` does not exist and `MAX_PROJECT_NAME_LENGTH` is not exported.

- [ ] **Step 3: Implement the shared parser and immutable record helpers**

Use Zod for the object boundary and a browser-compatible base64url decoder:

```ts
import { z } from "zod";

import { MAX_PROJECT_NAME_LENGTH } from "@/lib/project-requests";
import { MAX_CHAT_CONTENT_LENGTH } from "@/types/tasks";

const AGENT_LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const agentLaunchPayloadSchema = z.object({
  version: z.literal(AGENT_LAUNCH_VERSION),
  launchId: z.string().regex(AGENT_LAUNCH_ID_PATTERN),
  title: z.string().trim().min(1).max(MAX_PROJECT_NAME_LENGTH),
  description: z.string().trim().min(1).max(MAX_CHAT_CONTENT_LENGTH),
});

function decodeBase64Url(value: string): string | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
```

Reject the fragment before decoding when it is blank or longer than `MAX_AGENT_LAUNCH_FRAGMENT_LENGTH`. Parse JSON inside `try/catch`, use `safeParse`, enforce the transition graph above, and return a newly allocated record from every helper.

- [ ] **Step 4: Run the focused contract and project parser checks**

Run: `npx tsx scripts/verify-agent-launch.ts && npx tsx scripts/verify-project-api.ts`

Expected: PASS, including title length 120 and description length 2,000 boundaries.

- [ ] **Step 5: Record the launch boundary before later implementation**

Add an `Agent Skill Launches` subsection to `context/architecture-context.md` stating that `/agent/new` is the sole public capture page, fragments are scrubbed into `sessionStorage`, only an opaque UUID reaches editor query state, and all mutations remain authenticated. Add Task 1 completion and its two passing commands to `context/progress-tracker.md`.

- [ ] **Step 6: Run static checks for this task**

Run: `npm run typecheck && npx eslint lib/agent-launch.ts lib/project-requests.ts scripts/verify-agent-launch.ts`

Expected: PASS with no TypeScript or ESLint findings.

- [ ] **Step 7: Commit the launch contract**

```bash
git add lib/agent-launch.ts lib/project-requests.ts scripts/verify-agent-launch.ts package.json context/architecture-context.md context/progress-tracker.md
git commit -m "feat: define agent diagram launch contract"
```

---

### Task 2: Build and validate the distributable skill launcher

**Files:**

- Create: `.agents/skills/render-truss-diagram/SKILL.md`
- Create: `.agents/skills/render-truss-diagram/agents/openai.yaml`
- Create: `.agents/skills/render-truss-diagram/scripts/open-truss-diagram.mjs`
- Create: `scripts/verify-render-truss-skill.mjs`
- Modify: `package.json:14-16`
- Modify: `README.md:131-155`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: the v1 payload shape and limits from Task 1; an optional `TRUSS_APP_URL` environment value.
- Produces:

```js
export function parseLauncherInput(argv, stdinJson);
export function normalizeBaseUrl(rawUrl);
export function buildLaunchUrl(input, options);
export function browserCommand(url, platform);
export async function openLaunchUrl(url, platform, spawnImpl);
export function formatLauncherSuccess(baseUrl, launchId);
```

- CLI forms:

```text
node open-truss-diagram.mjs --title <title> --description <description> [--base-url <url>]
node open-truss-diagram.mjs --stdin-json [--base-url <url>]
```

- [ ] **Step 1: Write a failing skill-package verification**

Create `scripts/verify-render-truss-skill.mjs` using `node:assert` and dynamic import. Test the launcher's public behavior rather than grepping instruction files. Assert all of the following:

```js
const input = {
  title: "Global Checkout",
  description: "Show gateways, orders, payments, and queues.",
};
const launchId = "00000000-0000-4000-8000-000000000001";
const launchUrl = buildLaunchUrl(input, {
  baseUrl: "https://truss.example/",
  launchId,
});
const parsedUrl = new URL(launchUrl);
assert.equal(parsedUrl.pathname, "/agent/new");
assert.equal(parsedUrl.search, "");
assert.ok(parsedUrl.hash.length > 1);
assert.deepEqual(browserCommand(launchUrl, "darwin"), {
  command: "open",
  args: [launchUrl],
});
const spawnCalls = [];
const fakeChild = { unrefCalled: false, unref() { this.unrefCalled = true; } };
await openLaunchUrl(launchUrl, "linux", (...args) => {
  spawnCalls.push(args);
  return fakeChild;
});
assert.deepEqual(spawnCalls[0], [
  "xdg-open",
  [launchUrl],
  { detached: true, shell: false, stdio: "ignore" },
]);
assert.equal(fakeChild.unrefCalled, true);
assert.throws(() => normalizeBaseUrl("javascript:alert(1)"));
assert.throws(() => normalizeBaseUrl("https://user:pass@truss.example"));
assert.throws(() => normalizeBaseUrl("https://truss.example/base"));
assert.throws(() => normalizeBaseUrl("https://truss.example?prompt=secret"));
const success = formatLauncherSuccess("https://truss.example", launchId);
assert.equal(success.includes(input.title), false);
assert.equal(success.includes(input.description), false);
assert.equal(success.includes(parsedUrl.hash), false);
```

Append `node scripts/verify-render-truss-skill.mjs` to `verify:unit`.

- [ ] **Step 2: Run the verifier and confirm RED**

Run: `node scripts/verify-render-truss-skill.mjs`

Expected: FAIL because the skill package does not exist.

- [ ] **Step 3: Initialize the skill with the required generator**

Run exactly:

```bash
python /Users/jackfan/.codex/skills/.system/skill-creator/scripts/init_skill.py \
  render-truss-diagram \
  --path .agents/skills \
  --resources scripts \
  --interface 'display_name=Render Truss Diagram' \
  --interface 'short_description=Create architecture diagrams in Truss' \
  --interface 'default_prompt=Use $render-truss-diagram to create a new titled Truss architecture diagram from my description.'
```

Expected: the generator creates `SKILL.md`, `agents/openai.yaml`, and an empty `scripts/` directory. Do not use `--examples`.

- [ ] **Step 4: Replace the template with the concise workflow**

Use only `name` and `description` in `SKILL.md` frontmatter:

```markdown
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
```

Keep the generated `agents/openai.yaml` exactly aligned with the three interface values in Step 3. Do not add icons, brand colors, dependencies, assets, a README, or reference files.

- [ ] **Step 5: Implement the launcher without shell interpolation**

Use `node:crypto.randomUUID`, `node:child_process.spawn`, and `node:readline/promises`. The payload construction must be:

```js
const payload = {
  version: 1,
  launchId,
  title: input.title.trim(),
  description: input.description.trim(),
};
const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
return `${baseUrl}/agent/new#${encoded}`;
```

For `--stdin-json`, read one JSON object from stdin and validate the same fields. Accept only an HTTP(S) origin as the base URL: reject credentials, non-root paths, query strings, and fragments. `browserCommand` returns `{ command, args }` for `open`, `xdg-open`, or `cmd.exe /d /s /c start "" <url>`; the final URL contains only base64url fragment characters and the validated origin. Call `spawn(command, args, { detached: true, shell: false, stdio: "ignore" })`, `unref()` the child, and never print the full URL, title, description, or encoded fragment. Guard the CLI entry point so importing the module for tests never launches a browser.

- [ ] **Step 6: Run skill and launcher validation**

Run:

```bash
python /Users/jackfan/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/render-truss-diagram
node scripts/verify-render-truss-skill.mjs
npx skills add . --list
```

Expected: validation says `Skill is valid!`; the launcher verifier passes; CLI discovery lists `render-truss-diagram` from `.agents/skills`.

- [ ] **Step 7: Document installation and verify the safe local package path**

Add a `Render diagrams from an agent` section to `README.md` containing:

```bash
npx skills add jackkfan0305/truss \
  --skill render-truss-diagram \
  --agent codex
```

Document `TRUSS_APP_URL=https://your-truss-host.example` and the localhost fallback; this value must be an origin without a path. State that the public GitHub install becomes available after this change reaches the public default branch.

Then verify from a separate temporary project so the installer never overlaps its `.agents/skills` source:

```bash
truss_repo_path="$(pwd)"
skill_install_dir="$(mktemp -d)"
(
  cd "$skill_install_dir"
  npx skills add "$truss_repo_path" --skill render-truss-diagram --agent codex --copy --yes
  test -f .agents/skills/render-truss-diagram/SKILL.md
  test -f .agents/skills/render-truss-diagram/agents/openai.yaml
  test -f .agents/skills/render-truss-diagram/scripts/open-truss-diagram.mjs
)
```

Expected: all three `test -f` checks pass. Leave the temporary directory in place for inspection; do not delete it as part of this task.

- [ ] **Step 8: Record and commit the skill package**

Update `context/progress-tracker.md` with quick validation, launcher verification, CLI discovery, and clean-copy installation results.

```bash
git add .agents/skills/render-truss-diagram scripts/verify-render-truss-skill.mjs package.json README.md context/progress-tracker.md
git commit -m "feat: add Truss diagram rendering skill"
```

---

### Task 3: Capture launches and create recoverable projects

**Files:**

- Create: `lib/agent-launch-browser.ts`
- Create: `components/agent/agent-launch-page.tsx`
- Create: `app/agent/new/page.tsx`
- Create: `scripts/verify-agent-launch-page.tsx`
- Modify: `proxy.ts:3-25`
- Modify: `app/api/projects/[projectId]/route.ts:1-42`
- Modify: `lib/room-id.ts:21-50`
- Modify: `hooks/use-project-actions.ts:1-80`
- Modify: `package.json:14-16`
- Modify: `context/ui-context.md`
- Modify: `context/architecture-context.md`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: `AgentLaunchRecord`, `AGENT_LAUNCH_PATH`, storage keys, UUID parser, `buildRoomId`, and authenticated `/api/projects` routes.
- Produces:

```ts
export interface AgentLaunchStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AgentLaunchProjectDependencies {
  fetch: typeof fetch;
  createSuffix: () => string;
  storage: AgentLaunchStorage;
}

export function captureAgentLaunch(
  hash: string,
  resumeLaunchId: string | null,
  storage: AgentLaunchStorage,
  scrubFragment: () => void,
): AgentLaunchRecord | null;

export function getStoredAgentLaunch(
  launchId: string,
  storage: AgentLaunchStorage,
): AgentLaunchRecord | null;

export function createAgentLaunchProject(
  record: AgentLaunchRecord,
  dependencies: AgentLaunchProjectDependencies,
): Promise<AgentLaunchRecord>;

export function startAgentLaunchProjectOnce(
  launchId: string,
  operation: () => Promise<AgentLaunchRecord>,
): Promise<AgentLaunchRecord>;
```

- Adds owner-only `GET /api/projects/[projectId] -> { project: ProjectSummary }` for conflict recovery.
- Exports `createRoomIdSuffix(randomUuid?: () => string): string` from `lib/room-id.ts` and replaces the private duplicate in `hooks/use-project-actions.ts` in this task.

- [ ] **Step 1: Write failing browser-state and project-recovery checks**

In `scripts/verify-agent-launch-page.tsx`, use an in-memory `Map` storage and injected fetch. Cover:

```ts
const first = startAgentLaunchProjectOnce(launchId, operation);
const second = startAgentLaunchProjectOnce(launchId, operation);
assert.equal(first, second, "Strict Mode remounts share one in-tab operation");
await Promise.all([first, second]);
assert.equal(postCount, 1);

const recovered = await createAgentLaunchProject(capturedRecord, {
  storage,
  createSuffix: () => "a1b2c3",
  fetch: async (input, init) => {
    requests.push({ input: String(input), method: init?.method ?? "GET" });
    if (init?.method === "POST") return Response.json({ error: "taken" }, { status: 409 });
    return Response.json({
      project: { id: "global-checkout-a1b2c3", name: "Global Checkout" },
    });
  },
});
assert.equal(recovered.stage, "project-created");
assert.equal(recovered.projectId, "global-checkout-a1b2c3");
```

Also assert that capture calls `scrubFragment` before `storage.setItem`, an invalid fragment performs neither action, a resume query reads only the matching session key, a 401 becomes `failed`, and an inaccessible 409 rotates the suffix only once.

Render the launch status component to static markup and assert `role="status"`, the requested title appears as text, failures use `role="alert"`, and Retry is a real button.

- [ ] **Step 2: Run the page verification and confirm RED**

Run: `npx tsx scripts/verify-agent-launch-page.tsx`

Expected: FAIL because the browser workflow and launch components do not exist.

- [ ] **Step 3: Implement capture, storage, and recoverable project creation**

In `lib/agent-launch-browser.ts`, keep a module-scoped `Map<string, Promise<AgentLaunchRecord>>` for same-tab Strict Mode deduplication. `startAgentLaunchProjectOnce` must not be declared `async`; return the cached promise object directly so duplicate callers receive the same identity, and delete the cache entry in `finally` only after the operation settles so the Retry action can start a new attempt. `captureAgentLaunch` must execute in this order:

```ts
const payload = parseAgentLaunchFragment(hash);
if (payload) {
  scrubFragment();
  const record = createAgentLaunchRecord(payload);
  storage.setItem(agentLaunchStorageKey(payload.launchId), JSON.stringify(record));
  return record;
}
```

When resuming, accept only a canonical UUID and a record whose `launchId` matches the query. For project creation, persist `creating-project` with the precomputed ID before POST. On 409, GET the same ID and continue only for an HTTP 200 project with the same ID and title. Otherwise generate one new suffix, persist the replacement ID, and POST once more. Return `failed` with a user-safe message for all non-recoverable responses.

- [ ] **Step 4: Add the authenticated recovery read**

Add a `GET` export before `PATCH` in `app/api/projects/[projectId]/route.ts`:

```ts
export async function GET(
  _request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;
  const access = await authorizeProject(projectId, { requireOwner: true });

  if (!access.ok) return access.response;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });

  return project
    ? Response.json({ project })
    : jsonError("Project not found", 404);
}
```

This route is owner-only because a launch can recover only a project it created for the current user.

- [ ] **Step 5: Make only the capture page public and implement automatic sign-in resume**

Add `AGENT_LAUNCH_PATH` to `PUBLIC_PATHS` in `proxy.ts`; do not make `/editor` or any API path public. Export `isPublicPath` for the verification script.

Create a server `app/agent/new/page.tsx` that awaits the Next.js 16 `searchParams` promise and passes only a canonical string `launch` value to the client component:

```tsx
export default async function AgentNewPage({
  searchParams,
}: {
  searchParams: Promise<{ launch?: string | string[] }>;
}) {
  const rawLaunchId = (await searchParams).launch;
  const resumeLaunchId = isAgentLaunchId(rawLaunchId) ? rawLaunchId : null;
  return <AgentLaunchPage resumeLaunchId={resumeLaunchId} />;
}
```

In `AgentLaunchPage`, use `useAuth()` and `useClerk()`. Once capture is complete and Clerk is loaded, signed-out users call:

```ts
await clerk.redirectToSignIn({
  redirectUrl: `${AGENT_LAUNCH_PATH}?${AGENT_LAUNCH_QUERY_KEY}=${record.launchId}`,
});
```

Signed-in users call `startAgentLaunchProjectOnce`; successful creation uses `router.replace(`/editor/${record.projectId}?launch=${record.launchId}`)`. The page shows only the compact statuses approved in the spec and uses semantic page/surface/copy tokens.

- [ ] **Step 6: Update focused docs and run verification**

Add the launch status surface and immediate post-auth behavior to `context/ui-context.md`. Extend the launch subsection in `context/architecture-context.md` with owner-only 409 recovery. Add Task 3 results to `context/progress-tracker.md`.

Run:

```bash
npx tsx scripts/verify-agent-launch-page.tsx
npx tsx scripts/verify-project-api.ts
npx tsx scripts/verify-editor-controls.tsx
npm run typecheck
npx eslint app/agent/new/page.tsx components/agent/agent-launch-page.tsx lib/agent-launch-browser.ts lib/room-id.ts proxy.ts app/api/projects/'[projectId]'/route.ts scripts/verify-agent-launch-page.tsx
```

Expected: all commands pass; `/agent/new` is public, `/editor` remains protected, and the page tests show one same-tab project POST.

- [ ] **Step 7: Commit the launch page and project recovery**

```bash
git add app/agent/new/page.tsx components/agent/agent-launch-page.tsx lib/agent-launch-browser.ts lib/room-id.ts hooks/use-project-actions.ts proxy.ts app/api/projects/'[projectId]'/route.ts scripts/verify-agent-launch-page.tsx package.json context/ui-context.md context/architecture-context.md context/progress-tracker.md
git commit -m "feat: add authenticated diagram launch page"
```

---

### Task 4: Make launch prompt writes idempotent

**Files:**

- Create: `lib/agent-launch-server.ts`
- Modify: `lib/ai-chat-requests.ts:1-27`
- Modify: `app/api/ai/chat/route.ts:1-76`
- Modify: `scripts/verify-ai-chat.ts:1-285`
- Modify: `context/architecture-context.md:74-156`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: canonical `launchId`, authenticated Clerk `userId`, authorized `projectId`, and `upsertServerAiChatMessage`.
- Produces:

```ts
export interface AiChatRequest {
  projectId: string;
  content: string;
  launchId: string | null;
}

export function createAgentLaunchPromptMessageId(input: {
  launchId: string;
  projectId: string;
  userId: string;
}): string;

export interface AiChatWriteDependencies {
  create: typeof createServerAiChatMessage;
  upsert: typeof upsertServerAiChatMessage;
}

export function writeAuthenticatedAiChatMessage(
  request: AiChatRequest,
  senderId: string,
  user: AuthenticatedAiChatUser,
  dependencies?: AiChatWriteDependencies,
): Promise<{ id: string; isIdempotent: boolean }>;
```

Export the existing `AuthenticatedAiChatUser` interface because it appears in the exported write-controller signature.

- [ ] **Step 1: Extend the existing chat verification before implementation**

Add parser assertions to `scripts/verify-ai-chat.ts`:

```ts
assert.deepEqual(
  parseAiChatRequest({ projectId: "project-1", content: " hello ", launchId }),
  { projectId: "project-1", content: "hello", launchId },
);
assert.deepEqual(
  parseAiChatRequest({ projectId: "project-1", content: "hello" }),
  { projectId: "project-1", content: "hello", launchId: null },
);
assert.equal(
  parseAiChatRequest({ projectId: "project-1", content: "hello", launchId: "invented" }),
  null,
);
```

Add deterministic ID assertions:

```ts
const id = createAgentLaunchPromptMessageId({ launchId, projectId: "project-1", userId: "user-1" });
assert.equal(id, createAgentLaunchPromptMessageId({ launchId, projectId: "project-1", userId: "user-1" }));
assert.notEqual(id, createAgentLaunchPromptMessageId({ launchId, projectId: "project-2", userId: "user-1" }));
assert.notEqual(id, createAgentLaunchPromptMessageId({ launchId, projectId: "project-1", userId: "user-2" }));
assert.match(id, /^chat-launch-[0-9a-f]{64}$/);
```

Inject create/upsert spies into `writeAuthenticatedAiChatMessage`; assert manual requests call `create` once, launch requests call `upsert` with the derived ID, and two launch replays return the same ID.

- [ ] **Step 2: Run the chat verifier and confirm RED**

Run: `npx tsx scripts/verify-ai-chat.ts`

Expected: FAIL because launch IDs and deterministic launch prompt IDs are unsupported.

- [ ] **Step 3: Parse optional launch IDs without weakening manual chat**

In `parseAiChatRequest`, treat an absent `launchId` as `null`; reject any present value that is not a canonical UUID. Continue trimming and enforcing the existing content limit. Return a new object and do not accept a caller-provided feed message ID.

- [ ] **Step 4: Derive the server-only prompt ID and select create versus upsert**

In `lib/agent-launch-server.ts`, use `node:crypto`:

```ts
import { createHash } from "node:crypto";

export function createAgentLaunchPromptMessageId(input: {
  launchId: string;
  projectId: string;
  userId: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([input.userId, input.projectId, input.launchId]))
    .digest("hex");
  return `chat-launch-${digest}`;
}
```

Move the write selection behind exported `writeAuthenticatedAiChatMessage`. For launch requests, derive the ID after authorization and Clerk identity resolution, then call `upsert(projectId, id, message)`. For manual requests, call `create(projectId, message)` unchanged. Return status 200 for idempotent launch writes and 201 for manual creates. Error responses remain `{ error: "Message not sent" }` with status 502 and must not log content.

- [ ] **Step 5: Run chat, orchestration, and security boundary checks**

Run:

```bash
npx tsx scripts/verify-ai-chat.ts
npx tsx scripts/verify-orchestrate-api.ts
npm run typecheck
npx eslint lib/agent-launch-server.ts lib/ai-chat-requests.ts app/api/ai/chat/route.ts scripts/verify-ai-chat.ts
```

Expected: PASS. The original verified prompt checks still prove that only the authenticated user's exact message can spend a Trigger run.

- [ ] **Step 6: Document and commit deterministic launch prompts**

Add to `context/architecture-context.md` that launch IDs are hashed with authenticated user and project IDs to choose a deterministic server-authored human feed row, and that the existing prompt-based Trigger idempotency then addresses the same run. Record Task 4 checks in `context/progress-tracker.md`.

```bash
git add lib/agent-launch-server.ts lib/ai-chat-requests.ts app/api/ai/chat/route.ts scripts/verify-ai-chat.ts context/architecture-context.md context/progress-tracker.md
git commit -m "feat: make agent launch prompts idempotent"
```

---

### Task 5: Expose one reusable AI prompt submission controller

**Files:**

- Create: `lib/ai-prompt-submission.ts`
- Create: `hooks/use-ai-prompt-submission.ts`
- Create: `scripts/verify-ai-prompt-submission.ts`
- Modify: `hooks/use-ai-chat.ts:15-105`
- Modify: `hooks/use-agent-run.ts:27-176`
- Modify: `components/editor/ai-sidebar.tsx:1-165`
- Modify: `package.json:14-16`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: `useAiChat`, `useAgentRun`, `AgentRunOptions`, and the optional launch ID from Task 4.
- Produces:

```ts
export interface AiChatSendOptions {
  launchId?: string;
}

export type AiPromptSubmissionResult =
  | { status: "message-error" }
  | { status: "run-error"; promptMessageId: string }
  | {
      status: "started";
      promptMessageId: string;
      subscription: RunSubscription;
    };

export interface AiPromptSubmissionOptions {
  launchId?: string;
  promptMessageId?: string;
  onPromptSent?: (promptMessageId: string) => void;
  onRunStarting?: (promptMessageId: string) => void;
}

export function submitAiPrompt(input: {
  text: string;
  runOptions: AgentRunOptions;
  options?: AiPromptSubmissionOptions;
  send: (text: string, options?: AiChatSendOptions) => Promise<string | null>;
  start: (
    prompt: string,
    promptMessageId: string,
    options: AgentRunOptions,
  ) => Promise<RunSubscription>;
}): Promise<AiPromptSubmissionResult>;

export function useAiPromptSubmission(roomId: string): {
  chat: AiChat;
  run: AgentRun;
  submit: (
    text: string,
    runOptions: AgentRunOptions,
    options?: AiPromptSubmissionOptions,
  ) => Promise<AiPromptSubmissionResult>;
};
```

- Changes `AgentRun.start` to return `Promise<RunSubscription>` and rethrow after recording a local start-error turn.

- [ ] **Step 1: Write failing result-shape tests**

Create `scripts/verify-ai-prompt-submission.ts` with three injected cases:

```ts
const runOptions = {
  modelId: DEFAULT_AI_DESIGN_MODEL_ID,
  thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
};

assert.deepEqual(
  await submitAiPrompt({
    text: "Design checkout",
    runOptions,
    send: async () => null,
    start: async () => ({ runId: "unreachable", token: "unreachable" }),
  }),
  { status: "message-error" },
);

assert.deepEqual(
  await submitAiPrompt({
    text: "Design checkout",
    runOptions,
    send: async () => "chat-1",
    start: async () => { throw new Error("offline"); },
  }),
  { status: "run-error", promptMessageId: "chat-1" },
);

assert.deepEqual(
  await submitAiPrompt({
    text: "Design checkout",
    runOptions,
    options: { promptMessageId: "chat-existing" },
    send: async () => { throw new Error("must be skipped"); },
    start: async () => ({ runId: "run-1", token: "token-1" }),
  }),
  {
    status: "started",
    promptMessageId: "chat-existing",
    subscription: { runId: "run-1", token: "token-1" },
  },
);
```

Append this verification to `verify:unit`.

- [ ] **Step 2: Run the new verifier and confirm RED**

Run: `npx tsx scripts/verify-ai-prompt-submission.ts`

Expected: FAIL because the submission controller does not exist.

- [ ] **Step 3: Implement the pure controller and hook composition**

`submitAiPrompt` must reuse `options.promptMessageId` when supplied, otherwise call `send(text, { launchId })`; invoke `onPromptSent` immediately after obtaining a new ID, then invoke `onRunStarting` immediately before `start`. Catch only the `start` error and return `run-error` because `useAgentRun.start` has already recorded the visible local failure.

`useAiPromptSubmission` is the only place that composes `useAiChat()` and `useAgentRun(roomId)`. It returns both existing controllers and a memoized `submit` callback.

- [ ] **Step 4: Make run starts observable and preserve manual UI behavior**

In `useAgentRun.start`, after `setSubscription(nextSubscription)`, return it. In the catch block, keep the existing reducer update, then `throw error`; `finally` still clears `isStarting`.

Extend `AiChat.send` to accept `AiChatSendOptions` and include `launchId` only when present:

```ts
body: JSON.stringify({
  projectId: roomId,
  content,
  ...(options?.launchId ? { launchId: options.launchId } : {}),
}),
```

Refactor `AiSidebar` to use `useAiPromptSubmission(roomId)`. Its manual `submit` calls the combined controller and clears the draft only when the result is not `message-error`; no unhandled rejection reaches the event handler.

- [ ] **Step 5: Run regression checks for manual chat and run state**

Run:

```bash
npx tsx scripts/verify-ai-prompt-submission.ts
npx tsx scripts/verify-ai-chat.ts
npx tsx scripts/verify-ai-run-chat.ts
npx tsx scripts/verify-ai-chat-ui.tsx
npx tsx scripts/verify-editor-controls.tsx
npm run typecheck
npx eslint lib/ai-prompt-submission.ts hooks/use-ai-prompt-submission.ts hooks/use-ai-chat.ts hooks/use-agent-run.ts components/editor/ai-sidebar.tsx scripts/verify-ai-prompt-submission.ts
```

Expected: PASS with unchanged manual composer, transcript, and run-observer behavior.

- [ ] **Step 6: Record and commit the shared controller**

Update `context/progress-tracker.md` with the controller result contract and regression commands.

```bash
git add lib/ai-prompt-submission.ts hooks/use-ai-prompt-submission.ts hooks/use-ai-chat.ts hooks/use-agent-run.ts components/editor/ai-sidebar.tsx scripts/verify-ai-prompt-submission.ts package.json context/progress-tracker.md
git commit -m "refactor: share AI prompt submission flow"
```

---

### Task 6: Consume a launch exactly once inside the editor

**Files:**

- Create: `lib/agent-launch-runner.ts`
- Create: `hooks/use-agent-launch-prompt.ts`
- Create: `scripts/verify-agent-launch-editor.tsx`
- Modify: `app/editor/[roomId]/page.tsx:10-55`
- Modify: `components/editor/editor-shell.tsx:18-120`
- Modify: `components/editor/ai-sidebar.tsx:20-180`
- Modify: `package.json:14-16`
- Modify: `context/ui-context.md`
- Modify: `context/architecture-context.md`
- Modify: `context/progress-tracker.md`

**Interfaces:**

- Consumes: session launch records, `AiPromptSubmissionResult`, the active project/room ID, and the default model settings.
- Produces:

```ts
export interface AgentLaunchPromptDependencies {
  load: () => AgentLaunchRecord | null;
  save: (record: AgentLaunchRecord) => void;
  remove: () => void;
  submit: (
    text: string,
    runOptions: AgentRunOptions,
    options: AiPromptSubmissionOptions,
  ) => Promise<AiPromptSubmissionResult>;
  scrubQuery: () => void;
}

export type AgentLaunchPromptResult =
  | { status: "ignored" }
  | { status: "failed"; message: string }
  | { status: "started"; runId: string };

export function runAgentLaunchPrompt(input: {
  launchId: string;
  roomId: string;
  dependencies: AgentLaunchPromptDependencies;
}): Promise<AgentLaunchPromptResult>;

export function startAgentLaunchPromptOnce(
  launchId: string,
  operation: () => Promise<AgentLaunchPromptResult>,
): Promise<AgentLaunchPromptResult>;

export function useAgentLaunchPrompt(input: {
  launchId?: string;
  roomId: string;
  canStart: boolean;
  submit: ReturnType<typeof useAiPromptSubmission>["submit"];
}): { error: string | null; retry: () => void };
```

- Adds `launchId?: string` to `EditorShellProps` and `AiSidebarProps`.

- [ ] **Step 1: Write failing editor-launch checks**

Create `scripts/verify-agent-launch-editor.tsx`. With injected storage and submit spies, prove:

```ts
const first = startAgentLaunchPromptOnce(launchId, operation);
const second = startAgentLaunchPromptOnce(launchId, operation);
assert.equal(first, second);
await Promise.all([first, second]);
assert.equal(submitCount, 1, "Strict Mode shares one in-tab prompt operation");

const started = await runAgentLaunchPrompt({
  launchId,
  roomId: "global-checkout-a1b2c3",
  dependencies,
});
assert.deepEqual(started, { status: "started", runId: "run-1" });
assert.equal(savedStages.includes("sending-prompt"), true);
assert.equal(savedStages.includes("prompt-sent"), true);
assert.equal(savedStages.includes("starting-run"), true);
assert.equal(removeCount, 1);
assert.equal(scrubCount, 1);
```

Add cases for mismatched project ID (`ignored`, zero submits), message failure (saved `failed`, no prompt ID), run failure (saved `failed` with prompt ID), and retry with an existing prompt ID (send is skipped by Task 5's controller). Static-render `EditorShell`/`AiSidebar` probes to verify a launch opens `aria-expanded="true"` and renders a Retry button only for launch failure.

Append `tsx scripts/verify-agent-launch-editor.tsx` to `verify:unit`.

- [ ] **Step 2: Run the editor verifier and confirm RED**

Run: `npx tsx scripts/verify-agent-launch-editor.tsx`

Expected: FAIL because no editor launch runner exists.

- [ ] **Step 3: Implement the pure runner and same-tab promise registry**

Use a module-scoped `Map<string, Promise<AgentLaunchPromptResult>>` as in Task 3. `startAgentLaunchPromptOnce` must return the cached promise directly and remove it in `finally` after settlement, allowing an explicit Retry after failure. `runAgentLaunchPrompt` must:

1. Load and validate the record.
2. Ignore records whose launch or project ID does not match.
3. Persist `sending-prompt` before submission when no prompt ID exists.
4. Pass `launchId`, any existing `promptMessageId`, an `onPromptSent` callback that persists `prompt-sent`, and an `onRunStarting` callback that persists `starting-run`.
5. Wait for the run result after `onRunStarting` has recorded the boundary.
6. Persist `failed` with a user-safe message on either error result.
7. On success, persist `run-started`, remove the session key, scrub the query, and return the accepted run ID.

The runner never logs the title or description.

- [ ] **Step 4: Pass the opaque launch query through the server page**

Update the Next.js 16 page props and await both promises:

```tsx
interface EditorRoomPageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ launch?: string | string[] }>;
}

const [{ roomId }, query, identity] = await Promise.all([
  params,
  searchParams,
  getCurrentIdentity(),
]);
const launchId = isAgentLaunchId(query.launch) ? query.launch : undefined;
```

Pass `launchId` into `EditorShell`. Do not read the sensitive payload on the server.

- [ ] **Step 5: Open the sidebar and run only after the room identity is ready**

Initialize `EditorShell` sidebar state with `launchId ? "ai" : null` and pass the ID to `AiSidebar` only for an active project. In `AiSidebar`, call `useAgentLaunchPrompt` with `canStart: canSend && !isSending && !isRunning` and the shared submit controller from Task 5.

On accepted start, scrub only the query through the native History API without navigating or remounting the run observer:

```ts
const url = new URL(window.location.href);
url.searchParams.delete(AGENT_LAUNCH_QUERY_KEY);
window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
```

Render a monochrome launch failure row above the composer with `role="alert"`, a concise message, and a small Retry button. Existing chat error rendering remains separate.

- [ ] **Step 6: Run focused and full launch verification**

Load the project-local `react-doctor` skill for its completion workflow, then run:

```bash
npx tsx scripts/verify-agent-launch-editor.tsx
npx tsx scripts/verify-ai-prompt-submission.ts
npx tsx scripts/verify-ai-chat-ui.tsx
npx tsx scripts/verify-editor-controls.tsx
npm test
npm run typecheck
npx eslint lib/agent-launch-runner.ts hooks/use-agent-launch-prompt.ts app/editor/'[roomId]'/page.tsx components/editor/editor-shell.tsx components/editor/ai-sidebar.tsx scripts/verify-agent-launch-editor.tsx
```

Expected: PASS; normal editor URLs start with both sidebars closed, launch URLs open only AI, and duplicate same-tab effects produce one prompt operation.

- [ ] **Step 7: Update context and commit the editor handoff**

Update `context/ui-context.md` with automatic AI sidebar opening and neutral retry treatment. Complete the launch data flow and idempotency notes in `context/architecture-context.md`. Record Task 6 verification in `context/progress-tracker.md`.

```bash
git add lib/agent-launch-runner.ts hooks/use-agent-launch-prompt.ts app/editor/'[roomId]'/page.tsx components/editor/editor-shell.tsx components/editor/ai-sidebar.tsx scripts/verify-agent-launch-editor.tsx package.json context/ui-context.md context/architecture-context.md context/progress-tracker.md
git commit -m "feat: start diagram generation from agent launches"
```

---

### Task 7: Verify the complete browser and distribution flow

**Files:**

- Modify: `context/progress-tracker.md`
- Verify only: all files changed in Tasks 1-6

**Interfaces:**

- Consumes: the completed skill package, launch page, authenticated project/chat routes, editor runner, existing Trigger.dev worker, and public GitHub source.
- Produces: verified signed-in and signed-out user flows; verified project-level `npx skills` package; final progress record. Public-source verification remains an explicitly recorded post-merge check because publishing the branch is outside this implementation plan.

- [ ] **Step 1: Run the complete deterministic suite**

Run:

```bash
npm test
npm run verify:integration
npm run typecheck
npm run lint
npm run build
npm run doctor -- --verbose --scope changed
```

Expected: every command exits 0; React Doctor's score does not regress from the branch baseline. If the integration environment variables are unavailable, do not mark this task complete until the same commands run in the configured environment.

- [ ] **Step 2: Exercise the signed-in browser flow**

Start the application and worker with `npm run dev`. From a second terminal, invoke the installed skill with title `Global Checkout Platform` and description `Show regional API gateways, an order service, payment providers, an event bus, inventory, and failure queues.`

Expected, in order:

1. The browser opens `/agent/new#...` and the fragment disappears immediately.
2. One project named `Global Checkout Platform` is created.
3. The browser opens `/editor/<projectId>?launch=<uuid>`, the AI sidebar is open, and the query disappears after start acceptance.
4. The description appears once in the shared transcript.
5. One run appears and nodes/edges progressively arrive on the canvas.
6. Refreshing during project creation or run start does not create a second project, prompt, or logical Trigger run.

- [ ] **Step 3: Exercise the signed-out resume and privacy flow**

Repeat the same invocation in a signed-out browser profile.

Expected: `/agent/new` captures and scrubs the fragment, Clerk sign-in completes, the fixed `/agent/new?launch=<uuid>` return resumes automatically, and the same six signed-in expectations hold. Inspect the browser Network panel and application logs: neither the raw description nor the base64url fragment appears in an HTTP URL or application log entry.

- [ ] **Step 4: Verify local `npx skills` use from a clean project**

Run from a new temporary directory:

```bash
truss_repo_path="$(pwd)"
skill_use_dir="$(mktemp -d)"
(
  cd "$skill_use_dir"
  npx skills add "$truss_repo_path" --skill render-truss-diagram --agent codex --copy --yes
  npx skills list --agent codex
  npx skills use "$truss_repo_path" --skill render-truss-diagram > rendered-skill-prompt.txt
  rg 'render-truss-diagram|open-truss-diagram.mjs' rendered-skill-prompt.txt
)
```

Expected: the installed list contains `render-truss-diagram` and the generated one-shot prompt names the skill and bundled launcher.

- [ ] **Step 5: Record the public-source post-merge verification command**

After the implementation reaches the public default branch, run:

```bash
npx skills add jackkfan0305/truss --list
remote_skill_prompt="$(mktemp)"
npx skills use jackkfan0305/truss@render-truss-diagram > "$remote_skill_prompt"
rg 'render-truss-diagram|open-truss-diagram.mjs' "$remote_skill_prompt"
```

Do not run this step until the implementation reaches the public default branch. Record it as pending rather than claiming a remote result from unpublished code. Once published, remote discovery must list the skill and one-shot use must include the launcher workflow. The skill becomes eligible for skills.sh discovery after public GitHub installs; no separate registry upload is performed.

- [ ] **Step 6: Record final evidence and commit the verification record**

Update `context/progress-tracker.md` with the exact deterministic commands, browser scenarios, observed run/project IDs, local `npx skills` results, and the pending public-source command. Do not include the raw diagram description or encoded fragment.

```bash
git add context/progress-tracker.md
git commit -m "docs: record agent diagram launch verification"
```

Expected: `git status --short` is empty after the commit.
