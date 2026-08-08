import assert from "node:assert/strict";

import {
  SHAPE_DRAG_MIME,
  buildShapeDragPayload,
  createNodeId,
  parseShapeDragPayload,
} from "../lib/canvas-drag";
import {
  CANVAS_TEMPLATES,
  getNodeBox,
  getTemplateBounds,
} from "../components/editor/starter-templates";
import {
  SVG_SHAPES,
  buildShapeGeometry,
  isSvgShape,
} from "../lib/node-shape-geometry";
import { resolveShortcut, type ShortcutKeys } from "../lib/canvas-shortcuts";
import { dedupeByUser, getInitials } from "../lib/presence";
import {
  MAX_SNAPSHOT_NODES,
  canvasBlobPath,
  parseCanvasSnapshot,
  serializeCanvasSnapshot,
} from "../lib/canvas-snapshot";
import {
  CANVAS_EDGE_MARKER,
  CANVAS_EDGE_STYLE,
  CANVAS_NODE_TYPE,
  CONNECTION_SNAP_RADIUS,
  DEFAULT_NODE_COLOR,
  DEFAULT_NODE_SHAPE,
  NODE_DEFAULT_SIZES,
  NODE_MIN_SIZE,
  NODE_SHAPES,
} from "../types/canvas";

/**
 * Checks the two pieces of real logic in 12-shape-panel: the drag payload
 * contract and the node ID generator. Everything else on the canvas is React
 * Flow's, or is data `tsc` already enforces.
 */

/** What the panel writes must be what the drop handler can read back. */
function checkPayloadRoundTrips() {
  for (const shape of NODE_SHAPES) {
    const payload = buildShapeDragPayload(shape);
    const parsed = parseShapeDragPayload(JSON.stringify(payload));

    assert.deepEqual(parsed, payload, `round trip for ${shape}`);
    assert.deepEqual(
      { width: parsed?.width, height: parsed?.height },
      NODE_DEFAULT_SIZES[shape],
      `default size for ${shape}`,
    );
  }
}

/**
 * The size rules the spec names, asserted rather than eyeballed — these are the
 * kind of value a later palette edit silently breaks.
 */
function checkDefaultSizeRules() {
  assert.ok(
    NODE_DEFAULT_SIZES.rectangle.width > NODE_DEFAULT_SIZES.rectangle.height,
    "rectangles are wider than tall",
  );
  assert.equal(
    NODE_DEFAULT_SIZES.circle.width,
    NODE_DEFAULT_SIZES.circle.height,
    "circles are square",
  );
  assert.ok(
    NODE_DEFAULT_SIZES.diamond.width > NODE_DEFAULT_SIZES.rectangle.width &&
      NODE_DEFAULT_SIZES.diamond.height > NODE_DEFAULT_SIZES.rectangle.height,
    "diamonds are larger than rectangles so labels fit the middle",
  );

  for (const shape of NODE_SHAPES) {
    const { width, height } = NODE_DEFAULT_SIZES[shape];
    assert.ok(width > 0 && height > 0, `${shape} has a positive size`);
  }
}

/**
 * The resize floor (14-node-editing). A minimum above any default size would
 * make `NodeResizer` snap a freshly dropped node larger the moment it is
 * grabbed, and the SVG geometry clamps assume a box big enough to draw in.
 */
function checkMinSizeIsBelowEveryDefault() {
  assert.ok(
    NODE_MIN_SIZE.width > 0 && NODE_MIN_SIZE.height > 0,
    "the resize floor is a positive size",
  );

  for (const shape of NODE_SHAPES) {
    const { width, height } = NODE_DEFAULT_SIZES[shape];

    assert.ok(
      width >= NODE_MIN_SIZE.width && height >= NODE_MIN_SIZE.height,
      `${shape} starts at or above the resize floor`,
    );
  }
}

