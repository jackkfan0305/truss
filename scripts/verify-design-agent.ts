import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  LAYOUT_GRID,
  MAX_DESIGN_ACTIONS,
  MIN_NODE_GAP,
  NODE_COLOR_NAMES,
  createCursorTargets,
  describeDesignAction,
  parseDesignPlan,
  type DesignAction,
  type DesignContext,
} from "../lib/design-plan";
import {
  SYSTEM_PROMPT,
  buildDesignPrompt,
  describeCanvas,
  formatChatHistory,
} from "../lib/design-prompt";
import {
  appendAiActivityTimelinePart,
  selectAiActivityTimeline,
} from "../lib/ai-timeline";
import {
  reduceAiRunTurns,
  type AiRunTurn,
} from "../lib/ai-run-turns";
import { selectLatestAiStatus } from "../lib/ai-status";
import { isFullyRevealed, nextRevealLength } from "../lib/smooth-text";
import {
  AI_BUILD_BUDGET_MS,
  AI_DESIGN_MODELS,
  AI_THINKING_LEVELS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  getBuildStepMs,
  parseAiDesignModelId,
  parseAiThinkingLevel,
  isAiActivityTerminalPart,
  parseAiActivityPart,
  parseAiStatusMessage,
  type AiChatMessage,
} from "../types/tasks";
import {
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  DEFAULT_NODE_COLOR,
  DEFAULT_NODE_SHAPE,
  EDGE_LABEL_CLEARANCE,
  NODE_COLORS,
  NODE_DEFAULT_SIZES,
  NODE_MIN_SIZE,
  NODE_SHAPES,
  type CanvasEdge,
  type CanvasNode,
} from "../types/canvas";

/**
 * The design agent's only real logic is `parseDesignPlan`, and it sits on a
 * trust boundary a type system cannot help with: a language model's output.
 * Every check here is a way the canvas breaks silently — a node outside the
 * palette, an edge to a node that was never created, a diagram stacked on one
 * coordinate — none of which are visible in review.
 */

const EMPTY: DesignContext = { nodes: [], edges: [] };

function node(id: string, x: number, y: number): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y },
    width: 180,
    height: 80,
    data: { label: id, color: DEFAULT_NODE_COLOR, shape: "rectangle" },
  };
}

function edge(id: string, source: string, target: string): CanvasEdge {
  return { id, type: CANVAS_EDGE_TYPE, source, target, data: { label: "" } };
}

function addedNodes(actions: DesignAction[]) {
  return actions.flatMap((action) =>
    action.type === "addNode" ? [action.node] : []
  );
}

function addedEdges(actions: DesignAction[]) {
  return actions.flatMap((action) =>
    action.type === "addEdge" ? [action.edge] : []
  );
}

function chat(
  role: "user" | "assistant",
  content: string,
  senderName = "Ada"
): AiChatMessage {
  return { role, content, senderId: "u1", senderName, sentAt: 0 };
}

/**
 * The layout rule the model is given ("nothing you add may overlap") is only
 * followable if every existing rectangle is described. A node listed with a
 * position and no size is one the model has to guess the extent of.
 */
function checkCanvasDescriptionCarriesSizes() {
  const described = describeCanvas({
    nodes: [node("n1", 0, 0)],
    edges: [edge("e1", "n1", "n1")],
  });

  assert.match(described, /n1 \|/);
  assert.match(described, /at 0,0 \| 180x80/);

  // A node whose size the canvas never measured still has to be described, or
  // it reads as a zero-area point sitting at its origin.
  const unmeasured = describeCanvas({
    nodes: [{ ...node("n2", 40, 40), width: undefined, height: undefined }],
    edges: [],
  });

  assert.match(unmeasured, /\| \d+x\d+/);
  assert.equal(describeCanvas(EMPTY), "The canvas is empty.");
}

/**
 * The sidebar writes the prompt to the feed *before* triggering, so the run's
 * own request is normally the last line of the history it reads back.
 */
