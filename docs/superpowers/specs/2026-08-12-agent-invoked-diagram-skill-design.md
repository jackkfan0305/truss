# Agent-Invoked Diagram Skill Design

## Summary

Add a repository-local `render-truss-diagram` agent skill that opens Truss in
the user's browser, creates one new project with the title the user supplied,
and immediately starts the existing AI orchestration flow with the user's
diagram description. The canvas remains the rendering surface, and the current
Clerk, Liveblocks, Trigger.dev, and design-agent boundaries remain authoritative.

The skill is also the public `npx skills` distribution artifact. There is one
source directory under `.agents/skills/`, not a second copy maintained for
publishing.

## Goals

1. Let a user invoke an agent skill with a title and diagram description.
2. Open a browser-based Truss launch flow without requiring an agent API token.
3. Reuse the user's existing Clerk browser session, or resume automatically
   after sign-in.
4. Create exactly one new project for each launch in v1.
5. Start generation without a confirmation screen.
6. Show the requested title in the editor and progressively render the diagram
   through the existing orchestrator and collaborative canvas.
7. Make retries safe across refreshes, React Strict Mode, and lost HTTP
   responses.
8. Make the skill installable from GitHub through `npx skills`.

## Non-Goals

- Targeting or modifying an existing project.
- Headless agent authentication or personal access tokens.
- A second diagram generator, canvas schema, or Trigger.dev task.
- Choosing a model or thinking level from the skill invocation.
- Persisting launch records in PostgreSQL.
- Supporting payloads larger than the existing project-name and chat limits.

## User Contract

The skill triggers when the user asks an agent to create, draw, visualize, or
render a system architecture diagram in Truss. It requires two values:

- `title`: the project title, trimmed and limited to 120 characters.
- `description`: the system to diagram, trimmed and limited to 2,000
  characters.

If either value is missing, the skill asks only for the missing value. With both
values present, it launches immediately. It does not paraphrase the title or
silently replace the description. The v1 invocation always creates a new
project and uses the application's default design model and thinking level.

Example:

> Create a Truss diagram titled "Global Checkout Platform" showing regional
> API gateways, an order service, payment providers, an event bus, inventory,
> and failure queues.

## Architecture

```text
User request
  -> render-truss-diagram skill
  -> deterministic launcher script
  -> /agent/new#<base64url v1 payload>
  -> validate, scrub fragment, and store session launch record
  -> Clerk sign-in when needed
  -> authenticated project creation
  -> /editor/{projectId}?launch={launchId}
  -> Liveblocks room becomes ready
  -> authenticated, idempotent human chat write
  -> existing orchestrator start
  -> existing design agent writes progressive canvas updates
```

The fragment handoff is deliberately client-only. A query string would expose
the title and description to request logs, analytics, browser history, and
referrer headers. Browser automation would avoid a new route but would couple
the skill to dialog labels and layout details. A fragment-based launch page is
the smallest stable interface that keeps the current browser authentication
model.

## Skill Package

The source lives at:

```text
.agents/skills/render-truss-diagram/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── scripts/
    └── open-truss-diagram.mjs
```

`SKILL.md` contains concise trigger and execution instructions. It tells the
agent to collect the required title and description, invoke the bundled script
with separate arguments, and report that the browser launch started. It does
not reproduce application implementation details.

`open-truss-diagram.mjs`:

1. Parses `--title`, `--description`, and optional `--base-url` arguments.
2. Resolves the base URL in this order: `--base-url`, `TRUSS_APP_URL`, then
   `http://localhost:3000`.
3. Accepts only an `http:` or `https:` base URL without credentials, query, or
   fragment, then removes its trailing slash.
4. Trims and validates the two required values against the application limits.
5. Creates a cryptographically random UUID launch ID.
6. Encodes a versioned JSON payload with base64url.
7. Opens the URL through an argument-array child process: `open` on macOS,
   `cmd /c start` with safely separated arguments on Windows, or `xdg-open` on
   Linux.
8. Prints the non-sensitive base launch URL and launch ID, but never the title,
   description, or encoded fragment.

The script never evaluates user content as a shell command. A failure to find a
platform opener exits non-zero with a non-sensitive explanation. It does not
print the complete fragment URL as a fallback because that would expose the
encoded description in terminal logs.

## Launch Payload

The v1 decoded payload has this shape:

```ts
interface AgentLaunchPayloadV1 {
  version: 1;
  launchId: string;
  title: string;
  description: string;
}
```

`launchId` must be a canonical UUID. Unknown versions, extra-large fragments,
invalid base64url, malformed JSON, non-object values, blank strings, and values
over their limits are rejected before a mutation occurs.

The browser stores a session record under
`truss:agent-launch:v1:<launchId>`. It extends the payload with:

```ts
type AgentLaunchStage =
  | "captured"
  | "creating-project"
  | "project-created"
  | "sending-prompt"
  | "prompt-sent"
  | "starting-run"
  | "run-started"
  | "failed";

interface AgentLaunchRecord extends AgentLaunchPayloadV1 {
  stage: AgentLaunchStage;
  projectId?: string;
  promptMessageId?: string;
  error?: string;
}
```

Every update replaces the stored record with a new object. The record is scoped
to the current tab through `sessionStorage`; it does not persist across browser
sessions or become a cross-tab queue.

## Launch Page

`/agent/new` is intentionally reachable before authentication so its client
component can capture and scrub the fragment before sending the user through
Clerk. Reaching the page grants no access: every mutation remains protected by
the same API authentication and authorization checks as the editor.

On first load, the page:

1. Reads the fragment once.
2. Validates it with the shared launch parser.
3. Calls `history.replaceState` to remove the fragment immediately.
4. Stores the `captured` record in `sessionStorage`.
5. If signed out, starts the existing Clerk sign-in flow with a fixed return
   path to `/agent/new?launch=<launchId>`.
6. If signed in, or after the fixed return, resumes the stored state machine.

The return path is constructed by application code and never accepted from the
payload, preventing an open redirect. The query contains only the launch UUID.

The page creates the project ID before posting by combining the title slug and
a random suffix through the existing room-ID helpers. It stores that ID before
the request. If the request succeeds but the response is lost, a retry of the
same ID returns a conflict; the launcher then reads that project through the
authenticated project route and resumes only when the current user owns the
project and its title matches. An unrelated collision generates a new suffix
and retries once.

After project creation, the page stores `project-created` and navigates to
`/editor/{projectId}?launch={launchId}`.

## Editor Handoff

The editor treats the `launch` query value only as a lookup key into
`sessionStorage`. Missing, invalid, completed, or project-mismatched launch
records are ignored. A normal editor visit behaves exactly as it does today.

For a valid pending record, the editor:

1. Opens the existing AI sidebar.
2. Waits for Liveblocks to establish the room and current user identity.
3. Claims the record by moving it to `sending-prompt` before making a request.
4. Writes the user's description through the authenticated chat route.
5. Starts the existing orchestrator with that verified prompt message ID and
   the default model settings.
6. Removes the launch query parameter and session record after the orchestrator
   returns an accepted run ID and a scoped subscription token. The shared run
   controller exposes that success or throws; it no longer swallows a start
   failure from the launch state machine.

The generated prompt appears in the shared transcript, the current run status
appears above the composer, and nodes and edges arrive through the current
Liveblocks mutation path. The navbar already renders the project title, so the
launch flow does not introduce a separate diagram-title overlay.

The launch behavior is integrated with the AI sidebar's existing submission
controller rather than mounting a second `useAgentRun` instance. There is one
run subscription and one owner of composer state per editor tab.

## Idempotency

Project creation is made recoverable by storing the client-generated project ID
before the POST and resolving an accessible matching project after a 409.

Prompt creation adds an optional `launchId` to the authenticated chat request.
When present and valid, the server derives a deterministic message ID from the
authenticated user ID, project ID, and launch ID. The server still authors the
role, sender identity, avatar, timestamp policy, and content validation. A
replay upserts and returns the same user message instead of appending another.
Manual chat requests omit `launchId` and retain their existing random IDs.

The existing orchestration idempotency key includes the verified prompt message
ID, user, and room. Once the launch chat ID is deterministic, repeated starts
address the original Trigger.dev run instead of spending a second run or
applying the canvas plan twice.

The client writes a stage before each side effect. React Strict Mode remounts
and browser refreshes therefore resume or display recovery instead of firing an
unclaimed effect twice.

## User Experience

The launch page uses the existing dark visual tokens and presents one compact
status surface. It may show these states:

- Preparing diagram
- Sign in to continue
- Creating `<title>`
- Opening canvas
- Unable to continue, with Retry and Return to editor actions

There is no review form or confirmation button. After authentication, creation
continues immediately. Once the editor opens, the AI sidebar is visible and is
the single source of generation progress.

Invalid payloads display a non-technical explanation and do not retain the
fragment. Project creation errors remain retryable on the launch page. Prompt
or run-start failures leave the project accessible, keep the pending record,
open the AI sidebar, and offer a retry that reuses the deterministic IDs.
Generation failures use the existing partial-diagram and incomplete-run
behavior; the launch feature does not attempt rollback.

## Security and Privacy

- The sensitive payload is carried in a fragment, which browsers do not attach
  to HTTP requests.
- The fragment is removed before authentication or application mutations.
- Transient data uses `sessionStorage`, not `localStorage` or PostgreSQL.
- The launch UUID is correlation data, not a bearer credential.
- Clerk authentication and existing project authorization remain mandatory at
  every mutation boundary.
- The chat route continues to derive sender identity from Clerk; the launch
  payload cannot choose a user, role, or collaborator.
- Project title and prompt are validated on the client for feedback and again
  on authenticated server boundaries for trust.
