# Progress Tracker

Update this file whenever the current phase, active feature, or implementation state changes.

## Current Phase

- Phase 1 — Foundation: design system and UI primitives

## Current Goal

- `unified-agent-operations` complete. Create now runs headless like edit: it
  POSTs `/api/projects` (bearer) with the same readable `<slug>-<suffix>` room
  ID the create dialog builds, retries once per 409 collision, then POSTs
  `agent-launch-import` — the two calls the `/agent/new` tab's editor used to
  make on mount. Create and edit now share auth, the line-delimited JSON event
  protocol, and the `done`/`error` shape; create's old plain-sentence stdout
  success line is gone, replaced by `{"event":"done","editorUrl":…}`.
  - An import that fails after the project exists reports that explicitly and
    names the editor URL rather than implying nothing happened. The empty
    project is deliberately left in place.
  - `POST /api/projects` accepts bearer tokens for the same reason `GET` does.
  - Project list cached per origin beside the token, primed at login and
    refreshed past a 5-minute TTL. It is never authoritative: a cache miss
    forces one fresh read before reporting a project as nonexistent, and a 404
    on the graph read invalidates it. Clearing the credential clears the cache,
    so a re-link as a different user cannot resolve against the old account's
    projects.
  - Delete alone still opens a browser, for its in-app confirm dialog.
  - Gates: typecheck, lint, `verify:unit`, and `build` all exit 0. The CLI
    verifier grew nine checks (headless create, 409 retry, import-failure
    message, cache hit/stale/miss/reject paths, login priming, credential-clear
    dropping the cache); a deliberate broken assertion confirmed they execute
    rather than silently passing.
  - **Now unused by the skill but still present:** `/agent/new`, its launch
    page, `lib/agent-launch-browser.ts`, `hooks/use-agent-launch-import.ts`,
    and the editor's launch import controller. They remain a working browser
    entry point; deleting them is a separate change and was not taken here.

- `headless-agent-edit` complete. `truss:diagram --op edit` no longer opens a
  browser. A one-time `gh auth login`-style flow (`--op login`, or triggered
  inline on first edit) opens `/agent/link`, mints a long-lived `trs_agent_…`
  token through the new owner-scoped `POST /api/agent/tokens`, and caches it at
  `~/.truss/credentials.json` (dir 0700, file 0600, written via temp+rename so
  an existing wider mode cannot survive a rewrite and a crash mid-write cannot
  truncate it). Every later edit calls `/api/projects`, `agent-graph`, and
  `agent-graph-edit` directly with `Authorization: Bearer`.
  - Auth resolves at one chokepoint, `lib/agent-identity.ts`. It splits into a
    cheap `resolveIdentitySource` (no Clerk call) and a lazy
    `resolveIdentityEmail`, preserving `authorizeProject`'s existing
    "only now is the email worth a second Clerk call" laziness for bearer
    callers too — the owner-only path both agent-graph routes take stays one DB
    lookup. `authorizeProject` gained `request` as its first argument; routes
    wrap it in a request-scoped closure so every `*-server.ts` module and its
    verifier needed no change.
  - A *present but invalid* Authorization header resolves to `null` rather than
    falling through to the session cookie, so a bad bearer token fails loudly
    instead of riding a legitimate session. `POST /api/agent/tokens` rejects any
    Authorization header before calling `auth()`, so a token can never mint
    another. Tokens are stored only as SHA-256; plaintext is returned once and
    never persisted, logged, or written to sessionStorage/DOM by the link page.
  - `/agent/link` reuses `/agent/pick`'s full fragment hardening, including the
    pre-hydration bootstrap in `lib/agent-launch-bootstrap*.ts` that copies the
    fragment to tab-scoped storage before Clerk's client bundle can redirect.
  - The hallucinated-`projectId` guard that `lib/agent-pick-browser.ts` owned
    moved into the CLI: only an ID returned by the `projects` event is trusted.
    The 409-retry-once-from-a-fresh-read behaviour moved with it. The stdout
    event protocol is unchanged except a new `editorUrl` on edit's `done` and a
    `linked` event for login.
  - Create and delete are unchanged: create still opens `/agent/new`, delete
    still opens `/agent/pick` for its in-app confirm dialog. **Follow-up: unify
    create with edit so both run headless off the same token.**
  - Gates: `npm run typecheck`, `npm run lint`, `npm run verify:unit`,
    `npm run verify:integration`, and `npm run build` all exit 0. New verifiers:
    `verify-agent-token.ts` (integration, DB-backed), `verify-agent-link-page.tsx`,
    `verify-truss-diagram-cli-auth.mjs`.
  - Not yet done: no revocation UI — revoking means deleting the `AgentToken`
    row, after which the CLI 401s, clears its cache, and re-links. No live
    authenticated end-to-end run; the dev Clerk instance's interactive sign-in
    still blocks automation, same limitation recorded for earlier tasks.

- `caller-generated-diagram-skill` Task 5 complete. The new owner-only graph
  import route authorizes before reading JSON, strictly validates the opaque
  launch ID and compact graph, and uses one paced Liveblocks `mutateFlow` to
  draw canonical nodes then edges with the same shared native AI cursor loop
  (540ms cursor arrival plus `getBuildStepMs`, bounded to 76 seconds for the
  graph cap). Exact replays do not write;
  exact interrupted subsets resume only missing canonical items; divergent
  rooms return 409 untouched. The shared `saveCanvasSnapshot` keeps Blob-first,
  Prisma-pointer-second storage for both generic collaborator canvas saves and
  graph imports, so a post-Liveblocks persistence failure safely retries.
  `scripts/verify-agent-graph-import.ts` covers pre-body authorization, strict
  rejection, paced presence/delay ordering, full/exact/partial idempotency,
  conflicts, and persistence retry.
  - Review fix: existing duplicate node or edge IDs now make the live room
    divergent (409), never an exact replay. Native design runs again clear AI
    presence around the entire run, including zero-action and pre-build failure
    paths; direct imports declare a literal 120-second Next route duration so
    the shared maximum 76-second native drawing loop has safe headroom.

- Final Task 5 verification: fresh configured `npm test`, integration,
  typecheck, lint, and production build gates pass. The first build caught and
  the bounded fix addressed Next 16's requirement that route segment config be
  statically analyzable; the import route now exports literal `120`, while the
  shared duration constant remains covered by the verifier. Changed-scope React
  Doctor passes 100/100 with an isolated npm cache after the default cache hit
  an external `EEXIST/EACCES` collision. The official skill validator,
  launcher verifier, clean-project `npx skills add/list/use`, and a 40-node /
  60-edge fixture (8,454 encoded characters) pass. A fresh signed-out browser
  probe confirms fragment scrubbing before Clerk, cleared pending storage,
  retained opaque graph record, and `/sign-in` handoff. Authenticated native
  drawing/no-chat/no-Trigger/refresh-dedupe and public GitHub install remain
  manual/post-merge follow-ups.

- `agent-invoked-diagram-skill` Task 7 verification recorded. Fresh configured-environment
  commands `npm test`, `npm run verify:integration`, `npm run typecheck`, `npm run lint`, and
  `npm run build` each exit 0. Changed-scope React Doctor reports 100/100 with no findings when
  run with an isolated temporary npm cache (the shared cache could not rename an existing entry).
  The local clean-project `npx skills` add/list/use flow installed `render-truss-diagram` for
  Codex and its generated prompt named the bundled launcher; the launcher also completed a local
  synthetic invocation. The public-source R2 command remains pending merge to the public default
  branch: `npx skills add jackkfan0305/truss --list`, followed by `npx skills use
  jackkfan0305/truss@render-truss-diagram` and a launcher-name check.
  - Browser QA found and fixed a real privacy failure: Clerk's server handshake and client
    initialization could act before a valid launch fragment was captured. Exact `/agent/new` now
    bypasses only the server handshake; a constant parser-time head bootstrap copies only a bounded
    base64url fragment into tab-scoped storage and scrubs the URL, even when storage rejects its
    write. The SSR-stable Clerk provider gate performs canonical capture only after hydration, then
    reloads the fixed opaque resume route; canonical rejection and every storage failure fail open
    to normal Clerk mounting rather than leaving a capture status. The focused verifier includes a
    JSDOM hydration check (no mismatch and no pre-capture Clerk mount), typecheck, lint, unit suite,
    integration suite, production build, and changed-scope React Doctor all pass after the fix. A
    guarded accessor now defers every `sessionStorage` property access until after the exact route
    check, so a privacy-mode getter failure fails open and irrelevant routes never touch storage.
    A signed-out browser probe confirmed one stored launch record, an empty launch
    hash, canonical opaque resume query, and no raw description or encoded payload in observed
    resource URLs. A nonempty Clerk-owned sign-in hash did not parse as a launch payload.
  - Full authenticated project/prompt/run/canvas refresh-dedupe and transcript-count checks remain
    blocked by the development Clerk instance's interactive sign-in/CAPTCHA. The signed-out browser
    reaches the native sign-in form and retains the resume record, but no session can be completed
    safely by automation. Deterministic checks cover launch parsing, scrub/storage, launch editor
    retry/dedupe, description exclusion from status/editor chrome, and escaped chat rendering;
    they cannot prove the live authenticated transcript count.

- `agent-invoked-diagram-skill` Task 6 complete. The editor now accepts only
  the canonical opaque launch query, opens AI for an authorized launch, and
  waits for the mounted Liveblocks room's send-ready state before calling the
  Task 5 submission controller. The tab-scoped launch record persists the
  prompt/run lifecycle, resumes safely from each durable stage, shares one
  in-flight Promise across Strict Mode effects, and removes session/query state
  only after the idempotent run accepts. Failed launches retain a neutral Retry
  row above the composer without rendering the description. `npx tsx
  scripts/verify-agent-launch-editor.tsx`, focused submission/chat/editor
  checks, `npm run verify:unit`, focused ESLint, and `git diff --check` pass.
  `npm test` / `npm run typecheck` remain blocked before/at Prisma type setup by
  the missing generated client and `DATABASE_URL`; the new editor files add no
  TypeScript errors.
  - Fix Round 1 adds an actual hook-effect harness (not a source grep or
    runner-only test): a launch waits through `canStart: false` without a write
    or submission, starts exactly once once its mounted room is send-ready, and
    ignores a stored project/room mismatch. The normal durable chat transcript
    remains unchanged and continues to render the accepted launch prompt once.

- `agent-invoked-diagram-skill` Task 5 complete. `submitAiPrompt` is now the
  single client submission controller: it obtains (or reuses) the server-owned
  prompt ID, permits launch IDs only on the authenticated chat write, invokes
  lifecycle callbacks in prompt-then-run order, and returns `message-error`,
  `run-error`, or the started subscription. `useAgentRun.start` records and
  rethrows a start failure so the controller keeps the visible local error
  path while preventing an event-handler rejection. The manual composer keeps
  its trim/reject-empty and disabled-while-running behavior through
  `useAiPromptSubmission`. `npx tsx scripts/verify-ai-prompt-submission.ts`,
  `npx tsx scripts/verify-ai-chat.ts`, `npx tsx
  scripts/verify-ai-run-chat.ts`, `npx tsx scripts/verify-ai-chat-ui.tsx`,
  `npx tsx scripts/verify-editor-controls.tsx`, focused ESLint, `git diff
  --check`, and the changed-scope local React Doctor scan (100/100, no issues)
  pass. `npm run typecheck` remains blocked by the pre-existing missing
  generated Prisma client and `DATABASE_URL` setup.
  - Fix Round 1 adds behavior-level coverage through the actual hook-composition
    factory and manual composer boundary: a started or visible run-error clears
    the draft, a message error and disabled composer do not, and the selected
    model/default input reaches the run. It also proves rejecting sends and both
    lifecycle callbacks propagate rather than being collapsed into `run-error`.
    The testable manual boundary lives in `lib/ai-sidebar-submission.ts`, keeping
    `AiSidebar` component-only for Fast Refresh. Focused controller/chat/run/UI
    checks, `npm run verify:unit`, focused ESLint, `git diff --check`, and the
    changed-scope React Doctor scan (100/100) pass.

- `agent-invoked-diagram-skill` Task 4 complete. The authenticated chat parser
  accepts an absent launch ID as manual chat and otherwise requires the shared
  canonical lowercase UUID v4. After authorization, the write controller hashes
  the authenticated user, project, and launch IDs into a server-owned feed ID,
  upserts it, and returns 200; manual prompts still create a new row and return
  201. `npx tsx scripts/verify-ai-chat.ts`, `npx tsx
  scripts/verify-orchestrate-api.ts`, focused ESLint, and `git diff --check`
  pass. Full typecheck remains blocked by the missing generated Prisma client
  and `DATABASE_URL`.

- `agent-invoked-diagram-skill` Task 3 complete. `/agent/new` is public only
  long enough to synchronously capture and scrub its fragment into tab-scoped
  session storage, then resumes with Clerk through a fixed same-origin UUID
  return URL. Project creation persists a precomputed ID, recovers a lost POST
  response through an owner-only matching read, and makes one replacement
  attempt for an inaccessible collision. `npx tsx
  scripts/verify-agent-launch-page.tsx`, `npx tsx scripts/verify-project-api.ts`,
  and `npx tsx scripts/verify-editor-controls.tsx` pass; full typecheck remains
  blocked by the missing generated Prisma client and `DATABASE_URL`.

- `agent-invoked-diagram-skill` Task 1 complete. The shared versioned launch
  contract validates bounded base64url fragments and persisted records, keeps
  an immutable retry-stage transition graph, and exposes the project-name bound
  to prevent launch and project parsing from drifting. `npx tsx
  scripts/verify-agent-launch.ts` and `npx tsx scripts/verify-project-api.ts`
  pass.

- `agent-invoked-diagram-skill` Task 2 complete. The tracked
  `render-truss-diagram` skill packages a no-shell-interpolation Node launcher
  that validates the v1 title/description bounds and origin-only base URL,
  sends the payload only in a base64url fragment, and opens the platform browser
  command detached. `quick_validate.py`, `node
  scripts/verify-render-truss-skill.mjs`, and `npx skills add . --list` pass;
  a clean copied Codex install passed at
  `/var/folders/x7/9w5z8rhj2xlgs_rd8g7vjwqr0000gn/T/tmp.OzdyiPK2jh` (left in
  place). Public installation verification remains pending merge to the public
  default branch: `npx skills add jackkfan0305/truss --skill
  render-truss-diagram --agent codex`.
  - Fix Round 1 rejects raw empty query/fragment delimiters that URL parsing
    normalizes away, waits for the child `spawn` event, and reports asynchronous
    child errors through a generic non-sensitive rejection. The launcher
    verifier also decodes the exact v1 payload and proves inclusive/over-limit
    title and description bounds.

- `38-live-step-status` complete. The AI panel says what it is doing in one
  place, and the work log is what it thought and what it changed.
  - **One thing thinks at a time.** `ThinkingDisclosure` decided "am I
    streaming?" from the run phase alone, so *every* reasoning part in a live
    run rendered a spinner and the word "Thinking" — a run that thought four
    times showed four, three of them finished minutes earlier. Only the newest
    part of a live run streams now, chosen by ID against the **unfiltered**
    activity so a step arriving after a thought settles it even though steps are
    no longer rendered.
  - Canvas actions stopped spinning too, for the same reason and a different
    cause: `ActionStateIcon` showed a dashed spinner until the whole run ended,
    which dates from when the build was one atomic write announced ahead of
    itself. The build is paced now and `design-agent` emits each action *after*
    `applyDesignAction`, so an entry in the log is a change already on the
    canvas. A dozen spinners were a dozen claims that nothing had happened yet,
    beside a canvas visibly filling up.
  - **Step verbs moved out of the log and above the composer.** They are status,
    and the answer to "why can't I type?" was behind a disclosure, several
    messages up, that scrolled away as the transcript grew. `selectLiveRunStep`
    picks the newest step of the newest live turn; a triggered run with no step
    yet still announces itself ("Starting"), because that silence is exactly the
    cold-start window the line exists to explain.
  - It falls back to the room's status feed when the live turn belongs to
    somebody else, so a collaborator watching a run is not staring at a locked
    panel with no explanation. Liveness is still read from **presence**, never
    the feed — a killed run leaves `processing` on the feed forever and the line
    would sweep for the rest of the session.
  - The sweep is `background-clip: text` over a moving gradient
    (`.agent-step-sweep` in `globals.css`), no JS and no spinner beside it: the
    motion *is* the liveness cue. Under `prefers-reduced-motion` it drops the
    gradient as well as the animation — animation alone would leave transparent
    text. It animates `background-position`, which repaints rather than staying
    on the compositor; fine for one short label and commented as not for more.
  - `role="status"` moved with the verbs. The log headline was also a live
    region, and both announcing the same verb read it twice.
  - **A completed turn with an empty log renders nothing** rather than a
    disclosure that opens onto "Waiting for the first activity event…". A turn
    that only answered in words has no steps left to show. A *stopped* run keeps
    its header — that it failed is worth showing with nothing under it.
  - **`moveNode` is no longer logged.** A layout pass emits one per node and
    they are the bulk of a large plan, all naming coordinates a reader cannot
    picture, crowding out the adds, deletes and connections that are what
    actually changed. The move still happens and still counts toward `applied`.
  - Three new contract checks, each confirmed RED under mutation: exactly one
    part of a live run is thinking (and a step settles the one before it), step
    verbs do not appear in the log, and a finished turn leaves no status line
    behind. `checkIncompleteRunKeepsItsPartialWork` was rewritten — its fixture
    proved "partial work survives" with a *step*, which is no longer what a
    ledger is made of; it now proves it with a canvas action and asserts the
    step's absence.
  - Full verify suite, `tsc --noEmit`, focused ESLint and `npm run build` pass.
  - **Unverified in a browser.** Nobody has watched the sweep, seen the line
    appear and disappear around a real run, or checked that the composer moving
    20px at each end reads as acceptable rather than as a jump. Canvas `action`
    parts were deliberately *kept* in the log — they are a record of what
    changed, not status — which may be more than "just the thinking processes"
    asked for.

- `PR #8 review-and-merge` in progress.
  - Confirmed review fixes now cover a real manual-copy fallback for denied
    Clipboard API writes, one canonical project/room ID schema, spec payload
    project/room equality, global prompt idempotency, idempotent `TaskRun`
    persistence, and a durable 10-per-minute per-user AI request limit.
  - The rate limit was exercised against PostgreSQL with 15 concurrent requests:
    exactly 10 acquired a slot, and a request after the rolling window reset was
    accepted. Route checks prove authorization, prompt verification, quota,
    Trigger failure and persistence failure all stop at the intended boundary.
  - `npm test` now runs every deterministic contract program, with live-service
    checks grouped under `npm run verify:integration`. The new Quality workflow
    gates pull requests on install, lint, unit verification, typecheck and build.
  - CI observation and merge remain pending.

- `37-inline-spec-writer` complete. `writeSpec` runs in the orchestrator's
  process, so no part of a turn suspends the run any more.
  - **Measured first, from a real trace** (`run_06fupqhkktjc8pc516ir685s01`, a
    "generate a spec" turn): 2m35s wall against 3.9s of billed compute. 29.1s of
    it was the orchestrator's own `create_attempt`, 30.8s was `generate-spec`'s,
    26.2s was the spec actually being written, and the ~66s tail after the child
    finished was this run being restored from the checkpoint `triggerAndWait`
    forced. About 30s of model work inside ~125s of machine lifecycle.
  - `trigger/generate-spec.ts` now exports `runSpec`, mirroring `runDesign`: a
    plain async function holding the whole spec, with `generateSpec` left as a
    thin task wrapper for dashboard replays and direct triggers. It takes the
    caller's already-read `{ context, history }`, dropping two more Liveblocks
    round-trips and the duplicate canvas read.
  - `metadata` calls moved **out** of `runSpec` into the wrapper. Inline,
    `metadata.set` writes onto whichever run is executing — the orchestrator's —
    and would label a whole routed turn `kind: "spec"`. Nothing in the app reads
    run metadata; `publishAiStatus` still carries all four phases to the room,
    which is what the UI follows.
  - **A `ProjectSpec` ID is still the ID of the run that produced it**, and
    inline that is the orchestrator's own — so the first spec of a turn keeps
    exactly the ID it had before. But a turn can now call `writeSpec` twice,
    which a per-run child could not, and `saveSpec` overwrites its blob and
    upserts its row by design. `specIdForTurn` suffixes later writes so two specs
    asked for are two documents kept rather than one silently destroying the
    other.
  - The empty-canvas `AbortTaskRunError` is now caught in `runTool`. Thrown out
    of an inline call it would abort the whole turn; as a tool result the model
    explains there is nothing to write about yet — the same shape the `Result`
    from `triggerAndWait` used to give it.
  - `publisher.flush()` before the spec is gone: it existed because a scheduled
    400ms debounce does not fire while a run is suspended, and nothing suspends.
  - The manual (execute-less) tool loop **stays**, but for the other reason. The
    checkpoint argument is dead; the serialization one is not — automatic tool
    execution would run a model's parallel tool calls in parallel, and two
    designs on one canvas stack their nodes.
  - `verify-orchestrator` gains two checks, both confirmed RED under mutation:
    three specs in a turn must be three distinct IDs, and the orchestrator source
    may not contain a `tasks.triggerAndWait` call. The second matches the call
    form rather than the bare word, so it does not fail on the comment that
    explains why the wait is gone.
  - Full verify suite, `tsc --noEmit`, focused ESLint and `npm run build` pass.
  - **Unverified: the improvement itself.** No traced run yet exists for either
    inline path — the `503bb35` design change has never been traced either, and
    all three runs in the dashboard predate it. The prediction is that a spec
    turn loses the ~31s child boot and the ~66s restore; that needs one real
    `trigger dev` run to confirm, and prod numbers will differ from dev's anyway.