function checkHistoryDoesNotEchoTheCurrentPrompt() {
  const messages = [
    chat("user", "draw a checkout flow"),
    chat("assistant", "Added 6 nodes.", "AI Architect"),
    chat("user", "now add a refund path"),
  ];

  const history = formatChatHistory(messages, "now add a refund path");

  assert.match(history, /draw a checkout flow/);
  assert.match(history, /Added 6 nodes\./);
  assert.equal(history.includes("now add a refund path"), false);

  // A first turn has nothing behind it, and an empty section must not add a
  // stray heading to the prompt.
  assert.equal(formatChatHistory([chat("user", "hi")], "hi"), "");
  assert.equal(formatChatHistory([], "hi"), "");

  // Same text asked twice is still one prior turn, not zero.
  assert.match(
    formatChatHistory([chat("user", "again"), chat("user", "again")], "again"),
    /again/
  );

  // The request is the last thing the model reads.
  const built = buildDesignPrompt({
    context: EMPTY,
    history: messages,
    prompt: "now add a refund path",
  });

  assert.ok(built.trimEnd().endsWith("Request: now add a refund path"));
  assert.match(built, /Conversation so far/);
}

/**
 * The cursor has to be standing on the thing that is about to appear, and most
 * of a generated plan refers to nodes that did not exist when the run started —
 * so targets must resolve against earlier actions in the same plan, not just
 * against the canvas that was read at the beginning.
 */
function checkCursorTargetsResolveAgainstThePlan() {
  const plan = parseDesignPlan(
    {
      summary: "",
      actions: [
        { type: "addNode", id: "gateway", label: "Gateway", x: 0, y: 0 },
        { type: "addNode", id: "orders", label: "Orders", x: 400, y: 0 },
        { type: "addEdge", source: "gateway", target: "orders" },
      ],
    },
    EMPTY,
  );

  const cursor = createCursorTargets(EMPTY);
  const targets = plan.actions.map((action) => cursor.next(action));

  assert.equal(targets.length, 3);

  const [gateway, orders, edge] = targets;

  assert.ok(gateway && orders && edge);

  // The edge sends the cursor to its *target* node, which this plan created two
  // actions earlier — the case that fails if resolution ignores the plan.
  assert.deepEqual(edge, orders);
  assert.notDeepEqual(edge, gateway);
}

/** An unlocatable subject must not fling the cursor to the origin. */
function checkUnresolvableCursorTargetsDoNotMove() {
  const cursor = createCursorTargets(EMPTY);

  assert.equal(cursor.next({ type: "deleteNode", id: "never-existed" }), null);
  assert.equal(cursor.next({ type: "deleteEdge", id: "never-existed" }), null);
}

/**
 * Pace is derived from the action count so a 60-action plan does not become
 * half a minute of forced watching, and is floored so it never drops under
 * Liveblocks' 200ms storage flush debounce — below that, actions coalesce into
 * one broadcast and the per-action reveal stops existing.
 */
function checkBuildPaceStaysWatchableAtBothEnds() {
  const small = getBuildStepMs(4);
  const large = getBuildStepMs(MAX_DESIGN_ACTIONS);

  assert.ok(large < small, "a bigger plan must move faster per action");
  assert.ok(large >= 220, "pace must not fall under the 200ms flush debounce");

  // The budget is what keeps the whole build watchable rather than endless.
  assert.ok(
    large * MAX_DESIGN_ACTIONS <= AI_BUILD_BUDGET_MS * 1.5,
    "a full-size plan must stay near the build budget",
  );

  // Degenerate inputs still return something usable rather than Infinity.
  assert.ok(Number.isFinite(getBuildStepMs(0)));
  assert.ok(Number.isFinite(getBuildStepMs(-1)));
}

/** Junk in, empty plan out — never a throw, which would fail the whole run. */

/**
 * The reveal must always finish. A rate proportional to the backlog shrinks as
 * it catches up, so the tail is where it can stall: rounding the step *up* is
 * what guarantees a frame always moves at least one character, and the
 * per-frame floor above it is a speed knob rather than the safety net. Swap
 * that rounding for `floor` and the last characters never arrive.
 */
function checkSmoothRevealAlwaysConverges() {
  const target =
    "The gateway fans out to three services, so I will place them in a column and wire each from the gateway.";

  let revealed = 0;
  let frames = 0;

  while (!isFullyRevealed(revealed, target) && frames < 500) {
    const next = nextRevealLength(revealed, target);

    assert.ok(next > revealed, "each frame must make progress");
    revealed = next;
    frames += 1;
  }

  assert.ok(isFullyRevealed(revealed, target), "reveal must reach the end");
  assert.equal(revealed, target.length, "and must not overshoot it");
}

/** Monotonic and clamped, so a reader never sees text un-reveal itself. */
function checkSmoothRevealNeverWalksBackwards() {
  const target = "abcdef";

  // Past the end — a shorter target arriving must clamp, not go negative.
  assert.equal(nextRevealLength(99, target), target.length);
  assert.equal(nextRevealLength(target.length, target), target.length);
  assert.equal(nextRevealLength(-5, ""), 0);

  // An empty target is fully revealed rather than a frame that never settles.
  assert.equal(isFullyRevealed(0, ""), true);
}