- Dynamic text is rendered as React text content, never raw HTML.
- Base URLs must use HTTP or HTTPS. Return destinations are fixed application
  paths, not payload-controlled URLs.
- The launcher passes values as process arguments and does not interpolate them
  into a shell command.
- Logs contain the launch UUID and project ID when useful, but never the raw or
  encoded diagram description.

## `npx skills` Distribution

The open skills CLI discovers `.agents/skills/<name>/SKILL.md`, so the
repository-local package is also the published source. After the skill exists
on the public default branch, users install it with:

```bash
npx skills add jackkfan0305/truss \
  --skill render-truss-diagram \
  --agent codex
```

The root `README.md` documents that command, the cross-agent alternative, and
`TRUSS_APP_URL`. The skill folder contains no README or release notes.

Release verification uses the GitHub source, not just a local path:

1. `npx skills add jackkfan0305/truss --list` finds
   `render-truss-diagram`.
2. A clean temporary installation for the Codex target includes `SKILL.md`,
   `agents/openai.yaml`, and `scripts/open-truss-diagram.mjs`.
3. `npx skills use jackkfan0305/truss@render-truss-diagram` produces the skill
   prompt without modifying a project.
4. A representative invocation opens a Truss launch URL and does not print the
   description.

The current CLI has no separate registry upload. skills.sh discovery follows
installs from the public GitHub source through its anonymous aggregate
telemetry. Publication therefore means merging the skill into the public
repository and verifying the remote install command.

## Testing Strategy

### Unit and contract verification

- Round-trip valid v1 payloads and reject invalid versions, UUIDs, encodings,
  JSON shapes, blank strings, extra-large fragments, and limit boundaries.
- Verify the fragment is scrubbed before any auth redirect or mutation.
- Exercise every immutable launch-state transition and reject invalid
  transitions or project mismatches.
- Verify room IDs produced for maximum-length and non-ASCII titles pass the
  project API parser.
- Verify deterministic chat IDs are stable for the same user/project/launch,
  differ across those boundaries, and cannot be caller-selected directly.
- Verify manual chat submissions retain their current behavior.
- Verify duplicate launch prompts and duplicate orchestrator starts return the
  original logical message/run.
- Verify unauthenticated, inaccessible-project, malformed, and oversized
  requests stop before Liveblocks or Trigger.dev calls.
- Verify the launcher uses argument arrays, validates URL protocols, avoids
  sensitive output, and produces the expected command per supported platform.
- Validate the skill with the skill-creator `quick_validate.py` script and
  verify `agents/openai.yaml` matches `SKILL.md`.

### UI and integration verification

- Render the signed-out, creating, error, and retry launch states with the
  existing project design tokens and accessible status/error semantics.
- Verify a launch query opens the AI sidebar and a normal editor URL does not.
- Simulate Strict Mode double effects and prove one project POST, one prompt
  message, and one logical orchestrator run.
- Exercise recovery after a lost project response, prompt response, and
  orchestrator response.
- Run a signed-in browser flow from launcher invocation through progressive
  nodes appearing on the canvas, then repeat from a signed-out tab and confirm
  automatic resume after Clerk authentication.
- Confirm the fragment and description are absent from request URLs, browser
  address history after capture, and application logs.

### Project and release checks

- Add focused verification programs to `npm run verify:unit` and preserve the
  existing integration suite.
- Run `npm test`, `npm run verify:integration`, `npm run typecheck`, focused
  ESLint, `npm run build`, and React Doctor against changed React files.
- Verify `npx skills` discovery, clean installation, one-shot use, and launcher
  execution from the public GitHub repository.

## Documentation Updates

- Add the skill launch boundary, fragment privacy rule, and idempotent browser
  handoff to `context/architecture-context.md` when implementation begins.
- Add the launch-page visual behavior to `context/ui-context.md` before its UI
  implementation.
- Add the feature and its verification state to
  `context/progress-tracker.md` after each meaningful implementation change.
- Add public installation and configuration instructions to the root
  `README.md`.

## Success Criteria

1. A user can invoke `render-truss-diagram` with a title and description and see
   a browser open without an agent credential.
2. A signed-in user reaches a newly created editor immediately; a signed-out
   user resumes the same launch after Clerk sign-in.
3. The project navbar displays the exact trimmed user title.
4. The original description appears once in the shared transcript and starts
   one logical orchestrator run.
5. The existing AI sidebar shows progress while the canvas progressively
   renders the requested nodes and edges.
6. Refreshes, Strict Mode, and retried responses do not create a second project,
   prompt, or canvas mutation.
7. Sensitive launch content is absent from HTTP URLs and application logs.
8. Normal project creation and manual AI chat behavior remain unchanged.
9. A clean Codex installation through `npx skills add jackkfan0305/truss
   --skill render-truss-diagram --agent codex` includes and can execute the
   bundled launcher.