/** A malformed payload must produce no node rather than a broken one. */
function checkBadPayloadsAreRejected() {
  const rejected = [
    "",
    "not json",
    "null",
    "[]",
    '"rectangle"',
    "42",
    "{}",
    '{"shape":"rectangle"}',
    '{"shape":"triangle","width":10,"height":10}',
    '{"shape":"rectangle","width":"10","height":10}',
    '{"shape":"rectangle","width":0,"height":10}',
    '{"shape":"rectangle","width":-5,"height":10}',
    '{"shape":"rectangle","width":null,"height":10}',
  ];

  for (const raw of rejected) {
    assert.equal(
      parseShapeDragPayload(raw),
      null,
      `rejected ${JSON.stringify(raw)}`,
    );
  }
}

/**
 * IDs collide only if the counter is dropped: 500 in a tight loop share a
 * millisecond, which is exactly the same-tick case the counter exists for.
 */
function checkNodeIdsAreUnique() {
  const ids = Array.from({ length: 500 }, () => createNodeId("rectangle"));
  const collaborativeIdPattern =
    /^rectangle-[a-z0-9]+-[a-z0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  assert.equal(new Set(ids).size, ids.length, "node IDs are unique");
  assert.ok(
    ids.every((id) => collaborativeIdPattern.test(id)),
    "node IDs carry the shape, local counter and cross-client UUID entropy",
  );
}

function checkMimeTypeIsSpecific() {
  // A generic type would let any text drag land on the canvas as a node.
  assert.ok(
    SHAPE_DRAG_MIME.startsWith("application/"),
    "the drag MIME type is app-specific",
  );
}

/**
 * Shape geometry (13-node-shape): the paths are drawn from the node's own size,
 * so the failure mode is a coordinate landing outside the SVG box — or `NaN`
 * from a missing measurement — and either one renders as an invisible node.
 */
function checkShapeGeometryStaysInsideTheNode() {
  const strokeWidth = 2.5;

  for (const shape of SVG_SHAPES) {
    // Checked at the default size and at a deliberately squashed one, where the
    // clamps on the hexagon notch and cylinder rim are what keep it in bounds.
    for (const size of [NODE_DEFAULT_SIZES[shape], { width: 40, height: 16 }]) {
      const { outline, detail } = buildShapeGeometry(shape, size, strokeWidth);
      const limit = Math.max(size.width, size.height);

      for (const path of [outline, detail ?? outline]) {
        const numbers = path.match(/-?\d+(\.\d+)?/g) ?? [];

        assert.ok(numbers.length > 0, `${shape} path has coordinates`);
        assert.ok(
          numbers.every((value) => {
            const parsed = Number(value);

            return Number.isFinite(parsed) && parsed >= 0 && parsed <= limit;
          }),
          `${shape} at ${size.width}x${size.height} stays inside its box: ${path}`,
        );
      }
    }
  }

  // The rim is the cylinder's alone; the flat shapes would draw a stray line.
  assert.ok(
    buildShapeGeometry("cylinder", NODE_DEFAULT_SIZES.cylinder, strokeWidth)
      .detail,
    "the cylinder has a front rim",
  );
  assert.equal(
    buildShapeGeometry("diamond", NODE_DEFAULT_SIZES.diamond, strokeWidth)
      .detail,
    undefined,
    "the diamond has no rim",
  );

  // Anything not in SVG_SHAPES falls to the CSS branch, which only has a radius
  // for the three flat shapes — a miscount there is a runtime undefined.
  assert.deepEqual(
    NODE_SHAPES.filter(isSvgShape).toSorted(),
    [...SVG_SHAPES].toSorted(),
    "exactly diamond, hexagon and cylinder render as SVG",
  );
}

/**
 * Edge defaults (16-edge-behavior). These are written into Liveblocks Storage
 * on connect, so a drifted value is baked into every edge created afterwards —
 * and a hardcoded hex or a mismatched arrowhead colour is invisible in review
 * but obvious on the canvas.
 */
function checkEdgeDefaultsAreConsistent() {
  assert.equal(
    CANVAS_EDGE_MARKER.color,
    CANVAS_EDGE_STYLE.stroke,
    "the arrowhead is the same colour as the stroke it terminates",
  );

  for (const value of [CANVAS_EDGE_STYLE.stroke, CANVAS_EDGE_MARKER.color]) {
    assert.match(
      String(value),
      /^var\(--[a-z-]+\)$/,
      `edge colour ${String(value)} is a palette token, not a literal`,
    );
  }

  assert.ok(
    typeof CANVAS_EDGE_STYLE.strokeWidth === "number" &&
      CANVAS_EDGE_STYLE.strokeWidth > 0 &&
      CANVAS_EDGE_STYLE.strokeWidth <= 2,
    "edges stay thin enough to read as secondary to nodes",
  );
}

/**
 * The connection snap radius (16-edge-behavior). Handles sit at the midpoint of
 * each side, so the furthest a release inside a node can be from its nearest
 * handle is `min(width, height) / 2` — from the dead centre to whichever pair
 * of sides is closer. If the radius drops below that for any shape, releasing
 * in the middle of that node connects to nothing and the drag is discarded,
 * which reads as "connections don't work" rather than as a tuning problem.
 *
 * Enlarging a default node size is what would silently break this.
 */
function checkSnapRadiusCoversEveryNodeCentre() {
  for (const shape of NODE_SHAPES) {
    const { width, height } = NODE_DEFAULT_SIZES[shape];
    const centreToNearestHandle = Math.min(width, height) / 2;

    assert.ok(
      CONNECTION_SNAP_RADIUS > centreToNearestHandle,
      `a release in the centre of a ${shape} (${centreToNearestHandle}px from its nearest handle) is inside the ${CONNECTION_SNAP_RADIUS}px snap radius`,
    );
  }
}

/**
 * The shortcut table (17-canvas-ergonomics). Every entry is one branch that
 * fails silently: a miss does nothing at all, and an over-eager match steals a
 * keystroke the browser or the OS owns.
 */
function checkShortcutsMatchTheSpecTable() {
  const press = (keys: Partial<ShortcutKeys> & { key: string }) =>
    resolveShortcut({
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      ...keys,
    });

  assert.equal(press({ key: "+" }), "zoom-in");
  assert.equal(press({ key: "+", shiftKey: true }), "zoom-in");
  assert.equal(press({ key: "=" }), "zoom-in");
  assert.equal(press({ key: "-" }), "zoom-out");

  for (const modifier of ["metaKey", "ctrlKey"] as const) {
    assert.equal(press({ key: "z", [modifier]: true }), "undo");
    assert.equal(press({ key: "Z", [modifier]: true }), "undo");
    assert.equal(press({ key: "z", [modifier]: true, shiftKey: true }), "redo");
    assert.equal(press({ key: "y", [modifier]: true }), "redo");

    // Zooming is unmodified only: Cmd/Ctrl +/- is the browser's own page zoom.
    assert.equal(press({ key: "+", [modifier]: true }), null);
    assert.equal(press({ key: "-", [modifier]: true }), null);
  }

  for (const key of ["a", "Delete", "Escape", "ArrowUp", "_", "Z"]) {
    assert.equal(press({ key }), null, `${key} is not a canvas shortcut`);
  }
}

/**
 * The starter templates (18-starter-templates). This is hand-written data that
 * nothing type-checks past its shape: an edge naming a node that is not in the
 * template renders as nothing at all, and a duplicate ID makes React Flow drop
 * a node — both silent, and both invisible in a preview that "looks fine".
 */
function checkTemplatesAreWellFormed() {
  assert.ok(CANVAS_TEMPLATES.length >= 3, "at least three templates ship");

  const templateIds = CANVAS_TEMPLATES.map((template) => template.id);
  assert.equal(
    new Set(templateIds).size,
    templateIds.length,
    "template IDs are unique",
  );

  // Node IDs are namespaced by template rather than generated, so uniqueness is
  // checked across the whole library, not just within one template.
  const nodeIds = CANVAS_TEMPLATES.flatMap((template) =>
    template.nodes.map((node) => node.id),
  );
  assert.equal(
    new Set(nodeIds).size,
    nodeIds.length,
    "node IDs are unique across every template",
  );

  for (const template of CANVAS_TEMPLATES) {
    assert.ok(template.name.length > 0, `${template.id} has a name`);
    assert.ok(
      template.description.length > 0,
      `${template.id} has a description`,
    );
    assert.ok(template.nodes.length > 0, `${template.id} has nodes`);
    assert.ok(template.edges.length > 0, `${template.id} has edges`);

    const ids = new Set(template.nodes.map((node) => node.id));

    for (const edge of template.edges) {
      assert.ok(ids.has(edge.source), `${edge.id} has a real source`);
      assert.ok(ids.has(edge.target), `${edge.id} has a real target`);
      assert.notEqual(edge.source, edge.target, `${edge.id} is not a self-loop`);
    }

    const edgeIds = template.edges.map((edge) => edge.id);
    assert.equal(
      new Set(edgeIds).size,
      edgeIds.length,
      `${template.id} has unique edge IDs`,
    );
  }
}

/**
 * Preview fitting is a `viewBox` built from these bounds, so a box that does not
 * enclose every node crops the preview silently — and a zero-size one on an
 * empty template divides the browser's aspect fit by nothing.
 */
/**
 * The avatar fallback is the only thing standing between a photo-less
 * collaborator and an empty circle, and an empty circle looks like a rendering
 * bug rather than a person. Every one of these degrades silently.
 */
function checkInitialsAlwaysRenderSomething() {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["Ada Lovelace", "AL"],
    ["ada lovelace", "AL"],
    ["Cher", "C"],
    // Third word and beyond are dropped, not folded in.
    ["Ada King Lovelace", "AK"],
    ["  Ada   Lovelace  ", "AL"],
    ["ada@example.com", "A"],
    ["", "?"],
    ["   ", "?"],
  ];

  for (const [name, expected] of cases) {
    assert.equal(
      getInitials(name),
      expected,
      `getInitials(${JSON.stringify(name)}) should be ${expected}`,
    );
  }
}