/**
 * Stopping mid-word is what makes a reveal look cheap, but chasing a boundary
 * that does not exist is worse — an unbroken token would land in one jump. The
 * lookahead is bounded, so a long token reveals in steady pieces instead.
 */
function checkSmoothRevealPrefersWordBoundaries() {
  const target = "alpha beta gamma delta epsilon zeta eta theta iota kappa";

  let revealed = 0;

  for (let frame = 0; frame < 6 && !isFullyRevealed(revealed, target); frame += 1) {
    revealed = nextRevealLength(revealed, target);

    if (isFullyRevealed(revealed, target)) {
      break;
    }

    const shown = target.slice(0, revealed);

    assert.ok(
      shown.endsWith(" ") || target[revealed] === undefined,
      `partial reveal should stop on a boundary, got "${shown}"`,
    );
  }

  // A single unbroken token still advances, and by less than the whole thing.
  const unbroken = "x".repeat(400);
  const step = nextRevealLength(0, unbroken);

  assert.ok(step > 0 && step < unbroken.length);
}

function checkGarbageNeverThrows() {
  for (const raw of [
    null,
    undefined,
    42,
    "actions",
    [],
    {},
    { actions: null },
    { actions: {} },
    { actions: [null, 1, "x", []] },
    { actions: [{ type: "explode" }, { type: 7 }, {}] },
    { summary: 12, actions: [{ type: "addNode" }] },
  ]) {
    const plan = parseDesignPlan(raw, EMPTY);

    assert.equal(typeof plan.summary, "string");
    assert.ok(Array.isArray(plan.actions));
  }

  assert.equal(parseDesignPlan({ actions: [{ type: "explode" }] }, EMPTY).actions.length, 0);
}

/** Only the eight palette colours and six shapes can ever reach the canvas. */
function checkPaletteAndShapesAreEnforced() {
  const plan = parseDesignPlan(
    {
      summary: "x",
      actions: [
        { type: "addNode", id: "a", color: "#ff0000", shape: "octagon" },
        { type: "addNode", id: "b", color: "TEAL", shape: "Cylinder" },
        { type: "addNode", id: "c", color: "teal", shape: "cylinder" },
      ],
    },
    EMPTY
  );

  const nodes = addedNodes(plan.actions);

  assert.equal(nodes.length, 3);
  assert.deepEqual(
    [nodes[0].data.color, nodes[0].data.shape],
    [DEFAULT_NODE_COLOR, DEFAULT_NODE_SHAPE]
  );
  // Case matters: the palette keys are what nodes store, so a near-miss falls
  // back rather than being coerced into a key that only looks right.
  assert.deepEqual(
    [nodes[1].data.color, nodes[1].data.shape],
    [DEFAULT_NODE_COLOR, DEFAULT_NODE_SHAPE]
  );
  assert.deepEqual([nodes[2].data.color, nodes[2].data.shape], ["teal", "cylinder"]);

  for (const name of NODE_COLOR_NAMES) {
    assert.ok(name in NODE_COLORS);
  }
}

/** Every generated node is a renderable node: right type, real size, real data. */
function checkAddedNodesAreCanvasReady() {
  const plan = parseDesignPlan(
    {
      actions: NODE_SHAPES.map((shape) => ({ type: "addNode", shape, label: "n" })),
    },
    EMPTY
  );

  for (const added of addedNodes(plan.actions)) {
    assert.equal(added.type, CANVAS_NODE_TYPE);
    assert.ok((added.width ?? 0) >= NODE_MIN_SIZE.width);
    assert.ok((added.height ?? 0) >= NODE_MIN_SIZE.height);
    assert.equal(typeof added.data.label, "string");
    assert.ok(NODE_SHAPES.includes(added.data.shape));
  }
}