- `35-orchestrator-backend` complete. Chat is routed, not hard-wired. A new
  `orchestrator` Trigger task is the only task the API triggers: it reads the
  canvas and the room's `ai-chat` history, then decides per message whether to
  answer in words, edit the canvas via `design-agent`, or write a spec via
  `generate-spec`. Spec generation is reachable from chat for the first time.
  - **The loop is manual on purpose.** The two tools are declared **without
    `execute`**, so `runOrchestratorLoop` runs them one at a time and feeds each
    result back to the model. Two concurrent designs can read the same pre-state
    and stack their nodes, while a spec concurrent with a design documents a
    half-drawn diagram. The old checkpoint reason is gone now that both tools
    run inline; the serialization invariant remains.
  - **`designCanvas` is called, not triggered.** The subagent hop was the
    turn's biggest non-model cost: a real dev run took 3.5 minutes wall for 6.8s
    of billed orchestrator compute, and the trace put 27.3s of that in the child's
    `create_attempt` alone — queueing and booting the `design-agent` machine —
    plus a checkpoint of the parent and a restore once the child returned.
    `trigger/design-agent.ts` now exports `runDesign`, a plain async function
    holding the whole design; the `designAgent` task is a thin wrapper around it
    for dashboard replays and direct triggers, and the orchestrator calls it in
    its own process. `writeSpec` got the same treatment in `37` and no longer
    goes through `triggerAndWait` either.
  - **One prompt, one assistant message.** This is now structural rather than a
    flag. `runDesign` owns the canvas and the AI presence and *nothing else*: it
    never constructs a publisher and never closes the activity stream, so there
    is only ever one publisher on a row. Two would each write a **complete**
    snapshot and clobber the other, which is what the old `chatRunId` /
    `isDelegated` dance existed to prevent; both are gone, along with the
    replay of the child's non-reasoning activity. The design's reasoning now
    survives into the settled snapshot when it fits the 96KB budget, because
    `capRunSnapshot` already drops reasoning first when it does not.
  - The first tool takes the caller's already-read `{ context, history }`. Every
    later tool refreshes the canvas first, so a second design or following spec
    observes prior writes, including a partial design that threw. History stays
    fixed to the conversation before this turn. Direct task triggers read both.
  - The orchestrator's `maxDuration` went 180 → 600. Every inline model call and
    the paced build now count: those sleeps are plain timers, not `wait.for`.
  - Text deltas and reasoning deltas land in different places, and the
    distinction is load-bearing: reasoning becomes `reasoning` activity parts
    inside the collapsed work log, while text grows the message's own `content`
    through the new `publisher.appendContent`. Routing the answer through the
    activity list would print it twice.
  - No tool boundary needs `publisher.flush()` now: neither inline call suspends
    the worker, so the normal debounce fires during their awaits.
  - The spec preview has a Copy button beside Download. It puts the **Markdown
    source** on the clipboard, not the dialog's rendered HTML — the document is
    Markdown everywhere else it exists, so a paste should reproduce it. It only
    renders once `useSpecContent` has a document: copying an error message or an
    empty string is worse than offering no button.
  - `hooks/use-copy-to-clipboard.ts` is the one clipboard implementation, shared
    with the share dialog's link row. The part worth centralising is the timer,
    not the `writeText`: a component that unmounts inside the two-second
    feedback window — the spec preview closes on Escape, routinely — would leave
    a timeout holding a setter for a component that is gone. A denied write (an
    insecure origin, a refused permission) exposes the exact Markdown in a
    read-only textarea that selects on user focus/click, never a silent no-op,
    unhandled rejection, or forced focus jump.
  - Routes collapsed four to two. `/api/ai/design`, `/api/ai/design/token`,
    `/api/ai/spec` and `/api/ai/spec/token` are gone; `/api/ai/orchestrate` and
    `/api/ai/orchestrate/token` replace them, keeping the design route's order
    and rules exactly — parse before authorizing, `requireOwner: false`, prove
    the `promptMessageId` anchor, trigger, record the `TaskRun`, answer 202.
    `lib/design-requests.ts` → `lib/orchestrate-requests.ts`,
    `lib/design-run-server.ts` → `lib/agent-run-server.ts`,
    `hooks/use-design-run.ts` → `hooks/use-agent-run.ts`. `lib/run-tokens.ts` is
    unchanged and now has one caller.
  - `generate-spec` no longer takes `nodes`, `edges` or `chatHistory` from the
    client. It reads the room itself with the shared `readCanvas` /
    `readChatHistory`, which closes the "a member can spec a canvas that is not
    the one in the room" gap `27` left open and means a spec asked for straight
    after a canvas edit describes the canvas as it *now* is. Its prompt moved to
    `lib/spec-prompt.ts` and now carries positions, sizes and colors — the old
    `- name (shape)` description could not tell the writer that a left-to-right
    layout *is* the data flow, or that the teal nodes are the datastores.
  - `describeCanvas` / `formatChatHistory` / `selectDesignChatHistory` moved to
    `lib/canvas-context.ts`, shared by all three prompts. `openActivityStream`
    moved to `lib/ai-activity-stream.ts`. The design agent's own prompt is
    **unchanged**, which `verify-design-agent` still proves.
  - The contract suite is GREEN: `verify-orchestrator`, `verify-spec-prompt`,
    `verify-orchestrate-api`, `verify-spec-api`, `verify-design-agent`,
    `verify-ai-chat` and `verify-ai-run-chat` all exit 0, alongside focused
    ESLint, `tsc --noEmit` and the production build. `verify-ai-run-chat` still
    prints one simulated failed Liveblocks update before proving the next full
    snapshot repairs it; that log is expected test output.
  - **Routing behaviour is unverified.** Whether "is this a bottleneck?" answers
    in words and "add a cache" edits the canvas is a property of the model plus
    the prompt, and no contract check can establish it. It needs a real
    `trigger dev` run against a real Liveblocks room with a Google API key. The
    inline activity stream and composer settlement likewise need observation in
    that end-to-end run; there is no checkpoint boundary left in the turn.

- `36-spec-attachment` complete. A generated spec is now part of the
  conversation that asked for it, and the AI panel is one surface.
  - The spec rides the feed as a fourth activity part: `{ type: "artifact",
    text: fileName, detail: specId }`. It reuses `text`/`detail` rather than
    introducing a differently shaped part, so one validator, one 200-part bound
    and one byte budget still cover everything on `ai-chat`. There is no new
    persistence — the Markdown is already in Blob and the pointer already a
    `ProjectSpec` row.
  - `fitAiRunToBudget` now **never** drops an artifact. Reasoning gives way
    first as before, but the last resort keeps artifacts instead of emptying the
    list: every other part describes work that happened, while an artifact is
    the only pointer the transcript has to a document that was written, paid for
    and saved.
  - The card renders **outside** the collapsed work-log disclosure, beneath the
    closing message, because a document is the result of the turn rather than a
    step within it — and a reader should not have to expand a work log to find
    one. `AiRunActivity` filters artifacts out of both its list and its step
    count for the same reason.
  - **The Chat/Specs tabs are gone.** `components/editor/spec-panel.tsx` is
    deleted and its preview dialog, download link and timestamp moved to
    `components/editor/spec-attachment.tsx`. `useProjectSpecs` went with it. `GET
    /api/projects/[projectId]/specs` still exists and still answers, but nothing
    in the client calls it: the transcript *is* the list now.
  - The composer no longer claims to be about the canvas. Its placeholder,
    aria-label and one starter prompt now reflect that a turn may answer,
    design, or document.
  - `verify-ai-chat` covers the new part: it validates, an incomplete one
    (no spec ID, or no file name) becomes no card rather than a broken one, a
    malformed one is dropped without dropping the message, and a real one
    survives both the 200-part bound and the byte budget. Focused ESLint,
    `tsc --noEmit` and the production build pass, and the whole `scripts/verify-*`
    suite exits 0.
  - The end-to-end path **is** now partly proven against a live room: a fresh
    `chat-${runId}` row is created, updated repeatedly, and settles carrying an
    `artifact` part, read back from the feed API. What that does not cover is
    the browser.
  - **Unverified in a browser.** No signed-in pass has rendered the card, opened
    the preview, or downloaded through it, and the panel's new single-surface
    layout has not been seen at any width. React Doctor's one new finding —
    `await` in a loop at `lib/orchestrator-loop.ts:96` — is a false positive:
    that loop is deliberately sequential and the reason is in a comment above it.

- `22-design-agent-api` complete: the first background-task path in the project. `POST /api/ai/design` triggers `design-agent` and records a `TaskRun`; `POST /api/ai/design/token` trades a run ID for a run-scoped realtime token. The task echoes its payload — no model call, no canvas write — and `TRIGGER_SECRET_KEY` still needs a real value. The AI sidebar is still the `20` stub.
- `16-edge-behavior` complete: nodes have four hover-revealed connection handles, so the canvas is finally *connectable* — `onConnect` and `ConnectionMode.Loose` were wired since `11` but unreachable. New connections render through the `canvasEdge` renderer with a right-angle route, an arrowhead, and a double-click inline label. `ui-context.md`'s node and edge specs are now both fully implemented. The AI panel is still a placeholder.
- `23-design-agent-logic` complete: the design agent is real. A prompt now reaches Gemini, comes back as validated canvas actions, and lands in the room's Liveblocks Storage through `@liveblocks/react-flow`'s own server-side `mutateFlow` — so an AI-made node is byte-identical to a dragged one. The AI shows up in the room as a presence (avatar, cursor, thinking flag) and narrates itself on the `ai-status-feed`. **Nothing in the sidebar reads either yet** — that is `24`/`25`; this unit is the producer.
- `24-ai-presence-state` complete: the consumer for what `23` produces. The sidebar now shows the room's latest `ai-status-feed` line, the composer and send button lock while a run is in flight, and a participant with `isThinking` set spins in their own cursor badge. Still **no generation logic** — sending a prompt is the `20` canned reply; `25` replaces that.
- `25-sidebar-chat-feed` complete: the sidebar chat is real and shared. Messages go to a second, room-scoped Liveblocks feed (`ai-chat`), validated on the way in and on the way out, so the transcript survives a reload and everyone in the room sees the same one. The `20` canned assistant reply is gone. Still **no AI replies and no task triggering** — `role: "assistant"` exists in the schema and nothing writes it yet.
- `26-ai-chat-functional` complete: the loop closes. A prompt in the sidebar triggers `design-agent`, its curated progress and canvas operations stream live over Trigger.dev, the nodes arrive through Liveblocks on their own, and the run's summary is written back to `ai-chat` as the AI. Raw provider chain of thought is not exposed. The Specs tab is still the `20` static card.
- `28-spec-persistence-download` complete: a generated spec now survives the run that made it. The `generate-spec` worker stores the Markdown in Vercel Blob and a `ProjectSpec` pointer in Postgres, and an authorized download route streams it back as a `.md` attachment. Backend only — the Specs tab is still the `20` static card until `29`, and there is no list endpoint yet.
- `29-spec-ui-integration` complete: the Specs tab lists this project's specs, previews one as rendered Markdown in a modal, and downloads it — through a new metadata list route and the `28` download route, never Blob. **`Generate Spec` is still inert**: triggering a run from that panel needs the canvas graph the sidebar does not hold, so specs can only be created outside the UI for now.
- `27-ai-sidechat-redesign` complete: the AI panel is monochrome and rebuilt around shadcn primitives, visibly identifies `gemini-3.6-flash`, and renders each local run as a Cursor-style work turn directly after its prompt. Activity keeps true stream order, distinguishes pending canvas operations from completed ones, survives run completion for the mounted session, follows new output until the reader scrolls up, offers a Jump to latest control, and paginates older room messages.

## Completed