function checkAvatarsAreOnePerPerson() {
  // Two tabs for `user_ada`, one for `user_grace` — three connections, two
  // people. This is the case that put duplicate avatars in the navbar.
  const connections = [
    { id: "user_ada", connectionId: 1 },
    { id: "user_grace", connectionId: 2 },
    { id: "user_ada", connectionId: 3 },
  ];

  const people = dedupeByUser(connections);

  // `Map` keeps a key at its first insertion while later writes replace the
  // value, so Ada holds her original slot and does not jump down the stack when
  // she opens another tab.
  assert.deepEqual(
    people.map((person) => person.id),
    ["user_ada", "user_grace"],
    "a person with several tabs is one avatar, in their original position",
  );
  assert.equal(
    people.find((person) => person.id === "user_ada")?.connectionId,
    3,
    "the most recent connection wins for a duplicated person",
  );

  // An ID-less connection cannot be attributed to anyone, so it must not
  // collapse into another one — that would silently hide a participant.
  const anonymous = dedupeByUser([
    { connectionId: 4 },
    { connectionId: 5 },
    { id: "user_ada", connectionId: 6 },
  ]);

  assert.equal(
    anonymous.length,
    3,
    "connections with no user ID stay separate entries",
  );

  assert.deepEqual(dedupeByUser([]), [], "an empty room dedupes to nothing");
}

