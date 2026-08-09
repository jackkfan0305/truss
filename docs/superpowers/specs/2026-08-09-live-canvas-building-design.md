# Live Canvas Building Design

## Goal

Make the AI Architect visibly build the diagram. Its cursor sweeps across the
canvas and each node or edge appears where the cursor has just arrived, so the
work reads as something being performed rather than a result being pasted in.

Everyone in the room sees the same build, because the pacing is in the shared
state itself and not in one client's animation.

## Current Behavior

`trigger/design-agent.ts` applies the whole validated plan inside a single
`mutateFlow` call. Liveblocks broadcasts that as one storage update, so the
finished diagram appears in one frame.

Two supporting details make it worse:

- Every activity part is emitted *before* the write, so the sidebar narrates
  actions the canvas has not performed yet.
- `setAiPresence` parks the cursor once, at `getPlanFocus(plan)`, so the AI
  avatar never moves during the build.
- `components/canvas/live-cursors.tsx` writes `transform` directly from
  `presence.cursor` with no transition, so any cursor move is a teleport.

## Why Pacing Does Not Need One Write Per Action

`Liveblocks.mutateStorage` fetches storage once, then buffers ops and flushes
them on a **200ms debounce while the callback is still running**
(`@liveblocks/node`, `#_mutateOneRoom`). `@liveblocks/react-flow`'s `mutateFlow`
awaits its callback inside that.

So an `async` callback that sleeps between actions broadcasts incrementally from
a single storage fetch. Issuing one `mutateFlow` per action would instead re-fetch
the whole document every time — O(n²) transfer as the diagram grows — for the
same visible result.

The 200ms debounce is a floor on the reveal granularity: a step delay below it
coalesces several actions into one broadcast.

## Sequence

Per action, the cursor leads and the canvas follows:

```
t=0ms        setAiPresence(cursor -> action's target position)
t=0..sweep   cursor travels; canvas unchanged
t=sweep+pad  flow.addNode(...) / addEdge(...)
t=+settle    next action
```

The write waits out the travel deliberately. A node landing slightly *after* the
cursor arrives reads as "the cursor placed that"; landing early reads as broken.
The pad absorbs presence-write latency and the 200ms flush debounce, both of
which vary.

### Cursor targets

- `addNode`, `moveNode` — the node's own position.
- `addEdge` — the target node's position, so the cursor draws toward where the
  connection lands. Resolved from nodes this plan places or from the canvas the
  run started with; unresolvable targets leave the cursor where it is rather
  than sending it to the origin.
- `resizeNode`, `updateNodeData`, `deleteNode`, `deleteEdge` — the node's
  position when known, otherwise no move.

## Pacing Budget

Fixed per-action timing does not survive scale: `MAX_DESIGN_ACTIONS` is 60, and
60 actions at a comfortable pace is more than half a minute of forced watching.

Pace is therefore derived, not constant:

```
step = clamp(TOTAL_BUILD_BUDGET_MS / actionCount, MIN_STEP_MS, MAX_STEP_MS)
```

A twelve-node diagram sweeps leisurely; a sixty-node one moves briskly. Both
ends stay inside the task's `maxDuration`.

These are calibration values, not derived truths. They are tuned by watching a
real run, and the constants are named so that is possible.

## Timing Coupling

The worker's travel wait and the client's cursor transition are the same
duration. It is declared once in `types/tasks.ts` — already the shared
worker/client contract module — and imported by both. Duplicating it would let
the two drift, and the failure mode (nodes appearing before the cursor lands) is
exactly the thing this design exists to prevent.

## Client: Cursor Travel

`live-cursors.tsx` currently multiplies canvas position and viewport transform
into one `translate`. A naive `transition: transform` on that would also animate
pan and zoom, making the AI cursor slide around behind the diagram whenever the
canvas moves.

Split into three nested layers so only position animates:

```
outer   translate(vpX, vpY) scale(zoom)   viewport      no transition
  mid   translate(canvasX, canvasY)       position      transitions (AI only)
  inner scale(1 / zoom)                   size cancel   no transition
```

`transform-origin: 0 0` on the scaling layers so the cursor tip stays anchored.

This keeps every existing property of the cursor layer: pan and zoom stay
instant, and the pointer keeps a constant on-screen size at any zoom, which is
why the viewport transform was applied manually in the first place.

Only the AI cursor transitions. Human cursors update at pointer frequency and a
transition would render them permanently behind their real position; smoothing
those is a separate decision and is not made here.

## Client: Arrival Motion

A node fades and scales in as it appears, and an edge draws along its path via
`stroke-dashoffset`. This is the "pop" under the arriving cursor.

It must not fire on initial page load, or opening a project with thirty nodes
plays thirty animations at once. Freshness is read **once per element at first
render**, through a `useState` initializer against a context ref: elements
mounting during hydration read `false`, elements arriving later read `true`. A
reactive read would re-animate everything the moment the flag flipped.

`prefers-reduced-motion` disables the arrival motion and the cursor transition.

## Failure Behavior

Paced writes flush as they go, so a mid-run failure leaves a partial diagram.
This is accepted rather than rolled back: on a shared canvas a rollback either
clobbers or misses concurrent human edits, and partial work is visible work the
user can select and delete.

The consequence is that the error path must stop claiming otherwise. The catch
block currently reports "The canvas is unchanged", which becomes false the
moment the first action flushes. It reports how many of the planned changes
were applied instead.

## Out of Scope

- **Model streaming.** `generateObject` stays. `design-agent.ts` documents why
  `streamObject` was removed — partial-JSON repair silently truncated the action
  list — and time-to-first-node is not the problem being solved.
- **Rollback of partial builds.**
- **Layout improvements.** The `ponytail:` note in `lib/design-plan.ts` about
  force-directed layout still stands.
- **Human cursor smoothing.**

## Verification

`scripts/verify-design-agent.ts` covers the pure pieces: per-action application,
cursor target resolution, and the pacing calculation across action counts. The
sweep itself is a timing and rendering behavior, checked by watching a real run.