/** A model naming its own nodes must be able to wire edges between them. */
function checkEdgesResolveNamesInventedInTheSamePlan() {
  const plan = parseDesignPlan(
    {
      actions: [
        { type: "addNode", id: "gateway", label: "Gateway" },
        { type: "addNode", id: "orders db", label: "Orders" },
        { type: "addEdge", source: "gateway", target: "Orders DB", label: "reads" },
        // Unresolvable, self-referential and half-specified edges are dropped
        // rather than written as an edge pointing at nothing.
        { type: "addEdge", source: "gateway", target: "nowhere" },
        { type: "addEdge", source: "gateway", target: "gateway" },
        { type: "addEdge", source: "gateway" },
      ],
    },
    EMPTY
  );

  const nodes = addedNodes(plan.actions);
  const edges = addedEdges(plan.actions);

  assert.equal(edges.length, 1);
  assert.equal(edges[0].source, nodes[0].id);
  assert.equal(edges[0].target, nodes[1].id);
  assert.equal(edges[0].type, CANVAS_EDGE_TYPE);
  assert.equal(edges[0].data?.label, "reads");
  assert.ok(edges[0].markerEnd, "an edge without an arrowhead is not a direction");
}

/** A generated ID can never collide with, or silently replace, an existing one. */
function checkGeneratedIdsAreUnique() {
  const context: DesignContext = { nodes: [node("ai-api", 0, 0)], edges: [] };
  const plan = parseDesignPlan(
    {
      actions: [
        { type: "addNode", id: "api" },
        { type: "addNode", id: "api" },
        { type: "addNode" },
      ],
    },
    context
  );

  const ids = addedNodes(plan.actions).map((added) => added.id);

  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes("ai-api"), "an add must never clobber an existing node");
}

/** An existing node is addressed by its real ID, and only if it exists. */
function checkEditsOnlyTouchNodesThatExist() {
  const context: DesignContext = { nodes: [node("rectangle-abc", 0, 0)], edges: [] };
  const plan = parseDesignPlan(
    {
      actions: [
        { type: "moveNode", id: "rectangle-abc", x: 33, y: 47 },
        { type: "moveNode", id: "rectangle-abc", x: 10 },
        { type: "moveNode", id: "ghost", x: 0, y: 0 },
        { type: "resizeNode", id: "rectangle-abc", width: 1, height: 99999 },
        { type: "updateNodeData", id: "rectangle-abc", label: "Renamed" },
        { type: "updateNodeData", id: "rectangle-abc", color: "chartreuse" },
        { type: "deleteNode", id: "ghost" },
      ],
    },
    context
  );

  assert.deepEqual(
    plan.actions.map((action) => action.type),
    ["moveNode", "resizeNode", "updateNodeData"]
  );

  const [move, resize] = plan.actions;

  assert.equal(move.type === "moveNode" && move.position.x % LAYOUT_GRID, 0);
  assert.equal(move.type === "moveNode" && move.position.y % LAYOUT_GRID, 0);
  assert.ok(resize.type === "resizeNode" && resize.width >= NODE_MIN_SIZE.width);
  assert.ok(resize.type === "resizeNode" && resize.height <= 600);
}

/** Deleting a node takes its edges with it, or they survive pointing at nothing. */
function checkDeletingANodeDeletesItsEdges() {
  const context: DesignContext = {
    nodes: [node("a", 0, 0), node("b", 400, 0), node("c", 800, 0)],
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "a", "c")],
  };
  const plan = parseDesignPlan({ actions: [{ type: "deleteNode", id: "b" }] }, context);
  const deleted = plan.actions.flatMap((action) =>
    action.type === "deleteEdge" ? [action.id] : []
  );

  assert.deepEqual(plan.actions[0], { type: "deleteNode", id: "b" });
  assert.deepEqual(deleted.sort(), ["e1", "e2"]);
}

/** An edge can be deleted by ID or by the pair it connects. */
function checkEdgesCanBeDeletedByEndpoints() {
  const context: DesignContext = {
    nodes: [node("a", 0, 0), node("b", 400, 0)],
    edges: [edge("e1", "a", "b")],
  };

  assert.deepEqual(
    parseDesignPlan({ actions: [{ type: "deleteEdge", id: "e1" }] }, context).actions,
    [{ type: "deleteEdge", id: "e1" }]
  );
  assert.deepEqual(
    parseDesignPlan(
      { actions: [{ type: "deleteEdge", source: "a", target: "b" }] },
      context
    ).actions,
    [{ type: "deleteEdge", id: "e1" }]
  );
  assert.deepEqual(
    parseDesignPlan(
      { actions: [{ type: "deleteEdge", source: "b", target: "a" }] },
      context
    ).actions,
    []
  );
}

/**
 * The layout rules. A model that returns no positions, or the same one for
 * every node, is the common failure and produces one unreadable pile.
 */