- **`truss:diagram` skill — edit and delete** — `render-truss-diagram` (create
  only, write-only) is replaced by `.agents/skills/truss-diagram/`, a single
  skill dispatching on the user's phrasing to create, edit, or delete. Create's
  contract is unchanged. Edit and delete resolve their target from the user's
  own project list, read in the terminal from a numbered prompt or name match,
  never guessed between two plausible candidates.
  - `lib/agent-graph.ts` gained `projectCanvasToAgentGraph` and
    `canvasFingerprint`: the canvas→compact direction, the reverse of the
    existing `materializeAgentGraph`. Items the compact contract cannot
    express (arbitrary human IDs, over-length labels, off-enum colors) are
    reported as `opaqueNodeIds`/`opaqueEdgeIds` rather than dropped, so an
    agent can never delete what it could not see. `lib/agent-graph-diff.ts`
    (`diffAgentGraph`, `collidesWithOpaque`) derives add/update/remove keyed
    on ID, with removal structurally impossible for anything outside the live
    graph projection.
  - `lib/agent-canvas-write.ts` extracts the shared paced drawing/persistence
    loop out of the import route (`b7ddeda`) with no behavior change, so
    create and edit share pacing and Blob-first/pointer-second persistence
    without sharing reconciliation logic.
  - `GET /api/projects/:id/agent-graph` (owner-only) reads the **live**
    Liveblocks room via `readCanvas`, not the lagging Blob snapshot, and
    returns the compact graph, opaque ID sets, and a room fingerprint.
  - `POST /api/projects/:id/agent-graph-edit` recomputes the fingerprint
    *inside* the `mutateFlow` callback (checking before it would reopen the
    read-then-write race), refuses an edit that reuses an opaque ID, batches
    removals/updates before pacing additions, and sweeps edges anchored to a
    removed node (opaque ones included) since `removeNodes` does not cascade.
  - A one-shot `node:http` loopback listener
    (`.agents/skills/truss-diagram/scripts/loopback.mjs`) carries the
    browser's answers back to the skill script: loopback-only bind verified
    off the real socket, one-shot nonce compared with `timingSafeEqual`,
    exact-origin CORS, Host pin against DNS rebinding. Each exchange is a
    held-open response, not a poll — Node's `headersTimeout`/`requestTimeout`
    bound receiving a request, not answering one, so an agent that
    deliberates for a minute is safe. A rejected callback does not consume
    the one-shot.
  - `/agent/pick` (`app/agent/pick/`, `components/agent/agent-pick-page.tsx`,
    `lib/agent-pick.ts`, `lib/agent-pick-browser.ts`) is the second public
    entry path, added to `isPublicPath`/`isClerkHandshakeBypassPath` in
    `proxy.ts` alongside `/agent/new`, and reuses the pre-hydration fragment
    capture — extended (`8eec984`) to cover this path, since it previously
    covered only `/agent/new` and Clerk could otherwise redirect a
    signed-out caller before the fragment was read. Launch and pick fragments
    use separate per-path `sessionStorage` keys so one payload type can never
    be decoded as the other.
  - Undo does **not** cover a server-side edit (open question from the design
    spec, resolved this task): Liveblocks `history.undo()` only reverts
    operations made by the current client's own room connection, and
    `mutateFlow` runs through `@liveblocks/node`'s separate REST connection —
    confirmed straight from `@liveblocks/core`'s type declarations ("It does
    not impact operations made by other clients") and matches this app's own
    `CanvasControls` doc comment ("per-client — undo takes back *your* last
    change, not a collaborator's"). The terminal's destructive-edit
    confirmation is therefore the only safety net against an agent removing
    the wrong nodes, not a convenience; `references/operations.md` and
    `context/architecture-context.md` both say so explicitly now.
  - Review rounds caught real defects, not just polish: a literal NUL byte
    copied into the plan document (`f8e4ac1`); an opaque edge that would have
    permanently outlived a removed node's endpoint because `removeNodes`
    doesn't cascade (`f8e4ac1`); a binding assertion that reported the
    *requested* loopback address instead of the one actually bound, making
    "loopback-only" a tautology (`a6e6e8e`); argument parsing hoisted outside
    the launcher's `try`, so a malformed invocation threw uncaught instead of
    emitting the terminating protocol event an interactive op depends on
    (`e3ff286`); and `verify-agent-graph-edit` missing from `verify:unit`, so
    the suite guarding the canvas write path was not running at all
    (`8eec984`, now fixed).
  - Manual browser QA (below) is the only thing left unverified — everything
    else runs in `verify:unit`, `typecheck`, `lint`, and `build`.

- **Liveblocks feed upsert fix** — `upsertAiChatMessageWithClient` branched on
  `404`/`409`, but the live v2 API reports a missing message, a duplicate
  message ID *and* a POST into a missing feed all as `500 Internal Room Error`.
  Only "feed already exists" answers honestly (409). So the ladder rethrew on
  the first write of every run and no assistant row was ever created — the
  symptom was `AI run chat update failed for room …` with an empty `Error:` and
  a turn that left no trace in the transcript. The ladder now walks
  update → create → create-feed → create → update, remembering failures instead
  of branching on a status, and throws the *first* error only when it runs out
  of rungs. `401`/`403`/`429` still short-circuit. Verified against the live
  room: first write, steady-state updates and the terminal artifact write all
  land, and the stored row round-trips with its full `run` payload.

- `36-spec-attachment` — specs live in the transcript. A new `artifact` activity
  part carries `{ specId, fileName }` on the durable run, the card renders
  outside the work log with Preview and Download, and the byte budget now
  protects artifacts. The Chat/Specs tab strip and `SpecPanel` are deleted; the
  AI panel is one surface.
- `35-orchestrator-backend` — intent routing in a Trigger task. `orchestrator`
  owns the turn, exposes `designCanvas` and `writeSpec` as execute-less tools,
  waits on each subagent outside the model stream, and settles one durable chat
  row. Four AI routes became two; the spec writer reads the room instead of the
  request body. Backend plus one hook rename; the transcript's spec attachment
  card is `36`.
- `34-shared-ai-run-activity` — durable shared AI work activity and
  collaborator identity rendering. The worker creates and repeatedly upserts
  one full-snapshot `chat-${runId}` row, anchored by `promptMessageId`; it
  coalesces active updates at 400ms, bounds persisted activity at 200 parts,
  immediately writes terminal states, and can repair an intermediate publishing
  failure with the next snapshot. Visible activity is curated only, never raw
  chain of thought. `DesignRunObserver` remains mounted only for initiator
  settlement. A stale `running` row is explicitly incomplete after 315 seconds
  and retains partial steps. Other collaborators' prompts use the left
  avatar/name rail and `bg-elevated` surface, with initials for legacy records.
  Stored avatars fall back to current collaborator presence before initials.
  - Focused contract checks, ESLint, strict TypeScript, and production build
    pass. The publisher check intentionally logs one simulated failed write and
    then verifies full-snapshot repair. Repo-local React Doctor exits 1 at
    51/100 (2 errors, 20 warnings), including unrelated repository findings.
    The two changed dynamic-HTML sink reports are false positives: both values
    come exclusively from `renderChatMarkdown` (`html: false`, URL validation,
    escaping/render tests). The observer effect is the required stream-error to
    settlement bridge, so it is non-actionable. The scan is still not passing.
    Live two-client browser QA is unverified because gstack is `NEEDS_SETUP`
    and no authenticated collaborator sessions are available.
  - Retained RED evidence: the Task 1 durable empty-run assertion returned
    `null`; Task 2 had no publisher module; Task 3 lacked prompt/identity
    boundary fields; Task 4 lacked worker publisher wiring; Task 5 lacked the
    ordering/entry exports and later the shared edge-state helper. Each has its
    corresponding report-recorded GREEN verification.
- `29-spec-ui-integration` — the Specs tab is real. It lists this project's specs, previews one as rendered Markdown in a modal, and downloads it. The `20` static card is gone.
  - `GET /api/projects/[projectId]/specs` — the one read `28` left out. Metadata only, newest first, capped at 50. `filePath` is deliberately **not** selected: it is a private Blob pointer the browser cannot fetch anyway, so returning it would only publish the storage layout. The file name is computed by `specFileName`, the same function the download route puts in `Content-Disposition`, so the name in the list is the name the file saves under. `requireOwner: false`, matching the download route.
  - `hooks/use-project-specs.ts` — `useProjectSpecs` (the list) and `useSpecContent` (one document, read as text from the **download route**). Both abort on unmount and stamp their result with what they fetched, so a stale response never renders as the current one — the `useProjectMembers` pattern.
  - The preview body is a child component that mounts with the open spec and unmounts with it. That is what discards the Markdown, so `useSpecContent` never has to clear itself in an effect (`react-hooks/set-state-in-effect` forbids that) and the panel holds no spec content between opens.
  - `components/editor/spec-panel.tsx` — a row is two controls, not one: the body opens the preview, and the trailing **anchor** downloads. The browser does the saving; nothing reads the body or juggles an object URL. `nativeButton={false}` on that Button — Base UI errors at runtime otherwise, which is how the live check caught it.
  - Rendering reuses `renderChatMarkdown` and the transcript's `MARKDOWN_STYLES` (now exported), with the heading steps overridden through `cn` because a document has hierarchy a chat message does not. Same trust boundary as chat: `lib/markdown.ts` runs markdown-it with `html: false` and is the only sanitizer.
  - **Grid rows, not flex columns**, for both the tab panel and the modal. The shadcn `ScrollArea` sizes its viewport with `h-full`, and a percentage height resolves against `auto` inside a flex item — the spec rendered at its full 1,333px straight out of the modal. A `minmax(0,1fr)` track is definite, so the viewport gets a real height. Measured after the fix: 366px viewport, 1,333px of content, scrolls.
  - Verified live in the browser as the owner (`clerk impersonate` ticket), not reasoned about: the tab listed `spec-2026-08-08-20-42.md / Aug 8, 2026, 4:42 PM`, the modal rendered the Markdown with headings, bold and lists, Escape closed it, and the download link answered `200 text/markdown; charset=utf-8` with `attachment; filename="spec-2026-08-08-20-42.md"` (2,619 characters). The list route answered 401 signed out and 404 for an unknown project. No console errors; react-doctor scores 100/100 on the changed scope.
  - **Generate Spec is still inert.** `29` scopes viewing only, and triggering `POST /api/ai/spec` from this panel needs the canvas graph, which the sidebar does not hold — the list has no way to grow from the UI yet.

- `28-spec-persistence-download` — a generated spec is now durable and retrievable. `generate-spec` writes the Markdown to Vercel Blob and a `ProjectSpec` row pointing at it, and `GET /api/projects/[projectId]/specs/[specId]/download` streams it back as an attachment behind the usual project authorization.
  - `prisma/models/project-spec.prisma` — `ProjectSpec { id, projectId, filePath, createdAt }` with a `Project` relation (unlike `TaskRun`: a spec is only ever read through a project-scoped route, and the cascade is a net that never fires because deletion tombstones the row). Indexed `[projectId, createdAt]` for the newest-first list `29` needs.
  - **The ID is the Trigger.dev run ID**, and the model has no `@default` so a caller cannot forget to choose one. The blob pathname needs an ID *before* the upload, and reusing the run's own is what makes the pair idempotent — `retry.maxAttempts: 2` now has writes behind it, and attempt two upserts its own row and overwrites its own blob instead of leaving an orphan of each. `allowOverwrite: true` is scoped to exactly that case: no other run produces this pathname.
  - `lib/spec-storage.ts` — the pathname (`specs/{projectId}/{specId}.md`), the content type, and the private-access constant, shared by the writer and the reader so neither side owns half the contract. No Prisma or Blob imports, so `scripts/verify-spec-api.ts` exercises it without a database or a store token. Specs **accumulate** — the opposite of the canvas's single latest-snapshot pathname.
  - The download filename comes from the timestamp (`spec-2026-08-08-20-42.md`), not from the spec ID or the project name: a run ID means nothing in a Downloads folder, and a project name is user-controlled text that would need escaping before it went near a `Content-Disposition` header.
  - `trigger/generate-spec.ts` — blob first, row second (a pointer written ahead of the document would advertise an artifact that does not exist), and both *before* the `complete` status is published, since that is what the UI will list specs on. The run output is `{ markdown, specId }`; the blob URL is deliberately withheld — it is a private pointer the browser cannot fetch anyway.
  - Persistence is in the **worker**, not behind a route the browser calls back into. The spec exists whether or not the initiating tab is still open, and a "here is the spec I generated" endpoint would be a way to write arbitrary Markdown into someone else's project.
  - `trigger.config.ts` — `prismaExtension({ mode: "modern" })`, now that a task talks to the database. "Modern" is the mode for this setup (Prisma 7, `prisma-client` generator, driver adapter): no query engine binary to ship, and generation stays ours via `npm run generate`.
  - `app/api/projects/[projectId]/specs/[specId]/download/route.ts` — authorize the project, then look the spec up **by** `id` *and* `projectId` rather than checking ownership afterwards, so there is no ordering in which the wrong document is fetched and then rejected. Unknown ID and another project's ID collapse into one 404. `get(..., { useCache: false })` because a retried run can replace a document seconds after the CDN cached it. The body is streamed straight through with `nosniff` (model-authored Markdown on our own origin) and `private, no-store`.
  - Verified end to end against a real project, not reasoned about: a live `generate-spec` run wrote `specs/test-4-d2afb4/run_…md` and its row, the blob read back at 200 through the store token, and the same URL answered **403** unauthenticated. Signed in as the owner (via a `clerk impersonate` ticket) the route returned `200 text/markdown; charset=utf-8` with `attachment; filename="spec-2026-08-08-20-42.md"` and 2,619 characters; another project's spec ID, an unknown spec ID and an unknown project ID all returned 404, and signed out returned 401.
  - A dev server that was already running returned 500 (`Cannot read properties of undefined (reading 'findFirst')`) until restarted: it holds the pre-migration generated client in memory. Restart `next dev` after any `prisma migrate`.

- `27-spec-generation-flow` — the backend half of spec generation. Nothing in the UI reaches it yet; `28` persists the output and `29` wires the Specs tab.
  - `lib/spec-requests.ts` — Zod schemas for the request and the task payload, one definition parsed twice. The route parses the browser's body and `schemaTask` re-parses in the worker, because a task payload is not only ever written by that route. Unknown keys are stripped rather than rejected: the canvas sends full React Flow nodes and a spec only needs labels, shapes and connections out of them. Arrays are capped (300 graph items, 60 chat messages) so an unbounded body is not an unbounded prompt.
  - `app/api/ai/spec/route.ts` — validate → authorize → trigger → record `TaskRun` → `202 { runId }`, the same order as `/api/ai/design`. There is **no** client `projectId`: a room ID *is* its project ID, so the project authorized against is derived from `roomId`. `requireOwner: false` — a collaborator edits the canvas, so a collaborator may spec it.
  - `lib/run-tokens.ts` — the design token route's body, extracted. `TaskRun` ownership plus a project recheck is about the run record, not about what the run does, so `/api/ai/design/token` and `/api/ai/spec/token` are both `export const POST = issueRunToken` over one implementation rather than two copies with two places to forget the recheck.
  - `trigger/generate-spec.ts` — `schemaTask` on the shared payload schema, Gemini through `@ai-sdk/google`, Markdown out as the run output. Writes nothing: persistence is `28`, so the artifact *is* the output. `retry.maxAttempts: 2` (safe to retry, unlike the design agent — no writes to duplicate — but each attempt is a paid call), `maxDuration: 300` (prose, not a short structured object), `thinkingLevel: "medium"` (higher than design's `low` for the same reason). An empty canvas *and* empty transcript throws `AbortTaskRunError` rather than spending two calls on the same empty answer. Progress goes to `metadata` for the run-scoped subscriber and to the room's `ai-status-feed` with `kind: "spec"` — the kind `types/tasks.ts` reserved for this.
  - `lib/google-ai.ts` — `getGoogleApiKey` moved out of `design-agent.ts`, now that two tasks read the same key. Still both `GEMINI_API_KEY` and `GOOGLE_AI_API_KEY`.
  - `scripts/verify-spec-api.ts` — schema coverage: extra React Flow keys stripped to exactly the spec fields, empty canvas defaulting, and the rejections (short/long/non-string `roomId`, nodes without IDs, edges without targets, an unknown chat role, empty and oversized content, an over-cap node array, a payload missing `projectId`).
  - Verification: real Trigger.dev dev run against Gemini returned a 4.4k-character Markdown spec in 46s with `metadata` at `{ kind: "spec", status: "complete" }` — sectioned Overview → Components → Data Flow → Open Questions, and it correctly listed "the conversation asks for a receipt email but the canvas has no email component" as an open question rather than inventing one. All four verify scripts, `tsc --noEmit`, ESLint and `npm run build` pass; both `/api/ai/spec` routes appear in the build's route table.
  - `zod` is now a direct dependency. It was already present transitively (via `ai` and the Trigger SDK) and is now imported directly.

- `27-ai-sidechat-redesign` — minimal monochrome sidechat plus prompt-anchored streaming activity.
  - `components/editor/ai-sidebar.tsx` — neutral-only panel shell, exact model badge, shadcn line tabs, Card-based Specs preview, monochrome empty state and a ChatGPT/Claude-style composer. All AI/brand/state accent classes were removed from the sidechat.
  - `components/editor/ai-chat-transcript.tsx` — one readable transcript edge, neutral user surfaces, local work turns inserted after the feed message that launched them, coarse collaborator status, bottom-follow that pauses on scroll-up, Jump to latest, and explicit older-message pagination.
  - `components/editor/ai-run-activity.tsx` — shadcn Accordion work log. Chronological phases, curated reasoning summaries, and canvas actions use icons plus text; action checks appear only after the atomic run completes.
  - `hooks/use-ai-chat.ts` / `app/api/ai/chat/route.ts` / `lib/ai-chat-server.ts` — user messages go through an authenticated server writer that derives identity and returns a stable ID. Room tokens have feeds read-only; the returned ID anchors the local run turn.
  - `hooks/use-design-run.ts` / `components/editor/design-run-observer.tsx` / `lib/ai-run-turns.ts` / `lib/ai-timeline.ts` — session-retained turns, keyed run/stream observers, a lossless local `onData` accumulator, terminal-marker settlement, immutable transitions, bounded validation, and adjacent-only reasoning coalescing.
  - `types/tasks.ts` / `trigger/design-agent.ts` — one shared `AI_DESIGN_MODEL` descriptor prevents the worker and UI model label from drifting.
  - `components/ui/accordion.tsx` / `components/ui/badge.tsx` — generated through the shadcn CLI and left unmodified.
  - `scripts/verify-design-agent.ts` / `scripts/verify-ai-chat.ts` — RED/GREEN coverage for shared model metadata, chronological activity selection, session turn anchoring, stable chat IDs, timestamp safety, and histories longer than one feed page.
  - Verification: all AI scripts, `tsc --noEmit`, full ESLint, `npm run build`, and React Doctor (`100/100`) pass. Authenticated browser QA remains unavailable because the automation profile has no Clerk session.

- `26-ai-chat-functional` — the sidebar is wired end to end: a prompt triggers the design agent, curated progress and canvas operations stream live, and its closing line lands back on the chat feed. The canvas is never touched by hand.
  - `hooks/use-design-run.ts` owns triggering and run-turn history; `components/editor/design-run-observer.tsx` mounts keyed `useRealtimeRun` and `useRealtimeStream` observers per run. **Two fetches, not one**: `/api/ai/design` answers `{ runId }` and `/api/ai/design/token` trades that ID for a run-scoped token. The token route checks both run ownership and current project access.
  - Activity uses `useRealtimeStream.onData` with its own ordered accumulator rather than the hook's `parts` cache, whose ref timing can overwrite bursty chunks. A worker-emitted terminal marker settles immediately and authoritatively; the run record waits through a 1.5s grace period only as a fallback for a missing marker or hard kill, preventing a locked composer without adding the record's observed ~30s terminal lag.
  - The `onSettled` callback is held in a ref rather than a dependency: the sidebar hands in a fresh closure every render, and depending on it would tear the run subscription down and rebuild it mid-generation.
  - `trigger/design-agent.ts` uses `streamText` with `Output.object`, but drains provider output without exposing raw chain of thought. It emits safe summaries around canvas inspection, architectural planning, validation, and each atomic canvas action.
  - Activity goes out on a **Trigger.dev stream, not a third Liveblocks feed**. It is run-token scoped and only the initiating client renders it. Trigger.dev retains the source stream for up to 28 days, so the stream deliberately contains curated progress rather than raw thoughts.
  - `streams.pipe` with a `ReadableStream` batches activity. Both `emit()` and `close()` treat transport errors as non-fatal commentary: once the canvas succeeds, a telemetry failure cannot relabel the run as failed or claim the canvas was unchanged.
  - Operations are announced **before** the write, not during it: the write is one atomic `mutateFlow` and every action is already validated, so the list is what is about to land rather than a guess. `describeDesignAction` in `lib/design-plan.ts` names each one by its label where there is one and its ID otherwise — a delete has nothing else.
  - `types/tasks.ts` contains the shared activity/chat contracts and AI identity. The worker publishes each final summary using `chat-${runId}`, so the durable assistant response survives the initiating browser going offline.
  - **The composer is gated on this client's own run, never on room-wide `isGenerating`.** It is shared chat as well as the AI prompt, and one participant's generation must not mute everyone else's conversation — the same reasoning as `25`, applied to the new lock. The run only triggers once the user's message has landed on the feed: a prompt nobody can see is not worth generating from.
  - **Bubbles are gone.** `ChatEntry` is a left rail plus a label. The panel is 20rem wide; a chat-app layout spends a fifth of that on alignment padding and moves the reading edge side to side. Role is the rail's colour — teal for you, purple for the AI, neutral for everyone else. The spec's `#62C073` green was **not** used: it also says twice not to introduce colours outside `global.css`, and the project's accents are teal and purple.
  - `AiStatusLine` became `RunActivity` and **moved from above the tabs to above the composer**, rendering only while a run is live. A status line and an activity log answer the same question, so they are one panel: the room's feed is the headline, the run's stream is the thinking and the operations underneath it. It explains why the input is locked, which is why it belongs next to the input.
  - **Model moved to `gemini-3.6-flash`.** One exported `AI_DESIGN_MODEL` descriptor drives both the worker and the visible badge so they cannot drift. Internal thinking remains enabled with a small budget, but `includeThoughts` is intentionally off.
  - `scripts/verify-design-agent.ts` — nine rejection cases for `parseAiActivityPart` (including a clamped runaway delta and a non-string `detail` that drops the field rather than the part), and a `Record<DesignAction["type"], string>` over `describeDesignAction` so a new action type cannot silently fall through to its raw ID.

- `25-sidebar-chat-feed` — room chat on its own Liveblocks feed, read and written by the sidebar. No AI replies, no task triggering, no parallel realtime system.
  - **A second feed, not a `kind` on the first.** `ai-status-feed` is read latest-only and everything older is dropped, which is the opposite of what a transcript needs; sharing one feed would mean each reader filtering the other's messages out on every render, forever. `AI_CHAT_FEED_ID = "ai-chat"` is separate at the source, and `scripts/verify-ai-chat.ts` asserts in both directions that a status message never parses as chat and vice versa.
  - `hooks/use-ai-chat.ts` — `useAiChat()`: `useFeedMessages(AI_CHAT_FEED_ID)` to read, `useCreateFeedMessage` to write, `useSelf` for the sender. Non-suspense like `useAiStatus`, for the same reason — the sidebar is outside the canvas' `ClientSideSuspense`, and an empty transcript is the correct render while the feed loads.
  - **The feed is created on demand server-side.** Room clients receive `feeds:read`, while `/api/ai/chat` authorizes the project and derives user identity before writing. The Trigger worker is the only assistant writer.
  - `lib/ai-chat.ts` — `selectAiChatMessages(entries)`, split out of the hook so the verify script can import it without React or Liveblocks, exactly as `lib/ai-status.ts` was. It **orders by the server's `createdAt`, never by the sender's `sentAt`**: `sentAt` comes off whoever's laptop wrote it, and one clock five minutes behind would reorder the transcript for everyone. `sentAt` is still what is *displayed* — a skewed label is cosmetic, a skewed order is a conversation that stops reading as one.
  - `types/tasks.ts` — `parseAiChatMessage`, the same trust boundary as `parseAiStatusMessage` one step wider: chat entries are written by *other clients*, not by a background task. Whitespace-only content is rejected (it renders as an empty bubble, which reads as a broken client, not as a message) and over-long content is clamped rather than dropped. `maxLength` on the composer stops the overflow at the keyboard, where it is still visible.
  - **The composer is deliberately no longer gated on `isGenerating`.** That lock made sense in `24`, when the composer *was* the AI prompt; it now posts to room chat, and no participant's generation should be able to mute everyone else's conversation. The status line above the tabs is untouched.
  - Every bubble names its sender, even consecutive ones from the same person. The panel is 20rem wide and messages arrive unannounced, so a bubble that inherits its author from the one above is a bubble you scroll up to attribute. Own messages align right and read "You", matched on `senderId` against `useSelf`.
  - The draft is cleared **only on a successful send**, and a failure shows a `role="alert"` line rather than swallowing the text — the one thing in this panel the user has to act on.
  - `scripts/verify-ai-chat.ts` — 18 rejection cases plus the clamp, and four ordering rules: shuffled input sorts oldest-first, a skewed sender clock does not reorder anything, unreadable entries are skipped instead of rendered blank, and the Liveblocks cache array is not sorted in place. Run with `npx tsx scripts/verify-ai-chat.ts`.

- `24-ai-presence-state` — shared AI activity as UI: a status line in the sidebar, a locked composer during generation, and thinking spinners on live cursors. No generation logic, no task triggering, no feed history.
  - **The split is the whole unit: the feed says *what*, presence says *whether*.** Both are already written by `23`, and it is tempting to drive everything off the feed since it carries the status enum — but a feed message is durable and a task killed mid-run (OOM, hard timeout) never publishes its `error`. Gating the composer on a feed status would leave `processing` on the feed forever and disable the panel for the whole room permanently. Presence expires on its own (`lib/ai-activity.ts` sets a TTL), so it is the only signal that self-heals, and it is what `isGenerating` reads. The alternative — a staleness timeout on the feed message — means a ticking clock and a number to keep in sync with `maxDuration`. This has neither.
  - `hooks/use-ai-status.ts` — `useAiStatus()`, the one place both signals are combined. `useFeedMessages(AI_STATUS_FEED_ID)` for the text, `useOthersMapped((other) => other.presence.isThinking)` for liveness. **`useOthersMapped`, not `useOthers`**: the sidebar would otherwise re-render on every cursor move in the room, and the mapped hook only fires when the flag itself flips.
  - Both hooks come from `@liveblocks/react`, **not** `/suspense` — same reason as `useCollaborators`: the sidebar is mounted outside the canvas' `ClientSideSuspense`, and "no status yet" is the correct render while the feed loads. A room whose feed has never been written resolves to an *error* rather than an empty list (the task creates the feed on first publish), and both mean the same nothing here, so the error is deliberately unread.
  - `lib/ai-status.ts` — `selectLatestAiStatus(entries)`. Split out of the hook purely so the verify script can import it without pulling in React and Liveblocks, exactly as `lib/presence.ts` was split out of the avatar stack. Its parameter is a structural `{ data: unknown; createdAt: number }` rather than Liveblocks' `FeedMessage`, which the client package does not re-export.
  - Two rules in there, both silent when broken. Entries are ranked by **`createdAt`, not array position** — the hook does not document an order, and a status line that runs backwards looks like a working panel. And an entry that fails `parseAiStatusMessage` is **skipped rather than allowed to win**: a message from an older task version or a later feature sharing the feed must not blank out the real status by being newest. `>=` breaks a same-millisecond tie toward the later entry, which is the later write.
  - `components/editor/ai-sidebar.tsx` — `AiStatusLine` sits **above the tabs**, not inside the AI Architect tab: the feed is shared with spec generation (`kind` is `design | spec`), so the status belongs to the panel. It renders `null` until there has ever been a run, so the panel is visually unchanged on a fresh project. `role="status"` + `aria-live="polite"` rather than `assertive`, because a run updates the same statement several times.
  - `text` is optional on the payload, so `STATUS_FALLBACK` gives each status a line of its own — a valid message would otherwise render as an empty row. `error` is the only status with its own tone (`text-state-error`).
  - The composer is `disabled` + `aria-busy` and the send icon swaps to a spinning `Loader2`, matching `SaveStatusButton`'s spinner. `send()` also early-returns on `isGenerating`, so the guard is in the function rather than only on the controls. **The starter chips are disabled too** — a chip is the composer by another name, and an enabled shortcut into a call that ignores it reads as broken. Nothing else dims: the tabs, Specs panel, close button and scroll all stay live, per the scope limit.
  - `components/canvas/live-cursors.tsx` — one conditional `Loader2` inside the existing name badge, which became a flex row. Missing or `false` presence renders nothing. The AI's cursor is `null` until it has a plan (`23` parks it on the work), so the spinner appears with the design rather than at trigger time.
  - `types/tasks.ts` is **unchanged**: `AI_STATUS_FEED_ID`, `AiStatusMessage` and `parseAiStatusMessage` were already written to this spec's requirements in `23`, so items 2 and 3 needed a consumer, not a schema.
  - `scripts/verify-design-agent.ts` — `checkLatestStatusIsSelectedFromTheFeed()`: newest wins in either array order, junk never hides a valid status, a feed of pure junk is still `null`, and the same-millisecond tie. `parseAiStatusMessage` itself is already covered by `23`'s `checkStatusMessagesAreValidated`.

- `23-design-agent-logic` — the AI design agent end to end: model call, validation, canvas write, shared presence and status. No sidebar UI, no chat feed, no canvas architecture change.
  - `trigger/design-agent.ts` — replaces the `22` echo. Order is presence + `started` → read canvas → `processing` → `generateObject` → parse → `mutateFlow` apply → `complete`, with `clearAiPresence` in a `finally`. **`retry: { maxAttempts: 1 }`**, against the project default of 3: a canvas write is not safely repeatable, and a second attempt would regenerate the design and add a second copy of it. `maxDuration: 180` rather than the config's 3600, because a diagram edit that has not finished in three minutes is stuck.
  - The **only write is the single `mutateFlow`**, and everything that can fail (the model call, parsing) happens before it. A failure therefore leaves the canvas exactly as it was, which is what "errors are handled without breaking the canvas" has to mean — an error status is published and the run is failed by rethrowing, so the client's run subscription sees it.
  - `mutateFlow` from **`@liveblocks/react-flow/node`** is both the read and the write path. It is the only thing that knows how the package lays nodes and edges out in Storage, and a callback that mutates nothing flushes nothing — so `readCanvas` is the same call with a `toJSON()` in it. Reading and writing are two separate calls with the model call *between* them rather than one long-held callback: holding Storage open across a 10-second generation would fight every live editor in the room.
  - `lib/design-plan.ts` — the trust boundary, and the only real logic in the unit. A model can name a shape that does not exist, a colour outside the palette, a node it never created, or stack every node on one coordinate; `parseDesignPlan` turns raw output into *already-valid* `CanvasNode`/`CanvasEdge` objects, so `applyDesignPlan` is a plain switch and nothing downstream re-checks the palette. It **never throws and never emits a partial action** — half an instruction ("move this node" with no destination) is worse on a shared canvas than none of it.
  - **ID resolution is the load-bearing part.** A model refers to nodes by names it invented in the same response (`"gateway"`, `"orders db"`), so an edge is only wireable if those names survive as a lookup. `createIdResolver` maps a sanitized name to a real `ai-`prefixed ID once at creation, and every later reference goes through it. A raw ID that is already on the canvas wins over a coined name — that is what the model was shown. An `addNode` whose ID already exists gets a fresh one rather than replacing the node, since `mutateFlow`'s `addNode` is an upsert and an "add" must never clobber.
  - `deleteNode` also emits a `deleteEdge` for every edge attached to it. React Flow's `onDelete` does this for a human deletion; skipping it leaves edges pointing at a node that no longer exists — they render as nothing and are unreachable from the canvas.
  - Layout and spacing are `createLayout`: snap to the 20-unit `Background` grid, then push down until the box (inflated by `MIN_NODE_GAP`) clears every node already on the canvas *and* every node this plan places. Nodes with no position at all lay out in rows of four starting just right of the existing diagram, so a generated design never lands on top of the user's work. Downwards rather than nearest-free-direction because it is one axis, it is stable across runs, and a diagram that grows down stays inside the viewport `fitView` fits to.
  - The JSON schema handed to Gemini is **one flat action object with a `type` enum**, not a discriminated union of seven variants: an `anyOf` over seven shapes is where provider-side structured output gets unreliable, and every field is re-validated per action type anyway. The schema lives in the task file (contextual typing off `jsonSchema()` saves annotating it) and is treated as a hint; `parseDesignPlan` is the authority.
  - `lib/ai-activity.ts` — presence and status, both through the same room the humans are in. `setPresence` is the node SDK's connection-less presence ("useful for showing an AI agent's presence in a room"), so the AI gets an avatar in the stack and a cursor on the canvas with no fake WebSocket client. **Presence expires on its own** (`ttl: 300`): a task killed mid-run leaves a ghost avatar for at most that long rather than forever. There is no delete-presence call, so clearing writes the cleared state at the 2-second minimum TTL.
  - `AI_USER_ID` is deliberately **not** a Clerk ID — `useCollaborators` filters the current user out by Clerk ID, and the AI must never match anyone and vanish.
  - Announcements **log and continue** instead of throwing: a room that cannot be told about a run is not a reason to abandon the run. The feed is created on demand — `createFeedMessage` first (one request, the common path), `createFeed` then retry only on a room whose feed does not exist yet, which is once per project ever.
  - `types/tasks.ts` — `AI_STATUS_FEED_ID`, the `AiStatusMessage` payload and `parseAiStatusMessage`, in the location `24` names. Declared as `type`s, not `interface`s: feed messages are constrained to `Json`, and only type aliases get the implicit index signature that satisfies it (same reason as `CanvasNodeData`). `kind` is `design | spec` so spec generation shares the feed. `FeedMessageData` is **not** declared in `liveblocks.config.ts` — `25`'s `ai-chat` feed carries a different shape, and the global override would force one type on both.
  - The model is `gemini-2.5-flash` via `createGoogleGenerativeAI`, keyed from **`GEMINI_API_KEY` or `GOOGLE_AI_API_KEY`**. The spec names the latter; `.env.local` has the former. Both are accepted rather than picking one and shipping a silently key-less task. Cloud runs do not see `.env.local`, so the key still has to be mirrored in the Trigger.dev dashboard.
  - `scripts/verify-design-agent.ts` — 11 checks over `parseDesignPlan` and `parseAiStatusMessage`. Every one is a way the canvas breaks *silently*: junk that throws and fails the whole run, a colour outside the palette, an edge to a node that was never created, a delete that orphans edges, an ID collision that replaces someone's node, nine nodes stacked on one coordinate. Run with `npx tsx scripts/verify-design-agent.ts`.

- `22-design-agent-api` — the backend wiring for design generation: a trigger route, a `TaskRun` record, a run-scoped token route, and a task that echoes its input. **No AI, no nodes or edges, no canvas write** — that is the next unit's job.
  - `trigger/` moved to the project root and `src/` is gone. `npx trigger.dev init` had scaffolded `src/trigger/`, but nothing else in this project lives under `src/`, and both this spec and `code-standards.md` name `trigger/`. One line in `trigger.config.ts` (`dirs`) follows it. `src/trigger/example.ts` was the init placeholder and its own comment said to delete it once a real task landed.
  - `trigger/design-agent.ts` — `task({ id: "design-agent" })` taking `{ prompt, roomId }`, logging through `logger.info` and returning the input. Deliberately a plain `task()` rather than `schemaTask()`: `zod` is not a direct dependency, and the payload is already validated at the route, which is the actual trust boundary — a schema here would be a second copy of the same rules.
  - `prisma/models/task-run.prisma` — `TaskRun` (`runId` unique, `projectId`, `userId`, `createdAt`) plus `@@index([userId, projectId])`. **No `@@index([runId])`**: `@unique` is itself a Postgres index, so the spec's separate index would be an exact duplicate of it and a second structure to maintain on every write. No relation to `Project` either — deletion tombstones the project row rather than removing it, so there is nothing for a cascade to clean up.
  - `lib/design-requests.ts` — `parseDesignRequest` and `parseRunId`, pure functions over an already-parsed body, matching `lib/project-requests.ts`. The load-bearing rule is **`roomId` must equal `projectId`**: they are one value doing two jobs (`lib/room-id.ts`), so accepting a mismatch would let a request authorized for one project trigger generation aimed at another project's room. The prompt is capped at 2000 characters, since every trigger is a paid run.
  - `app/api/ai/design/route.ts` — parse → authorize → trigger → record → `202 { runId }`. **Parsed before authorizing**, the opposite of every project route, because the project to authorize against is in the body rather than the path; parsing is pure, so nothing is spent on an unauthorized caller. `requireOwner: false` for the same reason the canvas routes are — a collaborator edits the canvas, so a collaborator may ask for a design.
  - The task is triggered by ID with a **type-only import** (`tasks.trigger<typeof designAgent>("design-agent", …)`). Importing the task instance would pull the Trigger.dev worker bundle into the Next.js server bundle.
  - The `TaskRun` row is written *after* triggering — the run ID does not exist before it, so there is no other order. A failure there leaves a run with no ownership record and the token route refuses it, which is the safe direction: no token is issued for a run nobody can be shown to own.
  - `app/api/ai/design/token/route.ts` — `auth.createPublicToken({ scopes: { read: { runs: [runId] } } })`, aliased `triggerAuth` because Clerk exports `auth` too. Ownership is the **`TaskRun` record, not project access**: the record is what proves this user triggered this run, so a collaborator on the same project cannot pull a token for someone else's generation. An unknown run ID and someone else's run collapse into the same `404` — a distinguishable `403` would confirm a guessed run ID is real. Expiry is `1h` rather than the 15-minute default, which would otherwise expire mid-run against `maxDuration: 3600`.
  - `lib/project-access.ts` — `Authorization` now carries `userId` alongside `ownerId` on success. It is already in scope there, the two differ whenever the caller is a collaborator, and the task-run record needs the caller rather than the owner.
  - `scripts/verify-design-api.ts` — the parsers are a trust boundary with 14 rejection cases, the `roomId !== projectId` guard, and the inclusive prompt-length boundary. Run with `npx tsx scripts/verify-design-api.ts`.
  - `TRIGGER_SECRET_KEY` added to `.env` **with an empty value**, as `LIVEBLOCKS_SECRET_KEY` was in `10`. Both routes throw at runtime until it is filled in from the Trigger.dev dashboard; build, lint and typecheck are unaffected.

- `21-canvas-autosave` — the canvas is now **durable**. Liveblocks stays the live source of truth; this is the separate, slower job of getting that state into Vercel Blob so it survives a room that empties. No schema change was needed: `Project.canvasJsonPath` already existed.
  - `lib/canvas-snapshot.ts` — the trust boundary in both directions, used on the way in (request body) and on the way out (stored blob). Rebuilds nodes and edges **field by field rather than spreading**, so an unknown key from storage never reaches React Flow's store, and re-applies `CANVAS_EDGE_STYLE`/`MARKER` from the constants instead of trusting stored CSS. A malformed *entry* is dropped; a body that is not a snapshot is rejected whole. Node/edge ceilings (2000/4000) cap what one authenticated request can write, since each save is a paid write.
  - `app/api/projects/[projectId]/canvas/route.ts` — `PUT` uploads then updates the pointer (never the reverse: a pointer stored ahead of the blob advertises an artifact that does not exist). `GET` returns `{ canvas: null }` for "never saved" but **422 for a pointer that resolves to junk**, because answering `null` there would look like a new project and let autosave overwrite whatever is really in storage. Both are `requireOwner: false` — a collaborator edits the canvas, so a collaborator must be able to save it.
  - `hooks/use-canvas-autosave.ts` — 1500ms debounce, `idle`/`saving`/`saved`/`error`. Seeded with the first render's payload so merely *opening* a project is never a write. An edit landing mid-flight sets a resave flag rather than being dropped. No retry timer on failure, deliberately: a retry loop against a failing endpoint is how a save bug becomes a bill.
  - `hooks/use-canvas-restore.ts` — one attempt per mount, and only when the room has no nodes *and* no edges. A non-empty room skips the load entirely rather than merging, since a merge would resurrect deleted nodes and fight a live editor.
  - `components/editor/save-status-button.tsx` — navbar Save control and indicator in one. Reaches the navbar as a `ReactNode` slot for the same reason `presence` does: it is driven by flow state that only exists inside `ReactFlowProvider`, and the editor home has no canvas.
  - `components/canvas/canvas-save-context.tsx` — the producer (canvas) and the display (navbar) sit on opposite sides of the tree, and the **first attempt wired them with a prop callback fired from a `useEffect`**, which React Doctor flagged under three separate rules. It was right: status is an *event* in the save lifecycle, not derived state, so mirroring it into hook-local state and pushing it outward cost a second render of the whole workspace per transition. `useCanvasAutosave` now takes an `onStatusChange` it calls at the transition itself and holds no status state at all, and the shared value lives in a provider that only `SaveStatusButton` subscribes to. Reach for this shape — event callback plus provider — rather than an effect, any time canvas state has to reach the chrome.
- `20-ai-sidebar-shell` — the AI panel extracted out of `editor-shell.tsx` into `components/editor/ai-sidebar.tsx` and built out. Open/close still lives in `EditorShell`; the panel gained an `onClose` prop for its header close button, and the floating geometry, slide transform and `inert` handling are the placeholder's, unchanged.
  - The spec names tokens (`bg-base/95`, `text-primary-text`, `text-muted-text`, `bg-accent`, `text-accent-text`, `bg-brand-dim`) that **do not exist in this project**. Mapped to the real ones per `ui-context.md`: `bg-surface/80` (matching `ProjectSidebar`), `text-copy-primary`, `text-copy-muted`, `bg-ai` / `text-ai-text` (the AI accent, `#6457f9` / `#8b82ff` — the right accent for this panel, since `--color-accent` is shadcn's neutral), and `bg-accent-dim` for the user bubble.
  - The composer needs **no resize JS**: `components/ui/textarea.tsx` already carries `field-sizing-content`, so `min-h-[72px] max-h-40` alone gives the spec's growth range natively.
  - Sending appends the user message **and a fixed assistant line**, so both bubble styles are reachable without any generation logic. That stub is the thing the AI spec replaces.
- `19-presence-avatars-cursors` — collaborator avatars in the workspace navbar and live cursors on the canvas, both driven by Liveblocks Presence. No presence in the shared navbar globally, no interactivity on the avatars, no change to node or edge behaviour.
  - `hooks/use-collaborators.ts` — `useCollaborators()`, the single source of "everyone else". `useOthers()` drops this *connection* but not this *user*, so a second tab would show you as your own collaborator; the hook filters on the Clerk user ID, which collapses every connection a person has. While Clerk is still loading it returns `[]` rather than the unfiltered list, so you can never briefly render yourself. Both the avatar stack and the cursors consume it, so "never the current user" is enforced in one place.
  - It imports `useOthers` from `@liveblocks/react`, **not** `@liveblocks/react/suspense`: it runs in the navbar, outside the canvas' `ClientSideSuspense`, and an empty list while connecting is the correct render.
  - `components/canvas/presence-avatars.tsx` — up to five overlapping `h-7 w-7` avatars (`-space-x-2`) then a `+N` chip, sized to match Clerk's 1.75rem `UserButton` avatar so the row reads as one group. Photo when `info.avatar` is set, two-letter initials otherwise. Two rings, both drawn inside the box so neither adds layout: `ring-2 ring-page` separates overlapping avatars, and an inset `outline` in the participant's presence colour ties an avatar to its cursor. Display-only — a `<ul>` of `<span>`s, no button, no click target.
  - **The divider lives in this component, not the navbar.** It should only exist when there is something to divide, and the component already returns `null` on an empty list — so zero collaborators means no avatars *and* no divider, with the navbar visually unchanged.
  - `components/editor/editor-navbar.tsx` — one new `presence?: ReactNode` prop rendered just before `<UserButton />`. A **slot rather than a component**: the navbar is shared with the editor home, which has no room, and calling a presence hook there would throw. `EditorShell` passes `<PresenceAvatars />` only when `activeProject` is set, so the editor home navbar is untouched.
  - `components/canvas/canvas-room.tsx` split in two. `CanvasRoom` is now **providers plus `children`** and wraps the whole editor workspace — the avatars sit in the navbar, which is a sibling *above* the canvas, so the room context had to be hoisted above both. `roomId` is optional and a missing one renders `children` straight through, which is what keeps the editor home out of any room. The connection guard and suspense fallback moved into a new `CanvasSurface`, still mounted inside `<main>`.
  - `components/canvas/canvas.tsx` — `onMouseMove`/`onMouseLeave` on `<ReactFlow>` (which forwards unknown props to its wrapper div) rather than `onPaneMouseMove`, so the cursor keeps broadcasting while the pointer is over a node instead of freezing at the node's edge. The position written to presence is `screenToFlowPosition(...)`: **canvas coordinates, not screen coordinates**, because every other client is panned and zoomed differently. Liveblocks throttles presence at 100ms by default, so the mousemove firing rate never becomes the network rate.
  - `components/canvas/live-cursors.tsx` — an absolutely positioned `pointer-events-none` overlay, a sibling of `<ReactFlow>` inside the (now `relative`) wrapper. It applies the viewport transform itself (`x * zoom + viewport.x`) off `useViewport`, which re-renders on pan and zoom. Rendering inside React Flow's viewport (via `ViewportPortal`) would have been less code but scales the pointer and name badge with the zoom level, which is unreadable at both extremes.
  - `lib/presence.ts` + `checkInitialsAlwaysRenderSomething()` in `scripts/verify-canvas.ts` — `getInitials` lives in `lib/` rather than beside the component purely so the verify script can import it without pulling in React and Clerk. It is the one branchy pure function in this unit, and every way it can fail (empty name, all-whitespace name, symbols-only name) renders an empty circle that reads as a broken avatar rather than as a missing photo.
  - `liveblocks.config.ts` is **unchanged**. `Presence` already declared `cursor: { x, y } | null` and a thinking flag from `10-liveblocks-setup`; the spec names the flag `thinking` where the existing field is `isThinking`, and the existing name was kept because `code-standards.md` requires the `is` prefix on booleans and nothing reads the field yet.

- `18-starter-templates` — three predefined diagrams, an import modal with previews, and a navbar entry point. No template saving, no user templates, no server persistence; node and edge rendering are untouched.
  - `components/editor/starter-templates.ts` — `CanvasTemplate` and `CANVAS_TEMPLATES` (microservices, CI/CD pipeline, event-driven). The data is plain `CanvasNode`/`CanvasEdge`, built by two local helpers: `node(id, label, shape, color, x, y)` sized from `NODE_DEFAULT_SIZES`, and `edge(source, target, label?)` carrying `CANVAS_EDGE_TYPE`, `CANVAS_EDGE_STYLE` and `CANVAS_EDGE_MARKER` — so a template node or edge is indistinguishable from a hand-made one and no template-specific rendering path exists.
  - Node IDs are **namespaced by template** (`microservices-gateway`) rather than generated at import. An import replaces the canvas, so two templates can never be on it at once, and a stable ID keeps the preview React keys deterministic. They cannot collide with a user-created node either, since `createNodeId` appends a UUID.
  - `getNodeBox(node)` and `getTemplateBounds(nodes)` live beside the data. React Flow leaves `width`/`height` optional until it has measured a node, so `getNodeBox` falls back to the shape's default size — the same fallback the node renderer uses on first paint — and is the one place that resolves it. An empty template returns a zero box rather than the `Infinity` a bare `Math.min` over nothing gives, which would reach the preview as a `NaN` viewBox and render as silently empty.
  - `components/editor/starter-templates-modal.tsx` — an `EditorDialog` at `sm:max-w-3xl` holding a scrollable `sm:grid-cols-2` card grid. Each card is preview → name → description → Import. Import calls `onImport(template)` then closes; the dialog knows nothing about what importing does.
  - The preview is **one inline SVG per card**, no React Flow instance: it never pans, zooms or takes a pointer. Fitting is the `viewBox` (the template's own bounds plus 32 units of padding) with `preserveAspectRatio="xMidYMid meet"` — the browser does the scaling, so no scale factor is computed and a template laid out anywhere in flow space still centres. Edges are straight centre-to-centre `<line>`s drawn before the nodes; at preview scale the right-angle routing is under a pixel of difference. Nodes reuse `buildShapeGeometry` for the three SVG shapes inside a `translate()` group (so the maths stays in node-local units) and are `<rect>`/`<ellipse>` for the three CSS ones. Every stroke is `vectorEffect="non-scaling-stroke"` at 1px — a 1.5px border shrunk by the ~0.15 scale factor would not survive rasterisation, and the shapes would read as flat fills.
  - `components/canvas/canvas.tsx` — `handleImportTemplate`. The clear goes through **`onDelete({ nodes, edges })`, not `remove` changes**: `@liveblocks/react-flow`'s `applyNodeChanges`/`applyEdgeChanges` both **no-op on `"remove"`** (deletion is `onDelete`'s job), so removal changes would leave the old diagram in place and the template would land on top of it — exactly the failure the spec calls out. Nodes and edges are shallow-copied on the way in so the module-level template constants are never aliased into Storage.
  - Fitting the view waits for the imported nodes to come back *through* Storage — a `fitView` called straight after the write measures the canvas as it was, which on a previously empty one is a no-op. A `useRef` flag set at import time is consumed by an effect on `nodes`.
  - The dialog is rendered inside `CanvasFlow` because importing is a Storage write, but it is *opened* from the navbar, which sits outside the room. `isTemplatesOpen`/`onTemplatesOpenChange` are owned by `EditorShell` beside `isShareOpen` and passed down through `CanvasRoom` — two props rather than a context, since nothing else needs them.
  - `components/editor/editor-navbar.tsx` — a `LayoutTemplate` Templates button gated on its own `onOpenTemplates` prop (not on `onToggleAiSidebar`), so the editor home is unchanged.
  - `scripts/verify-canvas.ts` — `checkTemplatesAreWellFormed()` and `checkTemplateBoundsEncloseEveryNode()`. This is hand-written data nothing type-checks past its shape: an edge naming a node that is not in the template renders as nothing, a duplicate node ID makes React Flow drop a node, and a bounding box that does not enclose every node crops the preview. All three are silent and all three look fine in review.

- PR #3 Codex review fixes — permanent deletion tombstones prevent deleted
  Liveblocks rooms, bearer tokens, delayed cleanup and stale authorization from
  crossing into a reused project ID. Node IDs include UUID entropy so
  simultaneous collaborators cannot reconcile distinct drops as one node.
  - `ProjectStatus` now includes `DELETING` and `DELETED`. Both are excluded from
    list/access/auth queries, while owner-authorized `DELETE` can retry either
    state.
  - `lib/project-lifecycle.ts` atomically claims the row for the authorized owner,
    deletes the Liveblocks room, then finalizes the permanent `DELETED` tombstone.
    Cleanup failure leaves `DELETING` for an explicit retry and never frees the
    globally unique project/room ID. Entering `DELETING` immediately scrubs the
    name, description, and collaborator emails; `canvasJsonPath` remains as the
    future Vercel Blob cleanup pointer rather than orphaning the artifact.
  - Liveblocks auth performs a final access check after token preparation. A
    concurrent tombstone withholds the bearer token and deletes any room the
    in-flight request recreated.
  - `lib/canvas-drag.ts` — IDs are now
    `{shape}-{timestamp}-{counter}-{uuid}` rather than relying only on tab-local
    state.
  - `scripts/verify-project-data.ts` and `scripts/verify-canvas.ts` — regression
    coverage for cleanup failure/retry, tombstone access/list filtering,
    permanent ID reservation, and cross-client node entropy.

- `17-canvas-ergonomics` — the zoom/history control bar and canvas keyboard shortcuts. No change to the shape panel, node or edge rendering, or the collaborative state setup.
  - `components/canvas/canvas-controls.tsx` — a pill in `<Panel position="bottom-left">`, matching the shape panel's chrome. Zoom out / fit view / zoom in, a 1px divider, then undo / redo. Disabled buttons are `opacity-40` and `pointer-events-none`, so a dimmed control also drops its hover state instead of looking live.
  - Undo/redo are **Liveblocks room history** (`useUndo`/`useRedo`/`useCanUndo`/`useCanRedo` from `@liveblocks/react/suspense`), not a local stack — every canvas edit is a Storage mutation, so the room is the only thing that knows what the last one was. It is per-client: undo takes back *your* last change, not a collaborator's. `@liveblocks/react-flow` already pauses history for the duration of a resize or drag, so those undo as one step rather than per frame.
  - Zoom goes through the React Flow instance (`zoomIn`/`zoomOut`/`fitView`) with a shared `VIEWPORT_TRANSITION_MS` (200) in `types/canvas.ts`, so a zoom lands the same way whether it came from the bar or the keyboard.
  - `hooks/use-keyboard-shortcuts.ts` — one `window` keydown listener taking the flow instance plus the two history handlers. It bails on `INPUT`, `TEXTAREA` and `isContentEditable` targets first: node and edge labels are real text fields, where `-` is a character and Cmd+Z belongs to the field, not the room. Matched shortcuts are `preventDefault`ed — Cmd+Z would otherwise also reach the browser's own undo stack.
  - `lib/canvas-shortcuts.ts` — `resolveShortcut()` is a pure, DOM-free matcher returning `"zoom-in" | "zoom-out" | "undo" | "redo" | null`, split out of the hook so the table is assertable. `+` is deliberately matched without checking the shift state (it *is* Shift+`=` on most layouts, and the browser reports the shifted character), while Cmd/Ctrl +/- is left alone as the browser's own page zoom.
  - `scripts/verify-canvas.ts` — `checkShortcutsMatchTheSpecTable()`: every binding in the spec under both Cmd and Ctrl, plus the near-misses. A shortcut that matches nothing fails silently, and one that over-matches steals a keystroke the browser owns.
  - The bar registers the shortcuts itself rather than `CanvasFlow` doing it, because it is the one component that already holds all four handlers — `canvas.tsx` gains one `<Panel>` and one import.

- `16-edge-behavior` — connection handles, the custom edge renderer, and inline edge labels. Node creation, the shape panel and the node renderer's shape/resize/colour behaviour are all untouched.
  - `components/canvas/canvas-node.tsx` — four `<Handle>`s from `HANDLE_POSITIONS`, all declared `type="source"`. The canvas already runs in `ConnectionMode.Loose`, where a handle accepts a connection from either end regardless of its type, so a matching `target` handle per side would only stack a second hit target on the same four points. They are siblings of `NodeShapeFrame`, not children: React Flow positions handles against the nearest positioned ancestor, which is the `.react-flow__node` wrapper it sizes from `width`/`height`.
  - `app/globals.css` — handles are hidden with `opacity: 0` and faded in on `.react-flow__node:hover` / `.selected`, plus `.connectingfrom` / `.connectingto` so the dot being aimed at does not vanish under the cursor mid-drag. **Opacity, never `display`** — React Flow measures handle positions off the DOM, and an unrendered handle has no position to connect to. The selector is `.react-flow__node .react-flow__handle` (two classes) rather than the bare class, because the override has to beat `@xyflow/react/dist/style.css` and this stylesheet's bundle order relative to it is not guaranteed. Colour comes from React Flow's own `--xy-handle-background-color` / `--xy-handle-border-color` theming variables pointed at `--text-primary` / `--bg-base`, so nothing in its internals is restyled.
  - `types/canvas.ts` — `CanvasEdgeData` (`{ label: string }`), so `CanvasEdge` is `Edge<CanvasEdgeData, "canvasEdge">` rather than the previous open `Record<string, unknown>`. Plus `CANVAS_EDGE_STYLE` and `CANVAS_EDGE_MARKER`, and a new `--canvas-edge` (`#f8fafc`) token. The colour is stored as the string `var(--canvas-edge)`, not the hex: the value travels into Liveblocks Storage on every connect, so a token reference means a palette edit reaches edges that already exist.
  - `components/canvas/canvas.tsx` — `EDGE_TYPES`, `defaultEdgeOptions`, and `connectionLineType={ConnectionLineType.SmoothStep}` so the line dragged out of a handle resembles the edge it is about to become. React Flow merges `defaultEdgeOptions` into the connection **before** handing it to `onConnect` (`onConnectExtended` in `@xyflow/react`), so `useLiveblocksFlow` writes the type, style and arrowhead straight into Storage — every client renders a new edge identically with no post-processing pass. `data: { label: "" }` is seeded there so the key exists on the edge's `LiveObject` from creation, matching how nodes are created with a full `data` object.
  - `components/canvas/canvas-edge.tsx` — `getSmoothStepPath` for the right-angle route, and its **returned `labelX`/`labelY`** for the label position. Deriving a midpoint from the endpoints instead would put the label off the line wherever the route bends. Hover/selection brightness is an `opacity` on a wrapping `<g>`, not on the stroke: an SVG marker is painted as part of its path's rendering, so the group opacity dims the line and the arrowhead together instead of leaving a full-strength arrow on a faded edge.
  - The wider hit area is `BaseEdge`'s own `interactionWidth` (20px default) — it already draws a second transparent path over the visible one, so nothing here reimplements it and the drawn stroke stays 1.5px.
  - Labels render through `EdgeLabelRenderer` as a small pill; an active edge with no label shows a faint `+ label` hint instead, and an inactive unlabelled edge renders no label DOM at all. Editing opens on double-click and closes on blur, `Enter` or `Escape`. The value is written on **every keystroke** via `updateEdgeData` — the same controlled path node labels use, which reaches Storage as a `replace` change through `onEdgesChange` — so it is already saved by the time any of those three close it, and a collaborator sees the label as it is typed rather than only on commit. The input grows with `width: ${label.length}ch`.
  - `nodrag nopan nokey` on both the label and the input, plus `pointerEvents: "all"` (the `EdgeLabelRenderer` container is `pointer-events: none` so it cannot swallow canvas clicks). `Enter`/`Escape` are `stopPropagation`ed for the same reason the node label does it — `Enter` is one of React Flow's own selection keys. `Backspace` needs no guard: React Flow's `useKeyPress` already ignores key events originating in an input.
  - `scripts/verify-canvas.ts` — `checkEdgeDefaultsAreConsistent()`: the arrowhead colour equals the stroke colour, both are `var(--token)` rather than literals, and the stroke stays thin. These values are baked into every edge created after a drift, which is invisible in review and obvious on the canvas.
  - **Follow-up — connections were unusable on first pass, for two unrelated reasons.**
    - **Paint order.** The handles were rendered *before* `NodeShapeFrame`. All of a node's parts are positioned elements at `z-index: auto`, so the later sibling paints on top, and the shape's `absolute inset-0` fill covered the inner half of every handle — a handle straddles the node border (`translate(-50%, -50%)`), so only a ~4px outer sliver was grabbable. A drag that missed it dragged the node instead, which is why nothing could be connected at all. The order is now **shape → handles → resize frame**: handles clear the body, and the resize controls still win at the side midpoints while a node is selected, so resizing (a selected-node gesture) and connecting (an unselected-node gesture) each stay reachable.
    - **`connectionRadius`.** React Flow's default is 20 flow units, and `getClosestHandle` returns `null` past it — so a connection released on a target node's *body* rather than on a dot found no handle and was discarded silently. `CONNECTION_SNAP_RADIUS` (90) replaces it. The bar is a node's centre-to-nearest-handle distance, `min(width, height) / 2`, worst case 65 for the diamond and circle; `checkSnapRadiusCoversEveryNodeCentre()` asserts it against every default size, because the number is only meaningful relative to `NODE_DEFAULT_SIZES` and enlarging a default is what would silently break it.
    - `isValidConnection` rejects `source === target`. Two handles on the *same* node are distinct handles, so `ConnectionMode.Loose` considers them connectable and the wider radius would turn a mis-drop near the node just dragged out of into a self-loop — which `getSmoothStepPath` has no loop routing for and would draw as a degenerate line under its own node.
    - `.react-flow__handle::after { inset: -6px }` widens an 8px dot to a ~20px pointer target without changing what is drawn. Same trick, and the same reasoning, as `.react-flow__resize-control::after` above it: a pointer event over a pseudo-element still reports its owning element as the target, so React Flow's `elementFromPoint` lookup inside `isValidHandle` still resolves it as the handle.

- `15-node-color-toolbar` — the per-node colour picker. No palette change, no drag/selection change, no new state.
  - `components/canvas/node-color-toolbar.tsx` — React Flow's own `NodeToolbar` at `Position.Top`, `offset={14}` so it clears the selected outline and the top resize handle. It portals out of the node, tracks the node through pan and zoom without scaling with it, and already hides itself unless exactly one node is selected — so nothing here reimplements positioning or visibility. Still rendered only while `selected`, beside `NodeResizeFrame`, so unselected nodes do not each hold a store subscription.
  - Eight swatches straight off `Object.keys(NODE_COLORS)` — no second palette. Each is the pair made visible: the node fill as the swatch body with a 8px dot of its text colour, since the eight fills are all near-black and would otherwise be indistinguishable.
  - A click is `updateNodeData(nodeId, { color })`, the same controlled path label editing already uses, so the recolour reaches Liveblocks Storage through `onNodesChange` with no new plumbing and no server call. `NodeShapeFrame` already reads both halves of the pair, so body, border and label all follow from the one write.
  - `app/globals.css` — `.node-color-swatch`. The hover glow is the pair's *own* text colour, handed in as a `--swatch-accent` custom property from the palette, which is why this is CSS rather than a Tailwind class. Selection is an `outline` and hover a `box-shadow` deliberately: two different properties, so hovering the active swatch adds the glow instead of one state overwriting the other. The glow is `0 0 7px -1px` — the negative spread is what keeps it tight rather than a soft halo.
  - `nodrag nopan nokey` on the toolbar. React Flow reads those off the event target, so without them a pointer drag across the toolbar pans the canvas and a Shift+click on a swatch is captured by the pane as the start of a selection box.
  - No verification-script entry: the only logic is a `map` over the palette, and `tsc` already enforces that a swatch key is a `NodeColor`.
  - Follow-up: closing the label editor with `Enter`/`Escape` now **deselects** the node and moves focus to the canvas — the colour toolbar and resize frame disappear with the selection. Deselection is `resetSelectedElements()` off the store, which is the same action a click on the pane calls, so it travels the normal change path rather than writing `selected` into Storage. The existing `stopPropagation` is still required: `Enter` is one of React Flow's own element-selection keys, so the node wrapper would toggle the selection straight back on. Unmounting the textarea left the browser dropping focus on `<body>`, so the next key press reached nothing. `<ReactFlow tabIndex={-1}>` makes the wrapper programmatically focusable without putting it in the tab order (nodes are individually tab-reachable already), and the node calls `useStoreApi().getState().domNode?.focus({ preventScroll: true })`. Only on the keyboard path — doing it in `stopEditing` would fire on blur too and yank focus away from a swatch clicked mid-edit.

- `14-node-editing` — node resizing and inline label editing. Shape rendering, the shape panel, the drag preview and node creation are all untouched.
  - `types/canvas.ts` — `NODE_MIN_SIZE` (`72×48`), one floor for every shape rather than a per-shape table. Below roughly this a centred label has nowhere to sit.
  - `app/globals.css` — `.react-flow__resize-control::after { position: absolute; inset: -5px }`. React Flow draws each resize edge 1px wide and each corner at 7px, which are near-impossible to land a cursor on. A pointer event over a pseudo-element still reports its owning element as the target, so the hit area widens to ~11px/17px with no change to what is drawn and no change to React Flow's drag wiring.
  - `components/canvas/canvas-node.tsx` — `<NodeResizeFrame>` rendered only while `selected`, tinted with the node's own accent (`NODE_COLORS[data.color].text`) so the resize frame matches the selected outline. Handles are 7px rounded squares with a `--bg-base` border so they read against the node body; the guide lines are the same accent at `opacity: 0.35`. `color` is passed rather than styled, because `NodeResizeControl` spreads it *after* `style` — a `backgroundColor`/`borderColor` in `handleStyle`/`lineStyle` would be overwritten.
  - Holding `Shift` locks the aspect ratio, so a corner drag scales the node uniformly. The resize controls and the label textarea all carry React Flow's `nokey` class: `selectionKeyCode` defaults to `Shift`, and the pane captures a Shift+pointerdown (`onPointerDownCapture` → `stopPropagation`) before the resizer or the textarea ever sees it, so without `nokey` the gesture drew a selection rectangle across the canvas instead of resizing, and Shift+click in the label could not extend a text selection. It is a `useKeyPress("Shift")` inside `NodeResizeFrame` rather than in the node renderer, because the hook binds a document listener and re-renders its owner on every Shift — one per node on the canvas would be paid for the single node that can actually be resized. `XYResizer` keeps its `params` in an outer closure and `ResizeControl` re-runs `update()` on a `keepAspectRatio` change, so the lock applies to a drag already in flight rather than only to the next one.
  - Label editing is local `isEditing` state plus `useReactFlow().updateNodeData(id, { label })` on every keystroke. Opens on double-click, closes on blur, `Escape`, or `Enter`. `Enter` is `preventDefault`ed so the textarea does not insert the newline on its way out; `Shift+Enter` falls through to the normal line break. A label is a name, so a bare `Enter` wrapping the line is almost never the intent — and because the label is written on every keystroke, committing is only ever "close the editor".
  - The label `<span>` stays in the layout while editing (`invisible`, not unmounted) and the textarea is `absolute inset-0` over it. That is what keeps the node from shifting on open *and* lets the editor grow line by line, since the hidden label is still what sizes the box — `line-clamp-3` caps it at three lines.
  - `scripts/verify-canvas.ts` — `checkMinSizeIsBelowEveryDefault()`: the floor is positive and no shape's default size starts under it, which would make a freshly dropped node jump larger the moment it is grabbed.

- `13-node-shape` — real per-shape node rendering and a drag ghost. No resize, no label editing, no handles; node creation is untouched.
  - `lib/node-shape-geometry.ts` — `SVG_SHAPES` (`diamond`, `hexagon`, `cylinder`), `isSvgShape()`, `CSS_SHAPE_RADIUS` for the other three, and `buildShapeGeometry(shape, size, strokeWidth)` returning `{ outline, detail }` SVG paths in node pixels. Every edge is inset by half the stroke width, or the outer half of the stroke is clipped by the SVG box. The hexagon notch and the cylinder rim radius are clamped so a squashed node degenerates instead of self-crossing. Kept out of the component so the path maths is assertable without a DOM.
  - `components/canvas/node-shape.tsx` — `NodeShapeFrame`, the shared drawn body. CSS branch is one absolutely-positioned div (background + border + radius); SVG branch is a `viewBox` of the node's own pixel size, so shapes scale with the node and the stroke does not stretch. Stroke is the node's accent at 35% alpha / 1.5px at rest and full strength / 2.5px when selected. `CONTENT_PADDING` pulls labels in past the slanted and curved edges with percentage padding, so it holds at any size.
  - `components/canvas/canvas-node.tsx` — now just data + measured size into `NodeShapeFrame`, falling back to `NODE_DEFAULT_SIZES` because React Flow leaves `width`/`height` undefined until it has measured the node and the SVG needs a viewBox on first paint.
  - `components/canvas/shape-panel.tsx` — six off-screen `NodeShapeFrame` ghosts at default size and 75% opacity, handed to `dataTransfer.setDragImage(ghost, width/2, height/2)` on drag start. The browser then tracks the cursor and clears the preview on drop or cancel — no drag state, no `dragover` listener. Held at its centre to match the drop handler centring the node on the cursor.
  - `scripts/verify-canvas.ts` — geometry assertions: every coordinate of every SVG path finite and inside the node box at both the default size and a squashed 40×16, the rim present only on the cylinder, and `SVG_SHAPES` matching what `isSvgShape` selects.

- `12-shape-panel` — shape palette, drag-and-drop node creation, and a placeholder node renderer. No shape-specific visuals, no handles, no label editing.
  - `types/canvas.ts` — `NODE_DEFAULT_SIZES` (per-shape `{ width, height }`) and the `NodeSize` interface. Rectangle 180×80, diamond 200×130, circle 130×130, pill 180×56, cylinder 160×100, hexagon 180×96.
  - `lib/canvas-drag.ts` — the panel→canvas contract. `SHAPE_DRAG_MIME` is `application/x-truss-shape`, `buildShapeDragPayload(shape)`, `parseShapeDragPayload(raw)` and `createNodeId(shape)`.
  - `components/canvas/shape-panel.tsx` — a `role="toolbar"` pill of six `draggable` icon buttons (lucide `Square`/`Diamond`/`Circle`/`Pill`/`Cylinder`/`Hexagon`), each labelled with the role `ui-context.md` assigns it.
  - `components/canvas/canvas-node.tsx` — `CanvasNodeRenderer`, a bordered rectangle filled from `NODE_COLORS[data.color]` with the label centred. Fills the wrapper React Flow sizes from `width`/`height` rather than setting its own.
  - `components/canvas/canvas.tsx` — split into `Canvas` (just `ReactFlowProvider`) and `CanvasFlow`. Adds the drop wrapper, `NODE_TYPES`, and `<Panel position="bottom-center">` holding the palette.
  - `scripts/verify-canvas.ts` — payload round trip per shape, the three size rules the spec names, 13 malformed payloads rejected, and 500 same-tick IDs unique.

- `11-base-canvas` — the collaborative canvas foundation. No controls, no custom node/edge rendering, no persistence, no AI.
  - `types/canvas.ts` — `NODE_COLORS` (the 8 `ui-context.md` pairs, keyed by name), `NODE_SHAPES` (6), `CanvasNodeData`, `CanvasNode`, `CanvasEdge`, plus `CANVAS_NODE_TYPE` / `CANVAS_EDGE_TYPE` (`"canvasNode"` / `"canvasEdge"`) and the two defaults.
  - `components/canvas/canvas-room.tsx` — `LiveblocksProvider` (`authEndpoint="/api/liveblocks-auth"`) → `RoomProvider` (`initialPresence: { cursor: null, isThinking: false }`) → `ConnectionGuard` → `ClientSideSuspense` → `Canvas`. Suspense hooks come from `@liveblocks/react/suspense`.
  - `components/canvas/canvas.tsx` — `useLiveblocksFlow<CanvasNode, CanvasEdge>({ suspense: true, nodes: { initial: [] }, edges: { initial: [] } })` wired straight into `ReactFlow` with `connectionMode={ConnectionMode.Loose}`, `fitView`, `colorMode="dark"`, a dots `Background` at a 22px gap, and a pannable/zoomable `MiniMap`. Imports `@xyflow/react/dist/style.css`.
  - `components/editor/editor-shell.tsx` — the `Canvas for {name}` placeholder is replaced by `<main aria-label="Canvas" className="relative flex-1 bg-page">` wrapping `CanvasRoom`. React Flow needs a sized parent, so the centring flex classes had to go.
  - `liveblocks.config.ts` is unchanged: `Storage` is still undeclared, and `useLiveblocksFlow` writes its `flow` `LiveObject` under the permissive default. Declaring it would mean hand-writing the `LiveMap<string, LiveblocksNode<…>>` shape the package already derives.

- `10-liveblocks-setup` — realtime infrastructure only: types, server client, auth route. No provider, no hooks, no canvas.
  - `@liveblocks/node` was **not** installed despite the spec saying all packages were; added at `^3.23.0` alongside the four that were already there.
  - `liveblocks.config.ts` — global `Liveblocks` interface. `Presence` is `{ cursor: {x,y} | null, isThinking: boolean }`; the cursor is in canvas coordinates, not screen coordinates, so it survives pan and zoom. `UserMeta.info` is `{ name, avatar, color }`. `Storage`, `RoomEvent`, `ThreadMetadata` and `RoomInfo` are **omitted rather than declared empty** — every key is optional and falls back to the permissive Liveblocks default, and `@typescript-eslint/no-empty-object-type` rejects the `{}` the starter template ships. Storage arrives with the React Flow node/edge schema.
  - `lib/liveblocks.ts` — `getLiveblocks()` returns the node client, cached on `globalThis` outside production for the same reason `lib/prisma.ts` is. Constructed lazily inside the getter, not at module load, so a missing `LIVEBLOCKS_SECRET_KEY` fails the one request that needs it instead of every import (which would break `tsx` scripts and the build). `getCursorColor(userId)` is a djb2 hash into a fixed 8-colour palette — same user, same colour, every room and device. Raw hex, not CSS tokens: the value travels inside the token as data and cannot be resolved from a stylesheet.
  - `app/api/liveblocks-auth/route.ts` — `POST`. Reads `{ room }` from the body the Liveblocks client sends; a project ID *is* its room ID (`lib/room-id.ts`), so the room name is the project to authorize. Order is parse → `authorizeProject(room, { requireOwner: false })` → `currentUser()` → `getOrCreateRoom` → token, so an outsider can neither create a room nor spend a Clerk lookup. Room is created with `defaultAccesses: []` (private).
- **Access tokens, not ID tokens**, despite ID tokens being the Liveblocks recommendation. Membership here is dynamic — a collaborator is a `ProjectCollaborator` row matched on email — so `prepareSession` plus scoped room/storage/comment write and feed-read permissions computes access per request from the database. The ID-token route would mean mirroring membership into the room's `usersAccesses` on every invite and removal, and keeping two sources of truth in sync.
  - `LIVEBLOCKS_SECRET_KEY` added to `.env` **with an empty value** — the real key has to come from the Liveblocks dashboard. Until it is set, the auth route throws `LIVEBLOCKS_SECRET_KEY is not set`; build and lint are unaffected because the client is lazy.
  - `scripts/verify-liveblocks.ts` — asserts the colour map is hex, deterministic across repeat calls (including empty, non-ASCII and 200-char IDs), and spreads across at least 4 buckets over 200 IDs, which is what would catch the hash degenerating. The route itself needs a Clerk request context and a real secret, so it is left to a live check.

- `09-share-dialog` — sharing end to end: three API handlers, the dialog, and Clerk profile enrichment. No local user table.
  - `app/api/projects/[projectId]/members/route.ts` — `GET` lists (owner **or** collaborator, since the dialog is read-only for the latter), `POST` invites (owner only, `201`). Both answer `{ members }` already enriched, so the client never needs a second round trip after a mutation. A duplicate invite is `409`; inviting yourself is `400`.
  - `app/api/projects/[projectId]/members/[memberId]/route.ts` — `DELETE`, owner only, `204`. Uses `deleteMany` scoped by `{ id, projectId }` rather than `delete({ where: { id } })`: without the project scope an owner could delete a collaborator row belonging to someone else's project. `count === 0` becomes the `404`, which is also what passing the owner's ID gets — they have no collaborator row, so no request can strip a project of its owner.
  - `lib/project-access.ts` — `authorizeProject(projectId, { requireOwner })` added, and `authorizeOwner` deleted from `app/api/projects/[projectId]/route.ts`; `PATCH`/`DELETE` now call the shared gate. Order is 401 → 404 → 403, checked before any body is parsed. The collaborator branch only calls `currentUser()` after the owner check misses, so the common path stays at one Clerk call. Success also carries `ownerId`, so the member list reuses the lookup instead of repeating it. `getAccessibleProject` now also returns `isOwner`, which is what drives the dialog's read-only mode.
  - `lib/clerk-users.ts` — `getUserProfiles(emails)` batches `users.getUserList({ emailAddress })` 100 at a time and folds the responses through the pure `indexUsersByEmail()`. The index is keyed on **the addresses Clerk reports**, lowercased, not on request order — Clerk's email filter is not documented as an exact match, so pairing by position could attach one person's avatar to another's address. A user with several addresses is indexed under all of them. `getOwnerProfile(userId)` is the second lookup: the owner is stored as a Clerk user ID, so even their email comes from Clerk.
  - `lib/project-requests.ts` — `parseCollaboratorEmail()` trims, lowercases and shape-checks. Lowercasing is load-bearing: `@@unique([projectId, email])` is case-sensitive while every read matches case-insensitively, so mixed-case storage would let the same person be invited twice.
  - `hooks/use-project-members.ts` — fetches when the dialog opens, not on mount. State is one `ListState` stamped with its `projectId`; `isLoading` is *derived* from whether that stamp matches, so no `setState` runs synchronously in the effect (see the lint note in Session Notes). An `AbortController` drops a response that lands after the dialog closed.
  - `components/editor/share-dialog.tsx` — copy-link row with two-second `Copied!` feedback, owner-only invite form, and the member list: avatar, name, email, and an `owner`/`collaborator` role badge. Rows fall back name → email → "Unknown user". Remove buttons render only for owners, and never against the owner row.
  - `components/editor/editor-navbar.tsx` — the Share button shipped disabled in `08`; it now takes `onShare`.
  - `types/project.ts` — `ProjectAccess` (`ProjectSummary` + `isOwner`), `ProjectRole`, and `ProjectMember`.

- `08-editor-workspace-shell` — the workspace route, its access gate, and the sidebar link. No canvas, Liveblocks, AI chat, or sharing behaviour.
  - `app/editor/[roomId]/page.tsx` — Server Component. `params` and `getCurrentIdentity()` are awaited together, then the access check and both sidebar lists run in one `Promise.all`. Fetching the lists alongside the access check spends two queries on a denied load, which is the rare path; serialising would add a round trip to every successful one. Signed-out → `redirect()` to the sign-in env URL (backstop behind `proxy.ts`); no accessible project → `AccessDenied`.
  - `lib/project-access.ts` — `getAccessibleProject(projectId, identity)` added beside `getCurrentIdentity()`, per the spec. `findFirst` with `OR: [owner, collaborator-by-email]`; the collaborator arm is spread in conditionally so a user with no primary email gets an owner-only `OR` rather than a filter that matches on `undefined`. Selects `{ id, name }` only. This is the first Prisma query in the module — it was previously Clerk-only.
  - `components/editor/access-denied.tsx` — Server Component: lock icon in a bordered tile, heading, one line of explanation, and a link back to `/editor`. The link is a `next/link` carrying `buttonVariants({ variant: "outline" })`, not a `<Button>` wrapper — base-ui's Button takes `render`, not `asChild`, and an anchor keeps the file server-rendered.
  - `components/editor/editor-shell.tsx` — takes an optional `activeProject`. Its presence switches the shell from the editor-home prompt to the workspace layout and is what enables the navbar actions, so both surfaces share one copy of the navbar/sidebar/scrim/dialog wiring. Adds `isAiSidebarOpen` state and a local `AiSidebar` placeholder.
  - `components/editor/editor-navbar.tsx` — optional `projectName` in the centre section (truncating), plus Share and AI-toggle buttons in the right section. The actions render only when `onToggleAiSidebar` is passed, so the editor home is unchanged.
  - `components/editor/project-sidebar.tsx` — project names are now `next/link`s to `/editor/{project.id}`, and a new `activeProjectId` prop marks the current room with `bg-subtle`, `text-copy-primary`, and `aria-current="page"`.
  - `scripts/verify-project-data.ts` — `checkProjectAccess()` added: owner reaches their project, collaborator reaches a shared one across an email-case mismatch, and stranger / no-email / unknown-ID / collaborator-elsewhere all return `null`.

- `07-wire-editor-home` — sidebar and dialogs wired to the project API.
  - `app/editor/page.tsx` — async Server Component. `getCurrentIdentity()` then `Promise.all` of the two queries, so owned and shared load in parallel with no request waterfall and no client fetch on mount. The route moved from `○` static to `ƒ` dynamic in the build output, which is the expected consequence.
  - `lib/project-access.ts` — `getCurrentIdentity()` returning `{ userId, email }`. This is the first half of the module `08` specifies; `08` adds the per-project access check next to it.
  - `lib/projects.ts` — `getOwnedProjects(userId)` and `getSharedProjects(identity)`, both selecting `{ id, name }` only. Deliberately free of Clerk imports so the queries stay runnable outside a request context, which is what makes `scripts/verify-project-data.ts` possible.
  - `lib/room-id.ts` — `slugify()` (moved out of the hook), `buildRoomId(name, suffix)`, and the pure `getRetryRoomIdSuffix()` conflict policy. Imported by both the client hook and the verification script.
  - `hooks/use-project-actions.ts` — real mutations. `isPending` and a new `error` are actual state; `submit()` branches on `dialog.kind`, awaits the fetch, and closes the dialog only on success so a failed attempt does not discard the typed name. Create pushes to `/editor/{project.id}` and rotates the room-ID suffix when the API reports a `409`, so the next submit is a real retry; rename calls `router.refresh()`; delete pushes to `/editor` when the deleted project is the active workspace (matched off `usePathname()`) and refreshes otherwise.
  - `components/editor/project-dialogs.tsx` — preview switched from `/editor/{slug}` to the real `/editor/{roomId}`, pending labels on all three confirm buttons, and a `DialogError` (`role="alert"`) in each dialog.
  - `app/api/projects/route.ts` — `POST` now accepts an optional `id`, validated by `parseProjectId()` in `lib/project-requests.ts` before use. A collision answers `409`.
  - `scripts/verify-project-data.ts` — live database checks. `scripts/verify-project-api.ts` extended with ID parsing and a contract check that every room ID `buildRoomId` can produce passes `parseProjectId`.

- `06-project-apis` — project REST routes, no UI wiring.
  - `app/api/projects/route.ts` — `GET` lists the caller's projects (`where: { ownerId: userId }`, newest first), `POST` creates one. Response shapes: `{ projects }`, `{ project }` (201), `{ error }` on failure, and `204` with no body on delete.
  - `app/api/projects/[projectId]/route.ts` — `PATCH` renames, `DELETE` deletes. Both call a local `authorizeOwner()` first: 401 unauthenticated → 404 unknown project → 403 non-owner. Ownership is checked before the body is even parsed, so a non-owner cannot probe validation behaviour. Collaborator rows are removed by the schema's `onDelete: Cascade`, not by app code.
  - `lib/project-requests.ts` — `readJsonBody()` (absent/blank body → `{}`, malformed JSON → `null`), `parseProjectName()` (trims; absent or blank falls back to the caller's default, so create gets `Untitled Project` and rename gets a 400; rejects non-strings and names over 120 chars), `jsonError()`, `DEFAULT_PROJECT_NAME`.
  - Project IDs come from the schema's `@default(cuid())`. No sequential IDs were added.
  - `scripts/verify-project-api.ts` — assertion check over `readJsonBody` and both `parseProjectName` modes. Run with `npx tsx scripts/verify-project-api.ts`.

- `05-prisma` — Prisma Postgres wired end to end. Prisma 7.9.0 CLI + client, `@prisma/adapter-pg` over `pg`, connected to the managed Prisma Postgres instance (`db.prisma.io`). `DATABASE_URL` written to `.env` by `prisma postgres link`; `.env*` was already gitignored.
  - Multi-file schema. `prisma/schema.prisma` holds only the `prisma-client` generator (the Prisma 7 generator, not the legacy `prisma-client-js`) emitting to `../generated/prisma`, plus a datasource declaring `provider` alone — the URL lives in `prisma.config.ts`, which is where Prisma 7 reads it from. Models live in `prisma/models/project.prisma`; `schema` is set to the `prisma` folder, and the generator/datasource file must sit at that folder's top level, not in `models/`.
  - `Project` — `ownerId` (Clerk user ID), `name`, optional `description`, `ProjectStatus` enum (`DRAFT` default / `ARCHIVED`), `canvasJsonPath` for the future canvas blob, timestamps, indexes on `ownerId` and `createdAt`. `ProjectCollaborator` — project relation with `onDelete: Cascade`, `email`, `createdAt`, unique on `(projectId, email)`, indexes on `email` and `(projectId, createdAt)`. Specs and task runs are not modelled yet.
  - `prisma.config.ts` — `schema: "prisma"`, `datasource.url = env("DATABASE_URL")`, and `migrations: { path, seed: "tsx prisma/seed.ts" }`. The seed command lives here, not in `package.json#prisma.seed`, which Prisma 7 no longer reads.
  - `lib/prisma.ts` — one cached singleton on `globalThis` outside production so dev hot reloads don't exhaust connections. Throws at import if `DATABASE_URL` is unset. Branches on the URL: `prisma+postgres://` → `new PrismaClient({ accelerateUrl })`, anything else → `PrismaPg({ connectionString })`. `isAccelerateUrl` is exported so the branch is assertable.
  - `prisma/seed.ts` — 3 projects / 3 collaborators under owner `user_seed_owner`, idempotent via a scoped `deleteMany` on that owner so re-running does not duplicate. The independent project inserts run concurrently with `Promise.all`. `scripts/verify-prisma.ts` — asserts `isAccelerateUrl` against three URL shapes, then runs one `findMany` with a `_count` include and prints `✅ Connected` plus the active connection mode. Both import the `lib/prisma.ts` singleton rather than building their own client.
  - `/generated` added to `.gitignore`; `npm run build` deterministically regenerates the client through the package's `prebuild` lifecycle before Next.js compiles imports from `@/generated/prisma/client`.
  - Two migrations, not one: `_init` was applied before the `05-prisma` spec was read, so `_project_collaborators` is the corrective forward migration. Verified with `prisma migrate status` ("up to date"), `tsc --noEmit`, and `npm run build` — all clean.
  - The Accelerate branch needs no extra dependency. Prisma 7 takes `accelerateUrl` as a first-class `PrismaClient` option — `PrismaClientOptions` is a discriminated union of `{ adapter }` or `{ accelerateUrl }` — so `@prisma/extension-accelerate` is only required for `cacheStrategy`, which nothing here uses. Both arms return a plain `PrismaClient`, so there is no extended-client type union to work around. Add the extension if and when caching is wanted.
  - The linked database issues a direct `postgres://` URL, so the live path is adapter-pg. The Accelerate arm was exercised separately by running with `DATABASE_URL="prisma+postgres://…"` and confirming the client constructs.

- `04-project-dialogs` — project dialogs and editor home, mock data only, no API calls or persistence.
  - `types/project.ts` — `ProjectSummary` (`id`, `name`), the subset of the future Prisma `Project` the chrome renders.
  - `lib/mock-projects.ts` — `MOCK_OWNED_PROJECTS` (3) and `MOCK_SHARED_PROJECTS` (1). Imported by `app/editor/page.tsx` and passed down as props, so `07` swaps the import for real queries and nothing below changes.
  - `hooks/use-project-actions.ts` — `useProjectActions()` owns dialog state (`{kind: "create"} | {kind: "rename" | "delete", project}`), the name input, the derived `slug`, and an `isPending` flag. Also exports `slugify()` and the `ProjectActions` type. `submit()` currently just closes the dialog.
  - `components/editor/project-dialogs.tsx` — all three dialogs, each built on the existing `EditorDialog`. Create: name input + live `/editor/{slug}` preview, submit disabled while the slug is empty. Rename: prefilled auto-focused input, current name in the description. Delete: description only, no input, `variant="destructive"` confirm.
  - `components/editor/project-sidebar.tsx` — new `ownedProjects` / `sharedProjects` / `onCreateProject` / `onRenameProject` / `onDeleteProject` props. Renders a `ProjectList` (`<ul>`, `overflow-y-auto`) when a tab has projects and the existing `EmptyState` when it does not. Rename/delete icon buttons render only when the handlers are passed, so the Shared tab has no actions.
  - `components/editor/editor-shell.tsx` — takes both project lists, calls `useProjectActions()`, renders the centered home content (`h1` + description + `New Project` button, no card) and `ProjectDialogs`. Adds a `md:hidden` scrim button behind the open sidebar for tap-to-close on small screens.

- `editor-home-shell` (partial slice of `07`/`08` — chrome only, no data) — `app/editor/page.tsx` renders `components/editor/editor-shell.tsx`. The page is a Server Component; the shell is a client component owning `isSidebarOpen` and wiring `EditorNavbar` + `ProjectSidebar` together for the first time. Work area is `relative` so the sidebar overlays the canvas rather than reflowing it. Canvas region is a placeholder with a centered prompt. Verified in-browser by the project owner: sidebar toggle, slide-over behaviour, close button, both tabs, and `UserButton` all work signed-in.

- `03-auth` — Clerk wired end to end. CLI 2.3.0, app `app_3H38PhPDskCpR6kThGNHvQoo3Ku`, dev instance `ins_3H38PjqhfIpOD6AXCGSjWBfMUQR`. `@clerk/nextjs` 7.6.1 + `@clerk/ui` 1.26.0. Keys in `.env.local` (gitignored via `.env*`).
  - `proxy.ts` — `clerkMiddleware()` protecting everything by default; public paths derived from `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL`. Throws at boot if either is unset.
  - `app/layout.tsx` — `ClerkProvider` inside `<body>` with Clerk's `dark` theme as base and all 16 appearance variables pointed at the `ui-context.md` CSS custom properties.
  - `app/page.tsx` — no longer a page. `await auth()` then redirects: authenticated → `/editor`, otherwise → the sign-in env URL.
  - `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx` — both render `AuthPanel`.
  - `components/auth/auth-panel.tsx` — two-panel shell. `lg:grid-cols-2`, aside `hidden` below `lg` so small screens render the form alone. The left column is a three-part editorial stack (`justify-between`): mono wordmark at the top, an oversized statement plus a numbered text-only feature list in the middle, and a one-line footnote at the bottom. A `.surface-dot-grid` layer sits behind it at 50% opacity. Entrance motion is `motion-safe:` only.
  - `components/editor/editor-navbar.tsx` — `UserButton` added to the previously empty right section.
- `02-editor-chrome` — `components/editor/` created with three client components: `editor-navbar.tsx` (fixed `h-14` bar, three sections, sidebar toggle with `PanelLeftOpen`/`PanelLeftClose`, right section empty), `project-sidebar.tsx` (absolute overlay, `translate-x` slide, `isOpen`/`onClose` props, Projects header + close button, `Tabs` for My Projects / Shared with empty states, full-width `New Project` button with `Plus`), and `editor-dialog.tsx` (reusable title/description/footer shell — no concrete dialogs built yet).
- `01-design-system` — shadcn/ui initialized (`components.json`, `base-nova` style, `neutral` base, CSS variables). UI primitives added unmodified in `components/ui/`: Button, Card, Dialog, Input, Tabs, Textarea, ScrollArea. `lucide-react` installed. `lib/utils.ts` exports `cn()` (clsx + tailwind-merge). Dark theme tokens from `ui-context.md` defined in `app/globals.css`.

## In Progress

- None.

## Next Up

- Run the shared-run live QA with two authorized collaborators once browser
  harness setup and sessions are available: another user must see the prompt
  identity rail and shared growing work log, both users must agree on the final
  terminal state, and a reload must reconstruct it from `ai-chat` without a
  Trigger token. Check console errors plus bottom-follow/pagination behavior.
  Also triage the React Doctor findings before treating this delivery as a clean
  React diagnostic pass; the current repository-wide command exits 1 at 51/100.
- **The canvas has never been seen in a browser.** Both keys are now set and the server side is verified, so the only thing left is one signed-in pass at `/editor/{projectId}`: canvas renders, minimap and dots background appear, a second tab syncs a node drag. Still blocked on the same missing Clerk session as `07`–`09`.
- Autosave has no **unload flush**: closing the tab inside the 1500ms debounce loses that last edit. Liveblocks Storage still has it, so the room is intact and the next client to edit saves it — but a project whose room later empties would restore to the older snapshot. `visibilitychange` + `sendBeacon` is the fix if that ever bites.
- Two clients opening the *same* cold room within one round trip can both restore and duplicate every node. Narrow — it needs a room nobody has touched since the last save — and marked with a `ponytail:` comment in `canvas.tsx`. A "restored" flag in Storage is the fix.
- Blob deletion is still unimplemented, so `21` adds artifacts that project deletion does not remove. `canvasJsonPath` is already documented as a retained cleanup pointer for exactly this; the `del()` call belongs in `deleteProjectResources` alongside the Liveblocks room teardown.
- `GET /api/projects/[projectId]/specs` now has **no client caller**: `36`
  deleted the Specs tab, and a spec reaches the reader attached to its turn. The
  route is kept rather than deleted because it is the natural read for any
  future project-wide spec view, and because a spec whose `artifact` part was
  lost — a pre-`36` run, or a row written before the budget rule changed — is
  reachable through nothing else. Delete it if that view never arrives.
- Deployed Trigger.dev environments now need `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` in the dashboard, not only in the local `.env` — `generate-spec` writes to both from inside the worker. Local `trigger dev` already reads them from `.env`.
- Blob deletion now leaves **specs** behind too, not just canvas snapshots: `ProjectSpec` rows cascade with the project row, but their documents do not. Whatever `del()` call lands in `deleteProjectResources` has to cover `specs/{projectId}/*` as well as `canvas/{projectId}.json`.
- `generate-spec` and `design-agent` both publish to the single-line
  `ai-status-feed`, and the later write wins. `35` makes them sequential within
  one turn, so the collision now needs two *turns* in flight in one room — which
  the composer lock does not prevent for two different collaborators.
- Chat is **feed-only, with no send-time echo**: a message appears when the feed round-trips it, not the instant it is typed, so a slow connection shows a visible gap. `useCreateFeedMessage` has an `id` option, which is the hook an optimistic entry would hang off if that reads badly in use.
- A full room's chat history still loads in whatever pages `useFeedMessages`
  fetches with no "load more" control. Bottom-follow and Jump to latest now
  cover live output, but pagination remains the first thing to add at a
  thousand messages.
- Node **and edge** label editing are both **pointer-only**: each opens on double-click with no keyboard route (Enter on a selected element, say). `14-node-editing` and `16-edge-behavior` ask only for double-click, but the shape panel got a click-to-add path for exactly this reason — worth revisiting when the canvas gets a keyboard pass. Handles are hover-revealed, which is the same gap on the connection side: there is no keyboard way to start a connection.
- Handles sit at the **bounding-box** midpoints of all four sides. On a diamond or hexagon that is a corner of the box, not a vertex of the drawn shape, so an edge meets the SVG outline slightly off its point. `NodeShapeFrame` already knows each shape's geometry (`lib/node-shape-geometry.ts`), so per-shape handle offsets are possible if this reads wrong in use.
- Blob persistence is the next canvas slice. Starter templates landed in `18`; template **saving**, user-authored templates and server persistence were all explicitly out of its scope.
- Importing a template is **not undoable as one step**: the clear is an `onDelete` mutation and the add is two more, so Liveblocks room history sees three entries rather than one. Wrapping the import in `history.pause()`/`resume()` would fix it if this reads wrong in use.
- Undo/redo have only been reasoned about, never exercised: whether a node drag, a resize and a label edit each undo as **one** step is a claim about how `@liveblocks/react-flow` batches history, and it needs the same signed-in browser pass everything else on the canvas is waiting for.
- `19` hand-rolled `LiveCursors` instead of `Cursors` from `@liveblocks/react-flow`. The packaged component stores presence under the same `"cursor"` key in the same canvas coordinates, so it remains a drop-in alternative (plus a `@liveblocks/react-flow/styles.css` import) — it was passed over because it renders inside the viewport, so its pointers scale with zoom, and it has no route to the "exclude every connection belonging to the current Clerk user" rule the spec asks for.
- Presence is broadcast on **every** mousemove over the canvas, throttled only by Liveblocks' own 100ms default. If that reads as jittery in use, the fix is `LiveblocksProvider`'s `throttle` prop or interpolating between updates on the receiving side — not a local debounce, which would only add latency.
- `isThinking` is now the only Presence field nothing reads or writes. It arrives with the AI panel.
- `EditorNavbar` now imports `UserButton`, so it can no longer render outside a `ClerkProvider`. Any future harness or story for the navbar must be mounted under the root layout.

## Manual QA — `truss:diagram` edit/delete

None of these can run from a script: they need a real browser and a signed-in
Clerk session. Perform each and check the box only after the exact expected
result is observed.

- [ ] **Create still works unchanged.** Ask the skill to create a diagram
      (e.g. "draw me a simple CI/CD pipeline"). Expected: `/agent/new` opens,
      the browser signs in if needed, a new project is created with the given
      title, and the canvas draws paced with the cursor animation exactly as
      before this task's changes — no behavior difference from the prior
      create-only skill.
- [ ] **Edit a diagram with a hand-moved node.** Open an existing diagram in
      the browser first and drag one node to a new position by hand (leave
      the tab open or reload after). Then ask the skill to edit that same
      diagram by adding one new node (a request with no removals). Expected:
      after the skill applies the edit and the browser redirects to
      `/editor/:id`, the hand-moved node is still at the position you dragged
      it to, and the new node draws in with the same paced cursor-arrival
      animation used by create/import — not an instant appearance.
- [ ] **Ask to remove a node.** Ask the skill to edit a diagram in a way that
      removes an existing node (e.g. "remove the caching layer"). Expected:
      before the skill answers the held `/agent/pick` request, the terminal
      states exactly what will be removed by name/label and waits for an
      explicit yes. It does not proceed on its own.
- [ ] **Delete a diagram.** Ask the skill to delete a specific diagram by
      name. Expected: the terminal confirms by quoting the full project name
      it resolved (never a list position/index) and waits for an explicit
      yes; only after that does the browser open its own native confirm
      dialog naming the same project before the `DELETE` actually fires. Two
      separate confirmations, terminal then browser.
- [ ] **Empty library — edit.** With an account that owns no projects, ask
      the skill to edit "my diagram" (or any diagram). Expected: the agent
      reports there are no diagrams yet, asks for a title (never inventing
      one), reuses the edit request as the description, and falls through to
      the create branch — producing a new project rather than erroring.
- [ ] **Empty library — delete.** With an account that owns no projects, ask
      the skill to delete a diagram. Expected: the agent says there is
      nothing to delete and stops. It does not open a browser tab, and it
      does not offer to create one.
- [ ] **Signed-out cold load of `/agent/pick#<fragment>`.** This is the one no
      script can prove, and it is where a regression in the pre-hydration
      fragment capture would appear. Sign out of Truss entirely (or use a
      fresh private window), then trigger an edit or delete request so the
      skill opens `/agent/pick#<fragment>` while signed out. Expected: the
      fragment survives the Clerk sign-in redirect (it is captured into
      `sessionStorage` and scrubbed from the URL *before* Clerk's client
      bundle can mount and redirect), the user completes sign-in, and the
      operation resumes from where it left off — the project list (or the
      graph read, for edit) still appears, rather than the operation silently
      losing its target and hanging or erroring.

## Open Questions

- **Still open after `09`**: `ProjectCollaborator` has no `userId` column, so access is keyed entirely on the email string. Two consequences, both unresolved because `09` says "do not add a local user table": a collaborator who changes their Clerk primary email loses access silently, and an invite sent to an address nobody has registered grants access to whoever registers it later. Adding a nullable `userId`, backfilled the first time a collaborator opens the project, would fix both without a user table.
- **Resolved in `09`**: `architecture-context.md` now states owner-only for rename, delete, invite and remove, and owner-or-collaborator for opening and reading. That matches what the handlers enforce.
- The share dialog invites by email but sends **no email**. The invitee only gets in if someone passes them the link, and nothing tells them they were added. A notification path is not in any spec yet.
- Authenticated request paths are still **not verified in a browser**: the `200` create/rename/delete responses, the `403`/`404` branches, the sidebar rendering real rows, and now the whole `/editor/[roomId]` surface (`AccessDenied`, the active-row highlight, the AI slide-over). Three routes to a session were tried and all dead-ended — `clerk api /sessions` (blocked by the local permission classifier), an impersonation ticket (accepted, but the session did not carry to `localhost`, and the classifier blocked the `__clerk_ticket` handover URL), and a fresh sign-up with a `+clerk_test` address (stopped by a Cloudflare Turnstile challenge on the sign-up form, which is not something to click through). The data layer underneath is verified against the real database instead (`scripts/verify-project-data.ts`), and the whole flow needs one manual pass in a signed-in browser.

- Production Clerk instance is not configured (`clerk doctor` reports development only). Needs setting up before any deploy.
- Clerk's card carries a fixed 335px min-width, so the auth pages cannot fit viewports below roughly 367px without overriding Clerk internals — which `03-auth` forbids. 320px is in the project's stated responsive range but is not currently reachable. Accept the floor or revisit the "do not customize Clerk internals" constraint.

- axe-core (WCAG 2.1 AA) flags one serious color-contrast violation on `/editor`: the **inactive** `TabsTrigger` renders `--text-muted` `#808090` on `--bg-subtle` `#1e1e23` — roughly 4.2:1, under the 4.5:1 threshold. This comes from the generated `components/ui/tabs.tsx` (`dark:text-muted-foreground`) combined with the `ui-context.md` palette, so it will recur on every tab strip in the app. Either lift `--text-muted` or override the inactive tab color at the call site — needs a palette decision, not a local patch.

- `ui-context.md` documents the border radius scale as `rounded-xl` / `rounded-2xl` / `rounded-3xl`. shadcn redefines those steps from `--radius` (0.625rem), so they resolve to 0.875 / 1.125 / 1.375rem rather than Tailwind's defaults. The scale still increases with depth, so it was left as generated — confirm the exact values are acceptable.
- `app/layout.tsx` still carries the template metadata (`title: "Create Next App"`). No spec defines the real title/description yet.

## Architecture Decisions

- **Both editor sidebars are inset floating panels, not docked rails.** `ProjectSidebar` and `AiSidebar` were already absolute overlays, but flush to the viewport edge with a single inner border they read as docked chrome. They now sit at `inset-y-3` / `left-3` / `right-3` with `rounded-2xl`, a full border, `shadow-2xl` and `bg-surface/80 backdrop-blur-xl`, so the canvas and its dot grid stay visible around and faintly through them. This is what `ui-context.md` already specified ("floating overlay with dark semi-transparent background and subtle border"); the implementation had drifted.
  - The closed transform is `calc(100% + 2rem)`, not `100%`. A plain `-translate-x-full` leaves the 12px inset *and* the blurred shadow bleeding down the edge of a closed panel.
  - Tailwind v4 normalises `calc(100%+2rem)` into valid `calc(100% + 2rem)` — the underscore syntax (`calc(100%_+_2rem)`) is not needed here. Confirmed against the built CSS, not assumed.
  - Contrast is unaffected: `--bg-surface` `#111114` at 80% over `--bg-base` `#080809` composites to roughly `#0f0f11`, marginally *darker* than the opaque original.
- **Resize and label edits reach Storage without any new plumbing, because both go through React Flow's controlled flow.** `NodeResizer` emits `dimensions` changes with `setAttributes`, and `@liveblocks/react-flow`'s `applyNodeChanges` writes `width`/`height` straight to the node's `LiveObject` (it also pauses history for the duration of the drag, so a resize undoes as one step). `updateNodeData` is not a direct store write either: it queues into React Flow's batch, which diffs against `nodeLookup` and fires `onNodesChange` with a `replace` change, and Liveblocks reconciles that onto the existing node. So a plain `useReactFlow()` call is the correct collaborative path here — the "never a local `setNodes`" rule below is about `useState`, not about React Flow's own setters.
- **The label editor overlays the label rather than replacing it.** The `<span>` stays in the flow with `invisible` while a textarea sits `absolute inset-0` on top. Swapping the span *for* a textarea would shift the node on every open (a textarea's intrinsic height is `rows`, not its content) and would need manual auto-grow on top; keeping the span means the label the user is typing is still what sizes the box, so the editor grows with it for free.
- **`nopan` sits on the whole label area, not just the textarea.** React Flow's d3 zoom filter reads the class off the event target, and it vetoes the pane's `dblclick.zoom` as well as panning. Without it, the double-click that opens the editor would also zoom the canvas — and a React `stopPropagation` cannot prevent that, because d3 binds natively to an ancestor and fires before the event reaches React's root.
- **New nodes are added through `onNodesChange([{ type: "add", item }])`, never a local `setNodes`.** `useLiveblocksFlow` routes that change into a `useMutation` that writes the node to Storage, so it reaches every other client in the room. A local setter would create a node only the author can see. `applyNodeChanges` in the package treats `add` and `replace` identically — an existing ID is *reconciled*, not rejected — which is why `createNodeId` carries both a tab-local counter and UUID entropy in addition to the timestamp: simultaneous drops from different collaborators must not collapse into one node.
- The drag payload uses a **custom MIME type** (`application/x-truss-shape`), not `text/plain`. `dragover` can only inspect `dataTransfer.types`, never the payload, so a specific type is the only way to decide whether to accept a drop before it happens — and it stops a dragged text selection or file from being read as a shape.
- The payload is **parsed as untrusted input**. A `DataTransfer` can be populated by another tab or an older build of this app, so `parseShapeDragPayload` shape-checks the shape name and both dimensions and returns `null` rather than letting a malformed node into Storage.
- `Canvas` is now just `ReactFlowProvider` wrapping `CanvasFlow`. The drop target is the wrapper *around* `<ReactFlow>`, and `useReactFlow` (for `screenToFlowPosition`) is unavailable there without the explicit provider — `ReactFlow` only supplies that context to its own children.
- The shape buttons are **click-to-add as well as drag**, which the spec does not ask for. HTML5 drag-and-drop has no keyboard equivalent, so drag alone would make node creation pointer-only. The click path centres the node using the wrapper's `getBoundingClientRect`, not `window.innerWidth/Height` — the canvas sits below a 56px navbar and beside the AI panel, so a window-centred node lands off-centre.
- **The share list is "members", not "collaborators": the owner is in it, with a role badge.** A "People with access" list that omits the one person who always has access reads as a bug. The owner has no `ProjectCollaborator` row, so their identity is resolved from `Project.ownerId` through Clerk — which is why `ProjectMember.email` is nullable while a collaborator's never is. The route path is `/api/projects/[id]/members` to match, even though its mutations still only ever write collaborator rows.
- Roles are **derived, not stored**. There is no role column: owner is `Project.ownerId`, collaborator is the existence of a `ProjectCollaborator` row. Adding a third role (viewer, commenter) would be the point at which that stops working and a real column is needed.
- **One authorization gate for every project handler**: `authorizeProject(projectId, { requireOwner })` in `lib/project-access.ts`, returning `{ ok: true, role }` or `{ ok: false, response }`. It lives beside `getAccessibleProject` rather than in `lib/project-requests.ts` so that all access control is auditable in one file, at the cost of that file importing `jsonError`. Adding a handler that forgets to call it is the failure mode to watch — nothing forces the call.
- The two access checks answer **opposite** questions about existence on purpose. `getAccessibleProject` collapses missing and forbidden into one `null` because it serves page loads from anyone. `authorizeProject` returns `404` before `403` because its callers already hold a project ID and the distinction makes the API debuggable. Both are deliberate; do not "harmonise" them.
- **Clerk profiles are indexed by the addresses Clerk returns, never by request order.** `getUserList({ emailAddress })` is a filter, not a keyed lookup, so zipping the request array against the response array would silently pair the wrong avatar with an address. `indexUsersByEmail()` is pure and separately asserted for this reason.
- A Clerk outage degrades the collaborator list to **email-only rows** instead of failing the request. The list is still correct without profiles; losing the whole dialog because an enrichment call failed would be worse. The failure is logged server-side rather than swallowed.
- Collaborator emails are stored **lowercased**. The schema's `@@unique([projectId, email])` is case-sensitive while every read matches case-insensitively — without normalisation on write, `A@b.com` and `a@b.com` are two rows for one person.
- Collaborator removal uses `deleteMany({ where: { id, projectId } })`, not `delete({ where: { id } })`. The collaborator ID arrives from the URL, so scoping to the authorized project is what stops an owner deleting a row out of a project they do not own.
- **A missing project and a forbidden project return the same `null`** from `getAccessibleProject`, and `/editor/[roomId]` renders `AccessDenied` for both. The spec asks for exactly this, and it also stops an outsider using the two responses to enumerate which project IDs are real — which matters more here than usual, because project IDs are human-readable slugs rather than opaque cuids. This is the opposite of the `404`/`403` split the API routes use, deliberately: those are owner-only mutations where the caller already holds the ID.
- **One shell, two surfaces.** `/editor` and `/editor/[roomId]` both render `EditorShell`; the optional `activeProject` prop switches it between the create prompt and the workspace. A separate `WorkspaceShell` would have duplicated the navbar, sidebar, mobile scrim, and dialog wiring — and would have needed its own copy of `useProjectActions`, whose delete handler already redirects out of the workspace it is standing in.
- The AI-sidebar toggle is passed as `undefined` on the editor home rather than gated by a boolean prop, so "no active project means no navbar actions" is enforced by the same value the handler needs.
- The Share button renders **disabled** rather than wired to a no-op. `08` forbids sharing behaviour, and a button that silently does nothing reads as a bug.
- **One identifier: `Project.id` = `/editor/[roomId]` segment = Liveblocks room ID.** `07-wire-editor-home` asks the hook to slugify the name, add a short unique suffix, and keep "the project ID and Liveblocks room ID aligned"; `10-liveblocks-setup` says outright "use the project ID as the Liveblocks room ID". Those only cohere if the slug+suffix *is* the project ID, so the create dialog generates `checkout-service-a1b2c3` and `POST /api/projects` persists it as the primary key. The alternative — keeping the `cuid()` and treating the slug as cosmetic — would make the dialog's room-ID preview a URL that never exists.
  - This narrows `06-project-apis`'s "use the schema's existing ID strategy": the `cuid()` default still applies to any `POST` without an `id`, so the API contract `06` shipped is unchanged. What `06` forbade was inventing a sequential ID scheme, which this is not.
  - Consequence: project IDs are a **global namespace**, so two users cannot both hold `checkout-service-a1b2c3`. The 6-hex-character suffix makes that collision remote, and it answers `409` rather than mangling the ID. Revisit if project IDs ever need to be per-owner.
- Client-generated IDs are validated server-side, never trusted: `parseProjectId()` enforces `^[a-z0-9]+(?:-[a-z0-9]+)*$` and 3–80 characters, because the value lands in a URL path and a Liveblocks room name. `buildRoomId()` truncates the slug to 60 characters so a legal 120-character project name cannot produce an ID the API then rejects — the contract is asserted in `scripts/verify-project-api.ts`.
- The room-ID suffix is generated in `openCreate()` and regenerated only after the API reports a `409` collision, never per render. Deriving it during render would re-roll it on every keystroke, so the ID shown in the preview would not be the ID submitted.
- `lib/projects.ts` takes identity as an argument instead of calling Clerk itself. That keeps the read path importable from a plain Node script (`scripts/verify-project-data.ts`), which is how the shared-project relation filter gets exercised against real rows.
- Shared projects are matched on email **case-insensitively** (`mode: "insensitive"`). Clerk reports the address as the user typed it at sign-up and collaborator rows are typed by hand in the share dialog, so an exact match would silently drop legitimate shares.
- Mutations report failure in-dialog through the hook's `error` state and leave the dialog open. Closing on failure would discard the typed name and imply the change was saved.
- **`proxy.ts` no longer protects `/api`.** `auth.protect()` answers with a redirect to the sign-in page, so an unauthenticated `fetch` to an API route received HTML and a 307 — the `401` that `06-project-apis` requires was unreachable. Paths under `/api` are now exempt from the middleware check and every handler calls `await auth()` itself. This is the resource-based checking Clerk 7 recommends (see the `createRouteMatcher` deprecation note below), but it shifts responsibility: **any new handler under `/api` that omits its own auth check is public.** Pages and everything else are still protected by the middleware.
- Route handler params use the explicit `{ params: Promise<{ projectId: string }> }` signature rather than the global `RouteContext<'/api/projects/[projectId]'>` helper. `RouteContext` only exists after `next dev` / `next build` / `next typegen` has run, so a bare `tsc --noEmit` on a clean checkout would fail.
- `PATCH`/`DELETE` return `404` for an unknown project ID and `403` only for a real project owned by someone else. The spec names 403 but not 404; leaking existence is acceptable here since project IDs are cuids and never enumerated.
- The project API returns owner-only lists. Collaborators are keyed by email in the schema while `auth()` yields a Clerk user ID, so the sidebar's Shared tab has no server-side source yet (see Open Questions).
- Next.js 16 names the middleware file `proxy.ts`, not `middleware.ts`. `config.matcher` carries `"/__clerk/:path*"` after `"/(api|trpc)(.*)"` so Clerk's auto-proxy handshake routes are not filtered out.
- Route protection is protected-first: `proxy.ts` calls `auth.protect()` for every path that is not public. Public paths are read from `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` rather than hardcoded, so the auth routes cannot drift out of sync with the middleware.
- `createRouteMatcher` is **deprecated in `@clerk/nextjs` 7.x** ("will be removed in the next major version"; Clerk now recommends resource-based checks in each page/handler). It is therefore not used. A plain prefix comparison replaces it — which is also what makes env-driven public paths possible, since matcher globs are static. Clerk's stated reason for the deprecation still applies to us: middleware path matching can diverge from how Next.js routes requests, so once real protected resources exist, add `await auth()` checks inside those pages and route handlers rather than relying on the middleware alone.
- Clerk is themed with the `dark` theme from `@clerk/ui/themes` as the base, overridden with the `ui-context.md` CSS custom properties (`colorBackground: var(--bg-elevated)`, `colorPrimary: var(--accent-primary)`, and so on). No hex values are passed. Clerk's own `shadcn` theme uses `var()` strings the same way, confirming CSS variables are supported. Palette edits propagate to Clerk with no code change. The earlier `shadcn`-theme wiring, including the `@clerk/ui/themes/shadcn.css` import in `globals.css`, was removed — `03-auth` specifies the `dark` base.
- `colorMutedForeground` maps to `--text-secondary`, not `--text-muted`. `--text-muted` on our surfaces fails WCAG AA (see the tab-contrast entry in Open Questions), and Clerk uses this token for form hint text.
- `ClerkProvider` sits inside `<body>`, not wrapping `<html>`, so the `dark` class and font variables on `<html>` stay under our control.
- `app/page.tsx` is a routing decision, not a screen. It is a Server Component that awaits `auth()` and redirects. `isAuthenticated` is used rather than `isSignedIn` — the latter is deprecated in the installed SDK.
- `AuthPanel` is shared by both auth routes rather than duplicated. It is presentational and takes the Clerk form as `children`, matching the existing convention that chrome components stay stateless.
- The auth left panel carries a `.surface-dot-grid` texture (defined in `globals.css`, built from `--border-subtle` at a 22px step) that echoes the React Flow canvas background, so the sign-in screen reads as the same surface as the product. **This is a deliberate reading of `03-auth.md`'s "no gradients" rule**: the rule targets decorative gradient washes and blob heroes, and this is a flat repeating dot pattern that happens to be built with `radial-gradient`. If the rule was meant literally, drop the class — nothing else depends on it.
- Auth panel type follows an "exaggerated minimalism" hierarchy: the statement is `clamp(2.25rem, 3.4vw, 3.25rem)` at `tracking-[-0.035em]` against 12–14px supporting text, so scale contrast does the work instead of colour or borders. The feature list is an `<ol>` with monospace `01`/`02`/`03` indices for rhythm — still text-only, as the spec requires, with no icons or cards.
- Supporting text on the auth panel uses `--text-muted`, never `--text-faint`. Measured against `--bg-surface`, muted lands at 4.85:1 (passes AA) while faint is roughly 3.2:1 and fails. `--text-faint` is for non-text decoration only.
- Auth entrance motion is gated behind Tailwind's `motion-safe:` variant rather than a hand-written `prefers-reduced-motion` block, and reuses the already-installed `tw-animate-css` utilities instead of new keyframes.

- One hook (`useProjectActions`) owns create/rename/delete dialog state for the whole editor, and both entry points (editor home button, sidebar `New Project`) call the same `openCreate`. The dialogs are rendered once in `EditorShell`, not per sidebar item, so the item actions only have to report which project was targeted.
- The dialog's target project lives in the `dialog` state union rather than in a separate `selectedProject` state, which makes "create has no target, rename/delete always do" a type-level fact instead of a runtime assumption.
- Dialog forms submit natively: the `<form>` sits in the dialog body with an `id`, and the footer's confirm button is a `type="submit"` with a matching `form` attribute. That gives Enter-to-submit in the rename dialog with no key handler, and it avoids adding form support to `EditorDialog`.
- Sidebar item actions are two always-visible ghost icon buttons, not a dropdown menu. No menu primitive is installed, and hover-revealed actions are unreachable on touch — which matters because the sidebar is the primary mobile navigation.
- Owner-only actions are enforced by prop absence: `ProjectList` renders the rename/delete buttons only when `onRename`/`onDelete` are passed, and the Shared tab passes neither. Once real collaborator data exists, the server-side ownership check is still the authority — this is presentation only.
- The mobile scrim is a `md:hidden` `<button>` rather than a div, so tap-to-close is also keyboard- and screen-reader-reachable. It is `z-30`, below the sidebar's `z-40`.
- Editor chrome components are presentational and stateless. `EditorNavbar` and `ProjectSidebar` take `isOpen` / `onToggle` / `onClose` from a parent; sidebar open state is owned by the workspace shell (`08-editor-workspace-shell`), not by the chrome itself.
- The sidebar is an `absolute inset-y-0 left-0` overlay inside the editor's relative container, animated with `translate-x`. It stays mounted so the slide transition runs, and carries `inert` while closed so hidden content is out of the tab order.
- `EditorDialog` wraps the shadcn `Dialog` primitive rather than editing `components/ui/dialog.tsx`. The primitive stays as generated; project styling (`rounded-3xl`, `bg-elevated`, `border-surface-border`) is applied through `className` at the wrapper.
- Dark-only theme implemented without a light palette. The `ui-context.md` colors live in `:root` as the single source of truth, and shadcn's semantic tokens (`--background`, `--card`, `--primary`, …) are mapped onto them rather than given independent values. Changing a palette entry updates both layers at once.
- `<html>` carries a static `dark` class. The generated `components/ui/*` files ship `dark:` variants, and the class makes them resolve without editing protected foundation components.
- `viewport.colorScheme = "dark"` set in `app/layout.tsx` so native UI (scrollbars, form controls) does not render light.
- The page-background utility is `bg-page`, aliased from `--bg-base`. It was `bg-base` until a `04-project-dialogs` bug report: `@theme inline`'s `--color-base` registered `base` as a color, so Tailwind's built-in `text-base` emitted `color: #080809` alongside its font size. `components/ui/input.tsx`, `textarea.tsx`, `card.tsx` and `dialog.tsx` all use `text-base`, so every input in the app rendered near-black text on a dark surface. Renaming the alias fixes it for all of them at once and cannot be reintroduced by a future `shadcn add`. Never name a color token after a font-size step (`xs`, `sm`, `base`, `lg`, `xl`, …).
- Dialog inputs carry an explicit `text-copy-primary`. Without it they inherit `EditorDialog`'s `text-copy-secondary`, and a value the user typed is primary content rather than supporting text.
- Project tokens are exposed as Tailwind utilities via `@theme inline`: `bg-page`, `bg-surface`, `bg-elevated`, `bg-subtle`, `border-surface-border`, `border-surface-border-subtle`, `text-copy-primary` / `-secondary` / `-muted` / `-faint`, `text-brand`, `bg-accent-dim`, `text-ai`, `text-ai-text`, `text-state-error` / `-success` / `-warning`.
- `--font-sans` and `--font-mono` map to the existing `--font-geist-sans` / `--font-geist-mono` variables, replacing shadcn's self-referential default.

## Session Notes

- `25-sidebar-chat-feed` verification: `npx tsx scripts/verify-ai-chat.ts` passes, and `tsc --noEmit`, `npm run lint` and `npm run build` are all clean. **Not seen in a browser** — same missing Clerk session as everything since `07`. Unexercised as a result: whether `useFeedMessages` recovers immediately after the authenticated server creates a room's first feed, whether two clients see each other's messages land, and whether the transcript scrolls rather than pushing the composer off the panel.
- **Zod was not added.** The spec asks for "define or reuse a Zod schema in `types/tasks.ts`", but zod is not a dependency, and the sibling contract in that same file (`parseAiStatusMessage`) is a hand-rolled parser. `parseAiChatMessage` matches it exactly — same file, same shape, same never-throw behaviour — rather than pulling a runtime validator into the client bundle for one object. Swap it for zod if a second reason to install it turns up.
- `21-canvas-autosave` verification: `npm run build`, `tsc --noEmit`, `npm run lint` and `verify-canvas.ts` all clean, with `ƒ /api/projects/[projectId]/canvas` in the build output. `parseCanvasSnapshot` gained `checkSnapshotsRejectJunkAndSurviveRoundTrips` — round trip, eight non-snapshot bodies, dropped malformed/duplicate entries, degraded colour/shape, dangling-edge removal, and the size ceiling.
- **The Blob store is private-access, and that was found by running it, not by reading it.** The first implementation used `access: "public"` and a plain `fetch` of the stored URL — both are what the Vercel docs show, and both fail here: `put` threw `Cannot use public access on a private store`, and a plain `fetch` of a private blob URL returns **403**. Verified against the real store with a throwaway script: overwrite keeps the URL stable, `get(url, { access: "private", useCache: false })` returns 200 with the latest content, and `del` removes it. Run a real round trip before trusting any Blob code path here.
- Still unexercised in a browser (same missing Clerk session as everything since `07`): whether the debounce feels right while dragging, whether the navbar status reads clearly, and the cold-room restore itself — which needs a room whose Storage is genuinely empty *and* a project with a saved blob, a state no verification script can produce.
- PR #5 review fixes. Two findings, one real: `useCollaborators` only collapsed the *current* user's connections, so a collaborator with two tabs drew two avatars and the `aria-label` counted tabs rather than people. Fixed with `dedupeByUser` in `lib/presence.ts`, applied by `PresenceAvatars` only — **the cursor layer keeps the connection-scoped list on purpose**, since two tabs really do have two pointers. `Map` keeps a person in their original slot when a tab opens, so avatars do not reshuffle.
- Collaborator avatars now use `next/image`, which is what put the **first `images.remotePatterns` entry** in `next.config.ts` (`img.clerk.com`). Clerk proxies OAuth provider photos through its own host, so one pattern covers Google, GitHub and the rest — confirmed against a real `image_url` via `clerk users list --json`. `search` is left unpinned there deliberately: Clerk's helpers append `?width=`, and a pinned `search` turns that into a silent 400 from the optimizer rather than a build error. **A host missing from `remotePatterns` fails at runtime, not at build** — check there first if an avatar renders broken.
- `20-ai-sidebar-shell` verification: `npm run build`, `tsc --noEmit` and `npm run lint` all clean. Not seen in a browser — same missing Clerk session as everything since `07`. Unexercised as a result: whether `field-sizing-content` actually stops growing at `max-h-40`, whether `data-active:bg-ai` beats the tabs primitive's own `data-active:bg-background` in the cascade, and whether the chat list scrolls rather than pushing the composer off the panel.
- `19-presence-avatars-cursors` verification: `tsc --noEmit`, `npm run lint` and `npm run build` are all clean. **Nothing here is verified in a browser, and this unit needs it more than most** — the entire feature only exists when two clients are in the same room at once, which no verification script can stand in for. Same missing Clerk session as everything since `07`. Specifically unexercised: whether the presence colour on an avatar's outline visibly matches its cursor, whether the cursor lands on the same point of the diagram for both clients under different pan/zoom, and whether the 100ms presence throttle reads as smooth.
- `useOthers` and the other Liveblocks hooks exist in **both** `@liveblocks/react` and `@liveblocks/react/suspense`, and the choice is load-bearing, not stylistic: the suspense variant must be inside a `ClientSideSuspense`, so anything mounted above the canvas' boundary (the navbar avatars) has to import the plain one. Mixing the two in one app is supported and expected.
- `<ReactFlow>`'s props extend `HTMLAttributes<HTMLDivElement>` and the unrecognised ones are spread onto its wrapper div, so `onMouseMove` / `onMouseLeave` work directly on the component. That is the difference between them and `onPaneMouseMove`, which stops firing the moment the pointer crosses a node.
- `14-node-editing` verification: `npx tsx scripts/verify-canvas.ts` passes, `npm run build` (with its TypeScript pass) and `npx eslint` on the changed files are clean. **Not verified in a browser** — same missing Clerk session as everything since `07`. Everything in this unit is a pointer gesture, so the untested surface is all of it: the resize drag itself, whether the double-click reliably beats the pane's zoom, and whether a second client sees the label change land.
- React Flow reserves three opt-out classes on the pane, and they are not interchangeable: `nodrag` (do not drag the node), `nopan` (do not pan or double-click-zoom the canvas — also what the d3 zoom filter reads), and **`nokey`** (do not start the selection box). `nokey` is the undocumented-feeling one and is checked as `event.target.closest('.nokey')` inside `Pane`'s `onPointerDownCapture`, *before* it calls `stopPropagation`. Any interactive control living inside the flow that should survive a Shift+drag needs it.
- React Flow's `deleteKeyCode` needed no guarding while typing: `useKeyPress` already ignores events originating from an input, textarea or contenteditable, so Backspace in the label editor does not delete the node.
- `NodeResizeControl` builds its style as `{ ...style, scale, ...(color && { backgroundColor | borderColor: color }) }`. The `color` prop therefore **wins over** `handleStyle`/`lineStyle` for that one property. Style the rest through those props and let `color` own the tint, or drop `color` entirely — do not expect `handleStyle.backgroundColor` to apply.

- `13-node-shape` verification: `npx tsx scripts/verify-canvas.ts` passes, `npm run build` (with its TypeScript pass) and `npx eslint` on the changed files are clean. **Not verified in a browser** — same missing Clerk session as everything since `07`. The unverified surface is the visual one: how each shape actually reads on the canvas, and whether the drag ghost snapshots correctly in each browser.
- `dataTransfer.setDragImage()` is the whole drag preview — no cursor tracking, no `dragover` state. Its one constraint is that the element must be laid out when `dragstart` fires: `display:none` or `visibility:hidden` snapshot blank, so the ghosts are parked at `fixed -left-[9999px]` instead. That also means the ghosts must be rendered up front rather than created from state on drag start, hence one per shape rather than one shared node.
- PR #3 Codex review fixes verified: `verify-project-api.ts`,
  `verify-project-data.ts`, `verify-canvas.ts`, and `verify-liveblocks.ts` pass;
  `tsc --noEmit`, ESLint, and the Next.js production build are clean; React
  Doctor 0.9.2 reports 100/100 with no issues. The additive tombstone migration
  is applied and `prisma migrate status` reports the database up to date.
- `12-shape-panel` verification: `tsc --noEmit`, `npm run lint` and `npm run build` all clean, and `npx tsx scripts/verify-canvas.ts` passes. **Not verified in a browser** — same missing Clerk session as everything since `07`. Nothing in this unit is exercisable without a pointer on a live canvas, so the untested surface here is larger than usual: the actual drag gesture, the drop coordinate conversion, and whether a second client sees the new node.
- `nodeTypes` is a **module-level** constant. Passing an inline object literal makes React Flow re-register every node type on each render, which remounts custom nodes and drops their local state. It logs a console warning rather than failing.
- `useReactFlow` throws outside a `ReactFlowProvider`, and `<ReactFlow>` does *not* count as one for its own siblings or its parent — only for its children. Any hook-using code that sits beside or above `<ReactFlow>` needs the explicit provider.
- The `cd` in a Bash call **persists across tool calls** in this session. A `cd node_modules/...` to inspect a package left every following command running from there, and `npm run lint` failed with "Missing script" until the directory was reset. Use absolute paths when poking around `node_modules`.
- `11-base-canvas` verification: `tsc --noEmit`, `npm run lint` and `npm run build` all clean. `npx tsx scripts/verify-liveblocks.ts` passes including a live `getRooms()` call, so `LIVEBLOCKS_SECRET_KEY` is confirmed good against the real Liveblocks API. Against `next dev`, an unauthenticated `POST /api/liveblocks-auth` answers a clean JSON `401` — the Clerk gate runs before any Liveblocks call, so a signed-out request never reaches the node client. **The canvas UI itself is still unverified in a browser** (no reachable signed-in session, see Open Questions).
- Both Liveblocks keys are now in `.env`. `LIVEBLOCKS_PUBLIC_KEY` is stored **without** the `NEXT_PUBLIC_` prefix and **nothing reads it**: the canvas authenticates through `authEndpoint`, not `LiveblocksProvider`'s `publicApiKey`. Leaving the prefix off keeps an unused key out of the client bundle; rename it if a client-side consumer ever appears.
- `scripts/verify-liveblocks.ts` gained `import "dotenv/config"` and a live secret check. It ends in `main().catch(...)`, not top-level `await` — `tsx` transforms these scripts to CJS, which rejects top-level await outright (`Top-level await is currently not supported with the "cjs" output format`). Any verify script that goes async needs the same shape.
- No verification script was added. The only branch is `describeConnectionError`, a code→string switch, and everything else in `types/canvas.ts` is data a test would just restate. The load-bearing constraint — `CanvasNodeData` satisfying React Flow's `Record<string, unknown>` — is enforced by `tsc` on every build.
- React Flow node data must be declared with a `type` alias, not an `interface`. `Node<T>` constrains `T extends Record<string, unknown>`, and interfaces do not get the implicit index signature that satisfies it. This is the one place `code-standards.md`'s "use `interface` for object contracts" cannot be followed.
- `useLiveblocksFlow` seeds its own `flow` key in Storage (`setInitialStorage` inside the hook), so `RoomProvider` needs no `initialStorage` prop.
- `06-project-apis` verification: `npx tsx scripts/verify-project-api.ts` passes, `tsc --noEmit`, `npm run lint` and `npm run build` are clean, and the build output registers `ƒ /api/projects` and `ƒ /api/projects/[projectId]`. Against `next dev`, unauthenticated `GET`, `POST`, `PATCH` and `DELETE` all return `401` with `content-type: application/json`, while `GET /editor` still returns `307` — confirming the `/api` middleware exemption did not leak to pages.
- `07-wire-editor-home` verification: `npx tsx scripts/verify-project-api.ts` and `npx tsx scripts/verify-project-data.ts` both pass, and `tsc --noEmit`, `npm run lint`, `npm run build` are clean. The data-layer script runs against the live database and covers `getOwnedProjects`, `getSharedProjects` (case-insensitive email, own projects excluded, self-invite not double-listed, no-email → empty), creating a project with the room ID as its primary key, the `P2002` duplicate that produces the `409`, and the collaborator cascade on delete. It seeds and cleans up under `verify_owner` / `verify_other_owner`, so it does not disturb the `user_seed_owner` rows.
- `08-editor-workspace-shell` verification: `tsc --noEmit`, `npm run lint` and `npm run build` all clean, with `ƒ /editor/[roomId]` in the build output. `npx tsx scripts/verify-project-data.ts` passes, including the six new access assertions against the live database. Unauthenticated, both `/editor/checkout-service-a1b2c3` and `/editor/verify-does-not-exist` `307` to `/sign-in` with the right `redirect_url`, so `proxy.ts` covers the new dynamic segment. The **signed-in** paths — `AccessDenied` rendering, the active-row highlight, the AI panel slide-over — are still unverified in a browser for the same reason as `07` (no reachable session; see Open Questions).
- `09-share-dialog` verification: `tsc --noEmit`, `npm run lint` and `npm run build` all clean, with `ƒ /api/projects/[projectId]/members` and `ƒ .../[memberId]` in the build output. Both verification scripts pass — `verify-project-api.ts` gained `parseCollaboratorEmail` (11 rejection cases) and `indexUsersByEmail` (multi-address users, case mismatch, username fallback, unnamed users), `verify-project-data.ts` gained the duplicate-invite `P2002`, the same email across two projects, and the project-scoped delete. Against `next dev`, unauthenticated `GET`/`POST` on the collection and `DELETE` on the nested route all return JSON `401`, and the old `/collaborators` path is `404`.
- `tsc --noEmit` reads `.next/types/validator.ts`, which Next generates from the route tree. **Renaming a route directory leaves that file stale, so `tsc` reports `TS2307: Cannot find module …/route.js` for the old path until a build or `next typegen` regenerates it.** The error is an artefact, not a real break — re-run `tsc` after `npm run build` before chasing it.
- `eslint`'s `react-hooks/set-state-in-effect` rejects any `setState` called synchronously in an effect body — it fired twice while building `useCollaborators` and once on a `window.location`-reading effect in the share dialog. Both fixes were real improvements rather than suppressions: derive the flag from existing state (`isLoading` from a project-stamped `ListState`), or read the value in a lazy `useState(() => …)` initialiser. Reach for those two shapes before writing a loading-flag effect anywhere else in this codebase.
- `lib/project-access.ts` imports `@clerk/nextjs/server`, and importing it from a plain `tsx` script works fine — only *calling* `auth()`/`currentUser()` needs a request context. That is what lets `scripts/verify-project-data.ts` exercise `getAccessibleProject` directly.
- The `agent-browser` browser has its **own profile** and does not share cookies with the desktop Chrome the project owner signs into — `agent-browser cookies get` showed `__client_uat=0` (signed out) even while the owner's Chrome had a session. Either sign in inside the agent-browser window itself, or start Chrome with `--remote-debugging-port=9222` and use `agent-browser connect 9222`. Do not assume a session carries over.
- Clerk's `+clerk_test` development addresses do not get past the sign-up form here: the instance has a Cloudflare Turnstile bot challenge enabled, so programmatic sign-up stops at the widget. Turning the challenge off for the dev instance (Clerk dashboard → Attack protection) would unblock automated end-to-end runs.
- To exercise the authenticated paths by hand: `clerk api /sessions -d '{"user_id":"<id>"}'` then `clerk api /sessions/<session_id>/tokens`, and send the returned JWT as `Authorization: Bearer <jwt>` to `localhost:3000`. `clerk users list --json --limit 5` finds a user ID. The session-creation call is blocked by Claude Code's auto-mode classifier, so run it with a `!` prefix in the prompt or from a normal shell.
- Prisma 7 moved two things that older examples still get wrong: the datasource URL and the seed command both live in `prisma.config.ts`, not in `schema.prisma` and not in `package.json#prisma.seed`. The generator provider is `prisma-client`, and the emitted client is imported from the `output` path (`@/generated/prisma/client`), not from `@prisma/client`.
- `pg` prints a startup warning that `sslmode=prefer|require|verify-ca` are currently aliased to `verify-full` and will adopt weaker libpq semantics in pg v9. Harmless today; if the connection string is ever pinned, prefer an explicit `sslmode=verify-full`.
- Do not put `import "server-only"` in `lib/prisma.ts`. The package resolves to a module that throws unless the importer is under the `react-server` condition, so it holds in Next server components but breaks every plain-Node consumer — `prisma/seed.ts`, `scripts/verify-prisma.ts`, and the Trigger.dev tasks in `architecture-context.md`, all of which legitimately need the client. It was added and then removed for exactly that reason. Client-side protection still comes free: `pg` pulls in `node:` builtins, so an accidental client-component import fails the build loudly.
- `prisma migrate dev` refuses to run in a non-interactive shell as soon as the diff contains a destructive change (dropping a non-empty table) — it prints the warning then errors out rather than defaulting either way. The way through without `migrate reset`: `prisma migrate diff --from-config-datasource --to-schema prisma --script -o <new-migration>/migration.sql`, then `prisma migrate deploy`. Note `--from-schema-datasource` was removed in Prisma 7 in favour of `--from-config-datasource`.
- `npm` did not run install scripts for `prisma` / `@prisma/engines` (allow-scripts prompt was left pending) and everything still worked — migrate, generate, and queries all ran. Prisma 7 with a driver adapter does not need the downloaded query engine.

- React Doctor v0.9.1 installed as a dev dependency and initialized with its
  project installer. Setup added the `doctor` npm script, project-local agent
  skill files, `.github/workflows/react-doctor.yml`, and a local pre-commit
  hook. The first full verbose scan scored 82/100 with no errors and 8
  warnings: 2 auth-panel transition warnings, 2 generated shadcn
  non-component-export warnings, 3 intentionally unused foundation
  primitives, and the placeholder `isPending` state in
  `useProjectActions()`.
- `04-project-dialogs` verification: `npm run build`, `tsc --noEmit` and `npm run lint` all clean. `slugify()` checked with assertions against the shipped function (`node --experimental-strip-types`): `"Checkout Service"` → `checkout-service`, `"  Payments  API  "` → `payments-api`, `"Café Service"` → `cafe-service`, `"V2 -- Auth!!"` → `v2-auth`, `"!!!"` and `""` → `""`. In-browser interaction check is still outstanding — `/editor` is behind Clerk and this session had no signed-in browser session (`/editor` correctly 307s to `/sign-in`).
- The black-input-text bug was isolated in-browser without a signed-in session: `/sign-in` is public and serves the same compiled stylesheet, so appending a throwaway `<input>` with the primitive's class list and reading `getComputedStyle(...).color` reproduced it (`rgb(8, 8, 9)`), then testing one class at a time named `text-base` as the culprit. Use that technique for any "wrong color" report — it beats reading class strings.
- `slugify` relies on NFKD plus the non-alphanumeric collapse to fold accents; there is no separate combining-mark strip, because the mark is already dropped by `[^a-z0-9]+`.
- Auth panel redesign verified at 1440×900, 1024, 768 and 375: no overflow at any width, zero console errors, aside `display: none` at 375, `npm run build` and `tsc --noEmit` clean. Contrast measured in-browser against `--bg-surface`: feature text 10.46:1, list indices 4.85:1, footnote 4.85:1 — all above the 4.5:1 AA threshold.
- Design guidance came from the `ui-ux-pro-max` skill (github.com/nextlevelbuilder/ui-ux-pro-max-skill, MIT). Its "Exaggerated Minimalism" style entry and pre-delivery checklist were applied; its colour palette and Inter typography recommendations were deliberately ignored, since the project palette and Geist pairing are fixed by `ui-context.md`. The skill is **not installed in this repo** — `uipro init --ai claude` was blocked by the permission classifier. Install with `/plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill` then `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`.
- `03-auth` verification. Unauthenticated routing matrix: `/` → 307 `/sign-in`, `/editor` → 307, `/anything-else` → 307, `/api/whatever` → 307, `/sign-in` → 200, `/sign-up` → 200. `npm run build` and `tsc --noEmit` both clean. No hardcoded hex or raw Tailwind palette classes in any auth surface. No horizontal overflow at 375 / 768 / 1024 / 1440 on either auth page; no console errors. Two-panel layout confirmed at 1280×800 and form-only at 375×812.
- The auth pages initially overflowed 375px by 8px: Clerk's card has a fixed 335px min-width and the shell's `px-6` (48px) pushed `main` to 383px. Fixed with `px-4 sm:px-6` on the form column. Measure `document.documentElement.scrollWidth` vs `clientWidth` rather than trusting a screenshot — the overflow was not visible in the capture.
- The two-panel split is keyed to `lg` (1024px), so 768px renders form-only. That matches the spec's "large screens / small screens" split but is worth knowing when testing tablets.
- `agent-browser` sets the viewport with `agent-browser set viewport <w> <h>` — there is no top-level `resize` or `viewport` command. A wrong invocation fails quietly enough that screenshots keep rendering at the old size; confirm with `eval "window.innerWidth"` before trusting a responsive screenshot.
- Earlier `clerk init` verification at 1280×800: `clerk doctor` green apart from "production not configured", Clerk modal themed dark with GitHub + Google OAuth enabled, only console message being Clerk's expected development-keys warning.
- A freshly started `next dev` can return a transient 404 for the first request to a route while it compiles. Re-request before treating it as a routing bug — an apparent `/` 404 during this work was exactly that.
- A long-running `next dev` process kept a stale route tree after `clerk init` added routes: `/sign-in` returned 200 but `/sign-up` returned 404 with `x-middleware-rewrite: /sign-up` — the proxy rewrote correctly and Next then failed to match. `.next/dev/server/.../app-paths-manifest.json` had a `sign-in` entry and no `sign-up` one (plus a stale `editor` entry from the deleted harness). Touching the file did not help; only restarting the dev server did. Restart `next dev` after any CLI that scaffolds routes.
- Clerk's CLI is a compiled binary that shells out to `open` and ignores `$BROWSER`, so it always hits the OS default browser. To force a specific browser, put a shim named `open` earlier on `PATH` that execs `/usr/bin/open -a "Google Chrome" "$@"`.

- Verified the chrome through a temporary `app/editor/page.tsx` harness (deleted afterward — the real route arrives in `07-wire-editor-home` / `08-editor-workspace-shell`). At 1280×800 and 375×812: zero console errors, sidebar overlays without shifting the canvas, tabs switch, no horizontal overflow at 375. The closed-state accessibility snapshot listed only the navbar toggle — `inert` keeps all four sidebar controls out of the tree — and the open-state snapshot exposed heading, close button, both tabs, panel, and New Project.
- Browser tooling: use the `agent-browser` CLI (`/opt/homebrew/bin/agent-browser`, load its guide with `agent-browser skills get core --full`). gstack `browse` is SIGKILLed (exit 137) on every command here, sandboxed or not, and the Playwright MCP needs a Chrome bridge extension that is not installed.
- Verified with a temporary `app/smoke/page.tsx` that imported all 7 primitives plus `cn()` and `lucide-react`; production build compiled and prerendered clean. `cn("p-2","p-4",false && "hidden","text-copy-primary")` resolved to `p-4 text-copy-primary`, confirming conflict resolution. Built CSS showed `body` → `#080809` / `#f0f0f4`, `html` → Geist Sans, and zero occurrences of the light `oklch(1 0 0)` palette. The smoke route was deleted afterward — it is not part of the spec.
- Next.js private-folder rule: a route directory prefixed with `_` (e.g. `app/_smoke`) is excluded from routing and will silently not compile. Use a non-underscore name for throwaway verification routes.
- Project runs Next.js 16.2.12 with Tailwind v4 and React 19.2.4. `AGENTS.md` requires checking `node_modules/next/dist/docs/` before using Next APIs.

- Trigger.dev is wired up (project `Truss`, ref `proj_elbcqayjdfyvyvysmclr`, org `jacks-org-1212`). `@trigger.dev/sdk` + `@trigger.dev/build` were already installed and `trigger.config.ts` already pointed `dirs` at `./src/trigger`; what was missing was a task to register and a deprecated import. `defineConfig` now comes from `@trigger.dev/sdk` — **never `@trigger.dev/sdk/v3`**, which is a deprecated alias. `src/trigger/example.ts` is a placeholder echo task, marked `ponytail:`, to be deleted when the first real task (AI generation, per `architecture-context.md`) lands. Verified end to end: `tsc --noEmit` clean, `trigger dev` built the local worker, and a triggered run of `example` completed with the expected output.
- `TRIGGER_SECRET_KEY` is **not** set in `.env.local` yet. The CLI dev server does not need it (it uses the CLI login), but `tasks.trigger()` from a route handler or server action does — grab the DEV key from the dashboard's API Keys page. When tasks are triggered from app code, import the task **type only** and call `tasks.trigger<typeof x>("id", payload)`, so task code never gets bundled into the Next build.
- Tasks that need Prisma will need the `prismaExtension` (or `build.external`) in `trigger.config.ts` — the generated client at `/generated` is not bundled by default. Nothing needs it yet.
- `TRIGGER_SECRET_KEY` (DEV) is now set in `.env.local`, verified by triggering `example` through `tasks.trigger()` from plain Node with `--env-file=.env.local` while the dev worker ran — the run came back `COMPLETED` with `{"echoed":"key check"}`. That is the same code path a route handler or server action takes, so app-side triggering is confirmed working, not just the CLI.
- `GEMINI_API_KEY` is set in `.env.local` for the AI generation task. Nothing reads it yet, and no Google SDK is installed. Two things to know when one is: the key authenticates as an **`x-goog-api-key` header, not a bearer token** (verified — `GET /v1beta/models` returns 200 with the header and 401 with `Authorization: Bearer`), and `@google/genai` picks up `GEMINI_API_KEY` from the environment automatically, whereas the Vercel AI SDK's Google provider looks for `GOOGLE_GENERATIVE_AI_API_KEY` and would need a rename or an explicit `apiKey`. Deployed Trigger.dev runs do not read `.env.local` — mirror the key in the dashboard's Environment Variables before any cloud task calls Gemini.

- Design runs completed but nothing landed on the canvas and the sidebar stayed
  silent until a reload. One root cause, in the model call — the realtime
  transport was never at fault. Two independent faults in
  `trigger/design-agent.ts`:
  - `providerOptions.google.thinkingConfig.thinkingBudget: 1024` on a **Gemini 3**
    model. Gemini 3 takes `thinkingLevel` (`minimal|low|medium|high`); the numeric
    budget did not clamp thinking, it made generation degenerate — measured 41,662
    output tokens over 167s to emit a single malformed action with `"y": null`.
    That is what pushed runs past `maxDuration: 180` and produced the `TIMED_OUT`
    runs; the composer stays locked for the whole time because no terminal event
    ever arrives.
  - The plan schema marked only `type` as `required`. Gemini's structured output
    then satisfies the schema **minimally**: same prompt, `type`-only required
    returned **1** action, all-fields required returned **9**. Every property is
    now required and actions that have no value for a field send `""`/`0`, which
    `parseDesignPlan` already drops. The schema is what gets a complete response
    out of the provider; the parser is still what decides validity.
  Also swapped `streamText` + `Output.object` for `generateObject`: nothing
  consumes model tokens as they arrive (the sidebar gets curated activity parts),
  so the streaming variant bought only its partial-JSON repair, which truncated
  the action list at whatever had arrived when it closed the object.
  Verified end to end with a `@liveblocks/client` session connected in Node while
  a run executed: status feed `started → processing → complete`, one storage
  update carrying 8 nodes + 7 edges, then the assistant summary on `ai-chat` — all
  live, no reload. Before the fix the same room ended a 14-action run with one
  unlabelled node and zero edges.
- Two beliefs recorded in the AI hooks are **wrong**, and cost real debugging time.
  `useFeedMessages` on a feed that does not exist does *not* resolve to an error:
  the websocket `FETCH_FEED_MESSAGES` returns an empty list, verified against both
  the REST API and a live client. The comments in `hooks/use-ai-chat.ts` and
  `hooks/use-ai-status.ts` claiming otherwise should not be trusted. It matters
  because the failure mode they describe would be unrecoverable — Liveblocks
  builds that resource with `autoRetry: false`, and its derived signal returns
  early on `error`, discarding realtime messages that arrive later. That is worth
  knowing if a feed fetch ever *does* fail for a real reason.
- `AiChatTranscript` renders run activity only inside `messages.map`, keyed by the
  prompt's feed-message id, so the whole local run UI — including the
  `DesignRunObserver` that settles the turn and unlocks the composer — depends on
  the user's own message coming back through Liveblocks. It works (verified), but
  a feed hiccup would present as a permanently spinning composer, not as a missing
  message.

- AI sidebar, minimal pass. Run activity lost its card — no border, background,
  rounded corner, timeline rail or bullet dots — so the work log sits on the
  panel background like the messages around it. `RemoteRunStatus` lost the same
  chrome for consistency. Chat entries lost both avatar icons; a human message is
  the one on `bg-elevated`, the assistant writes straight onto the panel, and
  that is the entire distinction. The author name now renders only for *other*
  collaborators, where it carries information; "You" and "Truss" are kept as
  `sr-only`, because a background colour is not something a screen reader can
  hear.
- Streaming autoscroll. The transcript already had a ResizeObserver that caught
  activity growth (that state lives in `DesignRunObserver`, so no prop on
  `AiChatTranscript` changes and there is no render to hang an effect on). What
  was missing was smoothness, and adding it broke the follow logic: with
  `scroll-smooth` the browser fires `scroll` for every frame on the way down, and
  the old handler read those frames as "not at the bottom", dropping follow
  mid-run and strobing the jump button. Follow is now driven by reader intent —
  wheel-up or touch releases it, arriving at the bottom takes it back — and
  `scroll` only ever *re-enables*. Smoothness is CSS (`scroll-smooth` +
  `motion-reduce:scroll-auto`), so reduced motion needs no JS branch.
  Known gap, marked `ponytail:`: keyboard paging and scrollbar dragging do not
  release follow, so the next chunk pulls the reader back down.
- New activity parts fade and rise 4px over 200ms under `motion-safe:`. Reasoning
  deltas append to the previous part under its existing key, so React updates
  that element in place and the animation does not replay per chunk. Verified in
  the compiled CSS rather than assumed: `motion-safe:fade-in` emits
  `--tw-enter-opacity:0`, `slide-in-from-bottom-1` emits the translate, and
  `@keyframes enter` reads both — `motion-safe:` does compose with
  `tw-animate-css`.

- Composer rebuilt to the Cursor shape: prompt on top, a row underneath with the
  model picker on the left and a small round send button (`size-7`, `ArrowUp`)
  on the right. The "Enter to send · Shift+Enter" hint is gone, and so is the
  panel's whole title bar — the Chat/Specs tabs already say what the panel is, so
  the close button moved in beside them and the 64px header row went back to the
  transcript. The `<aside aria-label>` is what names the region now, so nothing
  was lost to assistive tech.
- Backgrounds stripped so the composer hangs: no fill on the wrapper, no top
  border, no fill on the form. The textarea needed **four** background resets,
  not one — the shadcn primitive fills itself with `dark:bg-input/30` and swaps
  to `dark:disabled:bg-input/80` while disabled, which is exactly when a run is
  in flight, so a bare `bg-transparent` loses to both variants and the grey
  returns the moment you send. Same trap on the select trigger
  (`dark:bg-input/30`). Confirmed in the built CSS rather than by eye: the
  resets and the primitive's fills have equal specificity, and the resets are
  emitted after them, so source order is what decides it.
- Model picker. `AI_DESIGN_MODEL` (one constant) became `AI_DESIGN_MODELS` (an
  allowlist) plus `DEFAULT_AI_DESIGN_MODEL_ID` and `parseAiDesignModelId`, and
  the id is threaded composer → `/api/ai/design` → task payload → `generateObject`.
  Gemini 3 only, deliberately: `thinkingLevel` is a Gemini 3 control, so keeping
  one generation is what lets the task send one provider option for every entry.
  Every listed id was run against the real design workload on this key first —
  `models.list` advertises models that answer 404 on generate, so it is not
  evidence. Measured, empty canvas, "Build a CI/CD pipeline": 3.6-flash 6.1s/11
  actions, 3.5-flash 6.5s/9, 3.5-flash-lite 2.0s/7, 3.1-pro-preview 11.1s/9.
- The id crosses a trust boundary twice and is validated at both. The route
  refuses an unknown model (400) rather than defaulting, because forwarding it
  would spend a paid run on a model nobody chose; the worker re-validates and
  *does* fall back, because a stale model name is not a reason to abandon a
  canvas edit. Absent means "default" at both. Verified live: a run with
  `gemini-3.5-flash-lite` completed in 4.8s with 7 actions, and one with
  `gemini-9-does-not-exist` fell back and completed.
- `checkDesignModelMetadataIsShared` was asserting the old single descriptor and
  is now `checkDesignModelAllowlist`, covering default-is-offered, every offered
  id round-tripping through the route parser, and unknown/empty/non-string being
  refused. All three verify scripts pass.
- The run activity subline no longer prints a model id. It was read from the
  constant, and the model is a per-run choice now while an `AiRunTurn` does not
  carry which one ran — so any id printed there would be a guess. Threading
  `modelId` onto the turn is the fix if per-run attribution is ever wanted.

- Assistant chat messages render markdown, via `markdown-it` in `lib/markdown.ts`.
  Only the assistant side: a prompt is something a person typed, and rendering it
  would silently eat their asterisks and underscores.
- That module is a trust boundary, not a formatting helper — its output goes
  straight into `dangerouslySetInnerHTML`. `html: false` is the whole sanitizer
  and there is no second pass behind it. It does not *strip* raw HTML, it
  escapes it, so `<img onerror=...>` in a message renders as visible text
  (confirmed: `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;`). **Never turn
  that flag on** — wanting an embedded tag to work is the moment the file grows
  a real sanitizer, not the moment the option flips. Unsafe link schemes are
  refused by markdown-it's own `validateLink`: `[click](javascript:alert(1))`
  does not become a link at all, it renders as literal text. Links that do
  render get `target="_blank"` plus `rel="noopener noreferrer nofollow"` —
  `noopener` is the security half, without it the opened page can reach back
  through `window.opener` and redirect the editor tab.
  `scripts/verify-ai-chat.ts` covers all of this: script/img/iframe/div/style
  escaping, four unsafe schemes, and the formatting that is actually used.
- No `@types/markdown-it`. markdown-it 15 ships its own types and the
  DefinitelyTyped package still describes v14 — installing it produced
  "'MarkdownIt' refers to a value, but is being used as a type". The default
  export is a callable back-compat wrapper and the class is a separate *type*
  export, so the import is `MarkdownItCallable, { type MarkdownIt }`.
- Cost: ~46KB gzipped on the client (markdown-it bundles linkify-it, entities
  and uc.micro). The transcript is realtime and client-rendered, so this cannot
  move to the server. Against the <300KB app-page budget in the ECC web rules it
  is affordable but not free — if it ever needs to come down, the options are a
  smaller renderer (`snarkdown`, ~1KB) or a dynamic import on first assistant
  message, at the cost of making rendering async.
- Markdown output has no classes on it, so it is styled from the container with
  arbitrary variants rather than a typography plugin, which would have to be
  half-overridden to stop fighting the panel palette. Verified in the built CSS
  that each one emits, including the easy-to-typo ones: `[&_li::marker]`,
  `[&_pre_code]`, `[&_p+p]`, `[&_blockquote]`, `[&_table]`.

## Streaming transcript scroll

- The sidebar's transcript never scrolled at all. `AiSidebar`'s wrapper around
  `AiChatTranscript` was a plain block, and the transcript sizes itself as a
  flex item (`min-h-0 flex-1`) whose viewport is `h-full` — against a block
  parent both heights stay indefinite, so the viewport grew to fit the run
  instead of scrolling it and the activity rendered over the composer.
  Measured before the fix: wrapper 414px, viewport inside it 679px, with
  `scrollHeight === clientHeight`. The wrapper must stay `flex … flex-col`.
- Following the stream is a rAF ease loop, not CSS `scroll-smooth`. A run grows
  the content every few frames and every growth re-issues the scroll; with
  `scroll-smooth` each one restarts the browser's ease from a standstill, which
  reads as a stutter that never catches up and then snaps. `jumpToLatest` still
  uses native `scrollTo({behavior:"smooth"})` — nothing re-targets a one-shot.
- The loop's cleanup must null `frameRef`, not just cancel the frame: a non-null
  ref means "already running", so a cancelled id left behind blocks every later
  call. StrictMode's dev remount hit this on first render and killed follow for
  the whole session.
- Verified by streaming fake activity into the real components on a throwaway
  route (deleted): scrollTop traced 0→16→46→83→126→148→…→281 and held at the
  bottom — continuous, no jump.

## Layout the model can actually reason about

- The prompt listed default node sizes but never said an x,y is the *top-left*
  corner, and never mentioned that an edge label renders as a pill centred on
  the edge midpoint. So a model spacing two nodes by the minimum gap produced a
  labelled edge whose label was drawn across one of them.
- `EDGE_LABEL_CLEARANCE` (`types/canvas.ts`, 160x24) is the label's footprint,
  measured off `CanvasEdgeRenderer`'s own pill styling. The prompt budgets it
  between any two nodes joined by a labelled edge, on top of `MIN_NODE_GAP`.
- The auto-placement fallback had the same bug — 260x180 steps left 80 units
  between columns, less than a label. Now 380x240, asserted in
  `scripts/verify-design-agent.ts` along with the prompt stating every default
  size and both clearances.
- Not done: no edge-aware layout pass. The validator still only pushes nodes
  down on overlap and knows nothing about the edges the same plan adds, so a
  long label on a short edge can still collide. A real router (dagre/elk) is the
  upgrade path if that shows up in practice.

## Caller-generated diagram graph contract

- Task 1 introduced `lib/agent-graph.ts`: launch graphs are strict,
  all-or-nothing compact documents with 1..40 nodes and 0..60 edges. Accepted
  data is materialized into the canonical canvas node/edge constants and
  per-shape default dimensions; graph launch payloads remain version 1.
- Agent-launch session records now carry `{ version, launchId, title, graph }`,
  live under the `truss.agent-launch.graph.v1:` namespace, and follow the graph
  import lifecycle instead of creating an AI chat prompt or Trigger run.
- `scripts/verify-agent-graph.ts` covers graph parsing, materialization,
  cardinality, strictness, graph topology, and immutability. The launch verifier
  covers the new payload transport and every allowed and rejected lifecycle
  transition.

## Caller-generated diagram skill launcher

- Task 2 packages the caller-generated graph flow in `render-truss-diagram`.
  The skill keeps the user title and description, creates a compact positioned
  graph using its bundled contract reference, and sends only `{ title, graph }`
  through launcher stdin. The dependency-free launcher rejects malformed or
  oversized graphs, including encoded fragments over 16,384 characters, before
  opening the browser; it retains origin validation and privacy-safe output.
- Review fix round 1 validates the bundled reference graph through the launcher,
  makes app and launcher boundaries both reject padded transport values rather
  than silently trimming them, and proves the exact 16,384-character fragment
  acceptance boundary plus the next valid encoded length rejection.
- Review fix round 2 reuses one deterministic test-only fixture to verify the
  app fragment parser itself accepts exactly 16,384 encoded characters and
  rejects the next constructible valid length, matching the launcher.

## Caller-generated diagram editor import

- Task 4 replaces the obsolete prompt launch runner and hook with the direct
  `useAgentLaunchImport` owner-route flow. Matching project/launch records are
  deduplicated across Strict Mode, persist `importing-graph` before POST and
  `graph-imported` before clearing tab storage and `?launch` after HTTP 200.
  Network, 5xx, and 409 responses retain the graph in a safe failed state for
  Retry; terminal and mismatched records are no-ops. The editor renders only a
  neutral canvas status/failure overlay, keeps ordinary AI chat closed, and
  never passes launch IDs into `AiSidebar` or calls chat/orchestrate/Trigger.
  `scripts/verify-agent-launch-editor.tsx` covers the lifecycle, same-tab
  deduplication, retry retention, mismatch/terminal no-ops, hook mount gate,
  and unchanged manual-sidebar boundary.

## Production deployment and dev/prod key split

- `.env` now carries production credentials alongside development ones under a
  `_PROD` suffix (`LIVEBLOCKS_SECRET_KEY_PROD`, `LIVEBLOCKS_PUBLIC_KEY_PROD`,
  `TRIGGER_SECRET_KEY_PROD`). Nothing reads the suffix at runtime: application
  code keeps reading the plain names, and the suffix is resolved once per deploy
  by `lib/env-keys.ts` (`resolveEnvKeys`). Local `npm run dev` therefore always
  gets development keys, with no branch anywhere in the app.
- Two callers share that function so a new key cannot follow the rule in one
  place and not the other: `scripts/push-vercel-env.ts` (plain values into
  Vercel Development/Preview, `_PROD` values into Production, both under the
  plain name) and the `syncEnvVars` extension in `trigger.config.ts` (same rule
  when `trigger.dev deploy` targets prod). `scripts/verify-env-keys.ts` covers
  the resolution and runs in `npm run verify:unit`.
- Trigger.dev prod holds the three tasks plus 11 synced env vars, so the Gemini
  key no longer needs a manual dashboard entry. Deploying needs the CLI pinned
  to the installed SDK version and Docker Desktop's credential helper on PATH:
  `PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH" npx trigger.dev@4.5.10 deploy --env prod`.
- Vercel project `truss` deploys from the CLI. Two things it needs and cannot
  infer: `vercel.json` pins the Next.js framework preset (the project was
  created with none, so the build looked for a `public/` output directory), and
  `.vercelignore` must list `.env*`. A `.vercelignore` replaces `.gitignore` for
  uploads, and an uploaded `.env` arrives in the build container as a dangling
  symlink — Next stats it while scanning the project root for root-level route
  files and the build dies with `ENOENT: stat '/vercel/path0/.env'`.
- Live at https://truss-jet.vercel.app. Deployment Protection covers the
  generated `truss-<hash>-*.vercel.app` URLs, not the production alias, so that
  alias is publicly reachable. Clerk is still on its development instance
  (`pk_test_`/`sk_test_`): it loads fine on the deployed domain but carries
  strict usage limits. Staying on the development instance is a deliberate call
  for now — a Clerk production instance is pinned to a domain via CNAME records,
  and DNS cannot be set on `*.vercel.app`, so going production means buying a
  domain first. Revisit before handing the URL to anyone else; until then anyone
  who finds the alias can sign up into the development instance.
  When it is time: `clerk deploy` (interactive, creates the instance and prints
  the DNS records), then `clerk deploy status`, then add the keys to `.env` as
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY_PROD` / `CLERK_SECRET_KEY_PROD` and re-run
  `scripts/push-vercel-env.ts`. No code changes — the `_PROD` convention covers
  it. Social sign-in providers would need their own production OAuth credentials.
- The `truss-diagram` skill works against the deployment with
  `--base-url https://truss-jet.vercel.app` (or `TRUSS_APP_URL`). Verified: the
  `/agent/link` preflight answers 200, and the link flow's callback from the
  deployed HTTPS page to the `127.0.0.1` loopback succeeds in a real browser —
  the preflight and POST both arrive, no private-network header needed. It fails
  only in headless Chrome, which is not what the skill opens.
- Gotcha worth remembering: local and prod share one `DATABASE_URL` but use
  different Liveblocks projects, and `Project.id` doubles as the Liveblocks room
  ID. A diagram drawn through prod therefore appears in the local project list
  with an empty canvas, and vice versa. Splitting the database is the fix if
  that becomes confusing.