function checkSnapshotsRejectJunkAndSurviveRoundTrips() {
  const validNode = {
    id: "node-1",
    type: CANVAS_NODE_TYPE,
    position: { x: 10, y: 20 },
    width: 180,
    height: 80,
    data: { label: "API", color: "blue", shape: "rectangle" },
  };

  const roundTripped = parseCanvasSnapshot(
    JSON.parse(
      serializeCanvasSnapshot(
        parseCanvasSnapshot({ nodes: [validNode], edges: [] })!,
      ),
    ),
  );

  assert.equal(roundTripped?.nodes.length, 1, "a valid node survives a round trip");
  assert.deepEqual(
    roundTripped?.nodes[0]?.data,
    { label: "API", color: "blue", shape: "rectangle" },
    "node data is preserved verbatim",
  );

  // Anything that is not a `{ nodes, edges }` envelope is rejected outright.
  for (const junk of [null, undefined, 42, "{}", [], {}, { nodes: [] }, { edges: [] }]) {
    assert.equal(
      parseCanvasSnapshot(junk),
      null,
      `${JSON.stringify(junk) ?? "undefined"} is not a snapshot`,
    );
  }

  // A single malformed entry is dropped; the rest of the diagram still loads.
  const partial = parseCanvasSnapshot({
    nodes: [
      validNode,
      { id: "no-position" },
      { id: "nan", position: { x: Number.NaN, y: 0 } },
      { position: { x: 1, y: 1 } },
      // Duplicate ID: the first wins, the second is dropped.
      { ...validNode, data: { ...validNode.data, label: "Impostor" } },
    ],
    edges: [],
  });

  assert.equal(partial?.nodes.length, 1, "malformed and duplicate nodes are dropped");
  assert.equal(partial?.nodes[0]?.data.label, "API", "the first node of an ID wins");

  // An unknown colour or shape degrades rather than failing the snapshot.
  const degraded = parseCanvasSnapshot({
    nodes: [{ ...validNode, data: { label: "x", color: "chartreuse", shape: "blob" } }],
    edges: [],
  });

  assert.equal(degraded?.nodes[0]?.data.color, DEFAULT_NODE_COLOR);
  assert.equal(degraded?.nodes[0]?.data.shape, DEFAULT_NODE_SHAPE);

  // Edges are only kept when both endpoints are in the same snapshot.
  const withEdges = parseCanvasSnapshot({
    nodes: [validNode, { ...validNode, id: "node-2" }],
    edges: [
      { id: "edge-1", source: "node-1", target: "node-2", data: { label: "calls" } },
      { id: "edge-2", source: "node-1", target: "missing" },
      { id: "edge-3", source: "ghost", target: "node-2" },
    ],
  });

  assert.equal(withEdges?.edges.length, 1, "edges to absent nodes are dropped");
  assert.equal(withEdges?.edges[0]?.data?.label, "calls");
  assert.deepEqual(
    withEdges?.edges[0]?.style,
    CANVAS_EDGE_STYLE,
    "edge style comes from the constant, not from the stored blob",
  );

  // The size ceiling rejects the whole payload rather than truncating it.
  const oversized = {
    nodes: Array.from({ length: MAX_SNAPSHOT_NODES + 1 }, (_, index) => ({
      ...validNode,
      id: `node-${index}`,
    })),
    edges: [],
  };

  assert.equal(
    parseCanvasSnapshot(oversized),
    null,
    "a snapshot above the node ceiling is rejected",
  );

  assert.equal(canvasBlobPath("my-project"), "canvas/my-project.json");
}