function checkGeneratedNodesNeverOverlap() {
  const context: DesignContext = { nodes: [node("existing", 0, 0)], edges: [] };
  const cases = [
    // No positions at all.
    Array.from({ length: 9 }, () => ({ type: "addNode" })),
    // Every node on the same coordinate.
    Array.from({ length: 9 }, () => ({ type: "addNode", x: 0, y: 0 })),
  ];

  for (const actions of cases) {
    const plan = parseDesignPlan({ actions }, context);
    const boxes = addedNodes(plan.actions).map((added) => ({
      x: added.position.x,
      y: added.position.y,
      width: added.width ?? 0,
      height: added.height ?? 0,
    }));

    assert.equal(boxes.length, 9);

    for (const box of boxes) {
      assert.equal(box.x % LAYOUT_GRID, 0, "positions snap to the canvas grid");
      assert.equal(box.y % LAYOUT_GRID, 0);
    }

    const all = [
      ...boxes,
      { x: 0, y: 0, width: 180, height: 80 },
    ];

    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const a = all[i];
        const b = all[j];
        const apart =
          a.x + a.width + MIN_NODE_GAP <= b.x ||
          b.x + b.width + MIN_NODE_GAP <= a.x ||
          a.y + a.height + MIN_NODE_GAP <= b.y ||
          b.y + b.height + MIN_NODE_GAP <= a.y;

        assert.ok(apart, `nodes ${i} and ${j} are closer than the minimum gap`);
      }
    }
  }
}

/**
 * An edge label is centred between the two nodes it connects, so the fallback
 * layout has to leave it somewhere to sit — otherwise the label is drawn across
 * a node and hides the thing it describes.
 */
function checkAutoLayoutLeavesRoomForEdgeLabels() {
  const plan = parseDesignPlan(
    { actions: Array.from({ length: 8 }, () => ({ type: "addNode" })) },
    EMPTY
  );
  const boxes = addedNodes(plan.actions).map((added) => ({
    x: added.position.x,
    y: added.position.y,
    width: added.width ?? 0,
    height: added.height ?? 0,
  }));

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const fits =
        a.x + a.width + EDGE_LABEL_CLEARANCE.width <= b.x ||
        b.x + b.width + EDGE_LABEL_CLEARANCE.width <= a.x ||
        a.y + a.height + EDGE_LABEL_CLEARANCE.height <= b.y ||
        b.y + b.height + EDGE_LABEL_CLEARANCE.height <= a.y;

      assert.ok(fits, `no room for an edge label between nodes ${i} and ${j}`);
    }
  }
}

/** The model cannot avoid an overlap it was never told the dimensions of. */
function checkPromptStatesSizesAndLabelClearance() {
  for (const [shape, size] of Object.entries(NODE_DEFAULT_SIZES)) {
    assert.ok(
      SYSTEM_PROMPT.includes(`${shape} ${size.width}x${size.height}`),
      `the prompt states the default size for ${shape}`
    );
  }

  assert.ok(SYSTEM_PROMPT.includes(String(EDGE_LABEL_CLEARANCE.width)));
  assert.ok(SYSTEM_PROMPT.includes(String(EDGE_LABEL_CLEARANCE.height)));
  assert.ok(SYSTEM_PROMPT.includes(String(MIN_NODE_GAP)));
}

/** One response can only ever spend one bounded write on the canvas. */
function checkActionCountIsCapped() {
  const plan = parseDesignPlan(
    {
      actions: Array.from({ length: MAX_DESIGN_ACTIONS * 3 }, () => ({
        type: "addNode",
      })),
    },
    EMPTY
  );

  assert.equal(addedNodes(plan.actions).length, MAX_DESIGN_ACTIONS);
}

/** Status messages are read by every client, so a malformed one renders as nothing. */
function checkStatusMessagesAreValidated() {
  assert.deepEqual(
    parseAiStatusMessage({ kind: "design", status: "started", runId: "run_1" }),
    { kind: "design", status: "started", runId: "run_1" }
  );
  assert.equal(
    parseAiStatusMessage({ kind: "design", status: "started", runId: "r", text: "hi" })
      ?.text,
    "hi"
  );

  for (const bad of [
    null,
    "started",
    [],
    { kind: "design", status: "started" },
    { kind: "design", status: "thinking", runId: "r" },
    { kind: "diagram", status: "started", runId: "r" },
    { kind: "design", status: "started", runId: "" },
    { kind: "design", status: "started", runId: 7 },
  ]) {
    assert.equal(parseAiStatusMessage(bad), null);
  }

  const long = parseAiStatusMessage({
    kind: "spec",
    status: "error",
    runId: "r",
    text: "x".repeat(5000),
  });

  assert.ok((long?.text?.length ?? 0) < 5000, "a status line cannot reflow the panel");
}