function checkTemplateBoundsEncloseEveryNode() {
  assert.deepEqual(
    getTemplateBounds([]),
    { x: 0, y: 0, width: 0, height: 0 },
    "an empty template has a zero box rather than an Infinity one",
  );

  for (const template of CANVAS_TEMPLATES) {
    const bounds = getTemplateBounds(template.nodes);

    assert.ok(
      bounds.width > 0 && bounds.height > 0,
      `${template.id} has a positive bounding box`,
    );

    for (const node of template.nodes) {
      const box = getNodeBox(node);

      assert.ok(
        box.width > 0 && box.height > 0,
        `${node.id} has a resolved size`,
      );
      assert.ok(
        box.x >= bounds.x &&
          box.y >= bounds.y &&
          box.x + box.width <= bounds.x + bounds.width &&
          box.y + box.height <= bounds.y + bounds.height,
        `${node.id} is inside ${template.id}'s bounding box`,
      );
    }
  }
}

function main() {
  checkPayloadRoundTrips();
  checkDefaultSizeRules();
  checkMinSizeIsBelowEveryDefault();
  checkBadPayloadsAreRejected();
  checkNodeIdsAreUnique();
  checkMimeTypeIsSpecific();
  checkShapeGeometryStaysInsideTheNode();
  checkEdgeDefaultsAreConsistent();
  checkSnapRadiusCoversEveryNodeCentre();
  checkShortcutsMatchTheSpecTable();
  checkTemplatesAreWellFormed();
  checkTemplateBoundsEncloseEveryNode();
  checkInitialsAlwaysRenderSomething();
  checkAvatarsAreOnePerPerson();
  checkSnapshotsRejectJunkAndSurviveRoundTrips();
  console.log(
    "✅ Canvas shape drag contract, shape geometry, edge defaults, shortcuts, starter templates, presence initials/dedupe and snapshot validation verified",
  );
}

try {
  main();
} catch (error) {
  console.error("❌ Canvas verification failed");
  console.error(error);
  process.exitCode = 1;
}