/**
 * What the sidebar actually displays (24-ai-presence-state). Every failure here
 * is silent: a status line that runs backwards, or one that disappears because
 * a message from some other feature landed last, both look like a working
 * panel that is simply quiet.
 */
function checkLatestStatusIsSelectedFromTheFeed() {
  const started = { kind: "design", status: "started", runId: "r", text: "a" };
  const done = { kind: "design", status: "complete", runId: "r", text: "b" };

  assert.equal(selectLatestAiStatus(undefined), null);
  assert.equal(selectLatestAiStatus([]), null);

  // Newest wins regardless of the order the feed hands them over.
  for (const entries of [
    [
      { data: started, createdAt: 1 },
      { data: done, createdAt: 2 },
    ],
    [
      { data: done, createdAt: 2 },
      { data: started, createdAt: 1 },
    ],
  ]) {
    assert.equal(selectLatestAiStatus(entries)?.text, "b");
  }

  // An unreadable entry must not hide the real status, even as the newest.
  assert.equal(
    selectLatestAiStatus([
      { data: started, createdAt: 1 },
      { data: { hello: "world" }, createdAt: 9 },
    ])?.text,
    "a"
  );

  // ...and a feed of nothing but junk is still nothing.
  assert.equal(
    selectLatestAiStatus([{ data: "processing", createdAt: 9 }]),
    null
  );

  // Same millisecond: the later entry is the later write.
  assert.equal(
    selectLatestAiStatus([
      { data: started, createdAt: 5 },
      { data: done, createdAt: 5 },
    ])?.text,
    "b"
  );
}

/**
 * The activity stream is the same trust boundary as the feeds, one step
 * narrower: chunks are written by the task and read by a browser. A chunk this
 * build cannot read has to be dropped, because the alternative is a blank row
 * in a list the user is watching to understand what the AI just did.
 */
function checkActivityPartsAreValidated() {
  for (const invalid of [
    null,
    undefined,
    "reasoning",
    [],
    {},
    { type: "reasoning" },
    { type: "thinking", text: "x" },
    { type: "step", text: 12 },
    { type: "action", text: null },
  ]) {
    assert.equal(parseAiActivityPart(invalid), null, JSON.stringify(invalid));
  }

  assert.deepEqual(parseAiActivityPart({ type: "step", text: "Designing" }), {
    type: "step",
    text: "Designing",
  });

  // A non-string `detail` is dropped rather than rejecting the whole part: the
  // operation name is the load-bearing half and still renders without it.
  assert.deepEqual(
    parseAiActivityPart({ type: "action", text: "addNode", detail: 7 }),
    { type: "action", text: "addNode" },
  );

  assert.deepEqual(
    parseAiActivityPart({ type: "action", text: "addEdge", detail: "a → b" }),
    { type: "action", text: "addEdge", detail: "a → b" },
  );

  // Clamped rather than dropped, so a runaway thinking delta cannot be used to
  // push an unbounded string into the panel.
  const clamped = parseAiActivityPart({
    type: "reasoning",
    text: "x".repeat(9000),
  });

  assert.ok(clamped !== null && clamped.text.length < 9000);
}

/**
 * The model list is a trust boundary now that the composer picks one: the id
 * arrives from a browser and is handed to a paid provider call, so the picker
 * and the worker must agree on exactly which ids exist.
 *
 * Absent and unknown are deliberately different answers. Absent means "the
 * default" — an older caller, a dashboard replay. Unknown is a request this
 * build cannot honour, and guessing at it would spend a run on a model nobody
 * chose.
 */
function checkDesignModelAllowlist() {
  assert.ok(
    AI_DESIGN_MODELS.some((model) => model.id === DEFAULT_AI_DESIGN_MODEL_ID),
    "the default model must be one the picker offers"
  );

  for (const model of AI_DESIGN_MODELS) {
    assert.equal(parseAiDesignModelId(model.id), model.id);
    assert.ok(model.label.length > 0 && model.hint.length > 0);
  }

  assert.equal(parseAiDesignModelId(undefined), null);
  assert.equal(parseAiDesignModelId(null), null);

  // Anything not on the list, however plausible it looks.
  for (const rejected of [
    "gemini-2.5-flash",
    "gemini-3.6-flash-extra",
    "",
    42,
    { id: "gemini-3.6-flash" },
  ]) {
    assert.equal(parseAiDesignModelId(rejected), "invalid");
  }
}

/**
 * The effort allowlist. `minimal` is the one worth naming: Gemini accepts it on
 * Flash and Flash-Lite but rejects it on 3.1 Pro, so offering it would make the
 * effort picker's valid options depend on the model picker's selection.
 */
function checkThinkingLevelAllowlist() {
  assert.ok(
    AI_THINKING_LEVELS.some((level) => level.id === DEFAULT_AI_THINKING_LEVEL),
    "the default effort must be one the picker offers"
  );

  for (const level of AI_THINKING_LEVELS) {
    assert.equal(parseAiThinkingLevel(level.id), level.id);
    assert.ok(level.label.length > 0 && level.hint.length > 0);
  }

  assert.equal(parseAiThinkingLevel(undefined), null);
  assert.equal(parseAiThinkingLevel(null), null);

  for (const rejected of ["minimal", "none", "HIGH", "", 2, { id: "high" }]) {
    assert.equal(parseAiThinkingLevel(rejected), "invalid");
  }
}

/**
 * Cursor-style activity is a timeline, not three buckets. Only adjacent
 * reasoning deltas may be joined; steps and canvas actions stay exactly where
 * the worker emitted them.
 */
function checkActivityTimelinePreservesChronology() {
  const parts: unknown[] = [
    { type: "step", text: "Reading the canvas" },
    { type: "reasoning", text: "Inspecting " },
    { type: "reasoning", text: "existing nodes." },
    { type: "action", text: "addNode", detail: "API" },
    { type: "reasoning", text: "Connecting " },
    { type: "reasoning", text: "the service." },
    { type: "unknown", text: "drop me" },
    { type: "step", text: "Applying to the canvas" },
  ];
  const before = structuredClone(parts);

  assert.deepEqual(selectAiActivityTimeline(parts), [
    { id: "activity-0", type: "step", text: "Reading the canvas" },
    {
      id: "activity-1",
      type: "reasoning",
      text: "Inspecting existing nodes.",
    },
    { id: "activity-3", type: "action", text: "addNode", detail: "API" },
    {
      id: "activity-4",
      type: "reasoning",
      text: "Connecting the service.",
    },
    { id: "activity-7", type: "step", text: "Applying to the canvas" },
  ]);
  assert.deepEqual(parts, before, "selecting a timeline must not mutate stream input");
  assert.deepEqual(selectAiActivityTimeline(undefined), []);
  assert.deepEqual(selectAiActivityTimeline([null, "reasoning", {}]), []);
}

/** The live onData path must accumulate bursty chunks without SDK state races. */
function checkActivityTimelineAppendsIncrementally() {
  let timeline = selectAiActivityTimeline([]);

  timeline = appendAiActivityTimelinePart(
    timeline,
    { type: "step", text: "Reading" },
    0
  );
  timeline = appendAiActivityTimelinePart(
    timeline,
    { type: "reasoning", text: "First " },
    1
  );
  timeline = appendAiActivityTimelinePart(
    timeline,
    { type: "reasoning", text: "second" },
    2
  );
  timeline = appendAiActivityTimelinePart(
    timeline,
    { type: "action", text: "addNode" },
    3
  );

  assert.deepEqual(timeline, [
    { id: "activity-0", type: "step", text: "Reading" },
    { id: "activity-1", type: "reasoning", text: "First second" },
    { id: "activity-3", type: "action", text: "addNode" },
  ]);
  assert.equal(
    isAiActivityTerminalPart({ type: "terminal", phase: "complete" }),
    true
  );
  assert.equal(
    isAiActivityTerminalPart({ type: "terminal", phase: "running" }),
    false
  );
}

/** Completed activity stays attached to the prompt that started it. */
function checkRunTurnsRemainAnchoredForTheSession() {
  const initial: AiRunTurn[] = [];
  const starting = reduceAiRunTurns(initial, {
    type: "start",
    promptMessageId: "chat-1",
    startedAt: 100,
  });
  const running = reduceAiRunTurns(starting, {
    type: "subscribe",
    promptMessageId: "chat-1",
    runId: "run-1",
  });
  const complete = reduceAiRunTurns(running, {
    type: "settle",
    runId: "run-1",
    phase: "complete",
    activity: [
      { id: "activity-0", type: "action", text: "addNode", detail: "API" },
    ],
    completedAt: 200,
  });
  const next = reduceAiRunTurns(complete, {
    type: "start",
    promptMessageId: "chat-2",
    startedAt: 300,
  });

  assert.deepEqual(initial, [], "run state updates do not mutate caller state");
  assert.deepEqual(next, [
    {
      promptMessageId: "chat-1",
      runId: "run-1",
      phase: "complete",
      activity: [
        { id: "activity-0", type: "action", text: "addNode", detail: "API" },
      ],
      startedAt: 100,
      completedAt: 200,
    },
    {
      promptMessageId: "chat-2",
      runId: null,
      phase: "starting",
      activity: [],
      startedAt: 300,
    },
  ]);

  assert.deepEqual(
    reduceAiRunTurns(next, {
      type: "settle",
      runId: "unknown",
      phase: "error",
      activity: [],
      completedAt: 400,
    }),
    next,
    "an unrelated run cannot settle a visible turn"
  );
}

/** The worker must tee live activity into the deterministic assistant message. */
function checkWorkerPersistsLiveActivity(): void {
  const source = readFileSync(
    new URL("../trigger/design-agent.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /createAiRunChatPublisher/);
  assert.match(source, /promptMessageId/);
  assert.doesNotMatch(source, /publishAiChatSummary\(/);
  assert.match(source, /finish\("complete"/);
  assert.match(source, /finish\("error"/);
}

/**
 * Every action type describes itself. A `default` branch means a new action type
 * silently renders as its raw ID, which reads as a bug in the agent rather than
 * a gap in this function — so all seven are asserted.
 */
function checkEveryActionTypeDescribesItself() {
  const added = node("api", 0, 0);
  const wired = edge("api-db", "api", "db");

  const described: Record<DesignAction["type"], string> = {
    addNode: describeDesignAction({ type: "addNode", node: added }),
    moveNode: describeDesignAction({
      type: "moveNode",
      id: "api",
      position: { x: 0, y: 0 },
    }),
    resizeNode: describeDesignAction({
      type: "resizeNode",
      id: "api",
      width: 10,
      height: 10,
    }),
    updateNodeData: describeDesignAction({
      type: "updateNodeData",
      id: "api",
      data: { label: "Gateway" },
    }),
    deleteNode: describeDesignAction({ type: "deleteNode", id: "api" }),
    addEdge: describeDesignAction({ type: "addEdge", edge: wired }),
    deleteEdge: describeDesignAction({ type: "deleteEdge", id: wired.id }),
  };

  for (const [type, description] of Object.entries(described)) {
    assert.ok(description.length > 0, `${type} describes itself`);
  }

  assert.equal(described.addNode, added.data.label);
  assert.equal(described.addEdge, "api → db");
  assert.equal(described.updateNodeData, "Gateway");

  // Falls back to the ID when there is no label to show — a delete has nothing
  // else, and an empty row would be worse than a raw ID.
  assert.equal(described.deleteNode, "api");
}

function main() {
  checkGarbageNeverThrows();
  checkPaletteAndShapesAreEnforced();
  checkAddedNodesAreCanvasReady();
  checkEdgesResolveNamesInventedInTheSamePlan();
  checkGeneratedIdsAreUnique();
  checkEditsOnlyTouchNodesThatExist();
  checkDeletingANodeDeletesItsEdges();
  checkEdgesCanBeDeletedByEndpoints();
  checkGeneratedNodesNeverOverlap();
  checkAutoLayoutLeavesRoomForEdgeLabels();
  checkPromptStatesSizesAndLabelClearance();
  checkActionCountIsCapped();
  checkStatusMessagesAreValidated();
  checkLatestStatusIsSelectedFromTheFeed();
  checkActivityPartsAreValidated();
  checkDesignModelAllowlist();
  checkThinkingLevelAllowlist();
  checkActivityTimelinePreservesChronology();
  checkActivityTimelineAppendsIncrementally();
  checkRunTurnsRemainAnchoredForTheSession();
  checkWorkerPersistsLiveActivity();
  checkEveryActionTypeDescribesItself();
  checkCanvasDescriptionCarriesSizes();
  checkHistoryDoesNotEchoTheCurrentPrompt();
  checkCursorTargetsResolveAgainstThePlan();
  checkUnresolvableCursorTargetsDoNotMove();
  checkBuildPaceStaysWatchableAtBothEnds();
  checkSmoothRevealAlwaysConverges();
  checkSmoothRevealNeverWalksBackwards();
  checkSmoothRevealPrefersWordBoundaries();
  console.log(
    "✅ Design plan validation, palette/shape enforcement, ID resolution, layout spacing, AI status messages, feed selection and run activity verified",
  );
}

try {
  main();
} catch (error) {
  console.error("❌ Design agent verification failed");
  console.error(error);
  process.exitCode = 1;
}
