import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSmoothStepPath, Position } from "@xyflow/react";

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
  getParallelEdgeLabelOffset,
  positionParallelEdgeLabel,
} from "../lib/edge-label-layout";
import { computeEdgeRoutes } from "../lib/canvas-edge-route";
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
  type NodeShape,
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
 * The arrowhead survives a server-side write.
 *
 * `types/canvas.ts` is imported by the AI write path, which runs in a server
 * bundle. @xyflow/react carries "use client", so any *value* read from it there
 * is a client reference rather than the real export: `MarkerType.ArrowClosed`
 * came back `undefined`, every generated edge stored a marker with no `type`,
 * and React Flow built no arrowhead symbol for it. Only a type-only import is
 * safe in this module.
 */
function checkMarkerSurvivesServerBundling() {
  assert.equal(
    CANVAS_EDGE_MARKER.type,
    "arrowclosed",
    "generated edges carry a marker type React Flow can resolve",
  );

  const source = readFileSync(
    new URL("../types/canvas.ts", import.meta.url),
    "utf8",
  );

  for (const line of source.split("\n")) {
    if (!line.includes('from "@xyflow/react"')) {
      continue;
    }

    assert.match(
      line,
      /^import type /,
      "types/canvas.ts reads no runtime value from the client-only React Flow package",
    );
  }
}

/** Parallel relationships keep every label visible, including reverse flows. */
function checkParallelEdgeLabelsUseSeparateLanes() {
  const edges = [
    { id: "request", source: "client", target: "api" },
    { id: "response", source: "api", target: "client" },
    { id: "security", source: "client", target: "api" },
  ];
  const offsets = edges
    .map((edge) => getParallelEdgeLabelOffset(edge, edges))
    .toSorted((a, b) => a - b);

  assert.equal(
    new Set(offsets).size,
    edges.length,
    "labels between the same two nodes occupy separate lanes",
  );

  for (let index = 1; index < offsets.length; index += 1) {
    assert.ok(
      offsets[index] - offsets[index - 1] >= 24,
      "adjacent lanes clear the measured height of an edge-label pill",
    );
  }
}

/** Route lanes and label lanes must reinforce each other after rendering. */
function checkParallelEdgeRenderedLabelsStayClear() {
  const nodes = [node("client", 0, 0), node("api", 600, 0)];
  const edges = [
    { id: "z", source: "client", target: "api" },
    { id: "m", source: "api", target: "client" },
    { id: "a", source: "client", target: "api" },
  ];
  const routes = computeEdgeRoutes(nodes as never, edges as never);
  const renderedLabelYs = edges
    .map((edge) => {
      const route = routes.get(edge.id)!;
      const [, , labelY] = getSmoothStepPath({
        sourceX: route.source.x,
        sourceY: route.source.y,
        sourcePosition:
          route.source.side === "right" ? Position.Right : Position.Left,
        targetX: route.target.x,
        targetY: route.target.y,
        targetPosition:
          route.target.side === "right" ? Position.Right : Position.Left,
        centerX: route.centerX,
        centerY: route.centerY,
      });

      return labelY + getParallelEdgeLabelOffset(edge, edges);
    })
    .toSorted((a, b) => a - b);

  for (let index = 1; index < renderedLabelYs.length; index += 1) {
    assert.ok(
      renderedLabelYs[index] - renderedLabelYs[index - 1] >= 24,
      "shuffled and reverse parallel edges keep rendered label pills clear",
    );
  }
}

/** Narrow vertical routes stagger by pill height, not by unknown label width. */
function checkVerticalParallelEdgeLabelsStayClear() {
  const nodes = [
    { ...node("top", 0, 0), width: 72, height: 48 },
    { ...node("bottom", 0, 400), width: 72, height: 48 },
  ];
  const edges = [
    { id: "z", source: "top", target: "bottom" },
    { id: "m", source: "bottom", target: "top" },
    { id: "a", source: "top", target: "bottom" },
  ];
  const routes = computeEdgeRoutes(nodes as never, edges as never);
  const renderedLabelYs = edges
    .map((edge) => {
      const route = routes.get(edge.id)!;
      const [, labelX, labelY] = getSmoothStepPath({
        sourceX: route.source.x,
        sourceY: route.source.y,
        sourcePosition:
          route.source.side === "bottom" ? Position.Bottom : Position.Top,
        targetX: route.target.x,
        targetY: route.target.y,
        targetPosition:
          route.target.side === "bottom" ? Position.Bottom : Position.Top,
        centerX: route.centerX,
        centerY: route.centerY,
      });

      return positionParallelEdgeLabel({
        labelX,
        labelY,
        offset: getParallelEdgeLabelOffset(edge, edges),
      }).y;
    })
    .toSorted((a, b) => a - b);

  for (let index = 1; index < renderedLabelYs.length; index += 1) {
    assert.ok(
      renderedLabelYs[index] - renderedLabelYs[index - 1] >= 24,
      "vertical edge labels clear each other by the pill height",
    );
  }
}

/** Generated edge lanes meet the visible outline of every supported shape. */
function checkGeneratedEdgesMeetEveryShapeOutline() {
  for (const shape of NODE_SHAPES) {
    const edges = ["a", "m", "z"].map((id) => ({
      id,
      source: "source",
      target: "target",
    }));
    const horizontalNodes = [
      resizedShapeNode("source", shape, 0, 0),
      resizedShapeNode("target", shape, 500, 0),
    ];
    const horizontal = computeEdgeRoutes(
      horizontalNodes as never,
      edges as never,
    ).get("a")!;

    assertEndpointOnShape(horizontal.source, horizontalNodes[0], "right");
    assertEndpointOnShape(horizontal.target, horizontalNodes[1], "left");

    const verticalNodes = [
      resizedShapeNode("source", shape, 0, 0),
      resizedShapeNode("target", shape, 0, 500),
    ];
    const vertical = computeEdgeRoutes(
      verticalNodes as never,
      edges as never,
    ).get("a")!;

    assertEndpointOnShape(vertical.source, verticalNodes[0], "bottom");
    assertEndpointOnShape(vertical.target, verticalNodes[1], "top");
  }
}

function assertEndpointOnShape(
  endpoint: { x: number; y: number; side: string },
  shapeNode: ReturnType<typeof resizedShapeNode>,
  side: "top" | "right" | "bottom" | "left",
) {
  const centerX = shapeNode.position.x + shapeNode.width / 2;
  const centerY = shapeNode.position.y + shapeNode.height / 2;
  const offset =
    side === "left" || side === "right"
      ? endpoint.y - centerY
      : endpoint.x - centerX;
  const radius = expectedShapeRadius(
    shapeNode.data.shape,
    shapeNode,
    side,
    offset,
  );
  const expected =
    side === "left"
      ? { x: centerX - radius, y: centerY + offset }
      : side === "right"
        ? { x: centerX + radius, y: centerY + offset }
        : side === "top"
          ? { x: centerX + offset, y: centerY - radius }
          : { x: centerX + offset, y: centerY + radius };

  assert.equal(endpoint.side, side, `${shapeNode.data.shape} uses ${side}`);
  assert.ok(
    Math.abs(endpoint.x - expected.x) < 0.001 &&
      Math.abs(endpoint.y - expected.y) < 0.001,
    `${shapeNode.data.shape} ${side} endpoint meets its resized outline`,
  );
}

function expectedShapeRadius(
  shape: NodeShape,
  box: { width: number; height: number },
  side: "top" | "right" | "bottom" | "left",
  offset: number,
): number {
  const horizontalSide = side === "left" || side === "right";
  const alongRadius = horizontalSide ? box.width / 2 : box.height / 2;
  const crossRadius = horizontalSide ? box.height / 2 : box.width / 2;
  const distance = Math.abs(offset);
  const ellipseFactor = (radius: number) =>
    Math.sqrt(Math.max(0, 1 - (distance / radius) ** 2));

  switch (shape) {
    case "rectangle":
      return alongRadius;
    case "diamond":
      return alongRadius * (1 - distance / crossRadius);
    case "circle":
      return alongRadius * ellipseFactor(crossRadius);
    case "pill": {
      const radius = Math.min(box.width / 2, box.height / 2);
      const cornerDistance = Math.max(0, distance - (crossRadius - radius));

      return (
        alongRadius -
        radius +
        Math.sqrt(Math.max(0, radius ** 2 - cornerDistance ** 2))
      );
    }
    case "hexagon": {
      const notch = box.width * 0.2;

      if (horizontalSide) {
        return alongRadius - notch * (distance / crossRadius);
      }

      return distance <= crossRadius - notch
        ? alongRadius
        : alongRadius * ((crossRadius - distance) / notch);
    }
    case "cylinder": {
      const capRadius = Math.min(box.height * 0.16, box.height / 2);

      if (!horizontalSide) {
        return alongRadius - capRadius + capRadius * ellipseFactor(crossRadius);
      }

      const capDistance = Math.max(0, distance - (crossRadius - capRadius));

      return (
        alongRadius * Math.sqrt(Math.max(0, 1 - (capDistance / capRadius) ** 2))
      );
    }
  }
}

/**
 * A fan-out is the case the fixed top-handle default handles worst: one node
 * feeding a column of others sends every line out of, and into, the same point.
 */
function checkFanOutEdgesLeaveOnSeparateLanes() {
  const nodes = [
    node("web", 0, 300),
    node("catalog", 600, 0),
    node("uploads", 600, 300),
    node("content", 600, 600),
  ];
  const edges = ["catalog", "uploads", "content"].map((target) => ({
    id: `web-${target}`,
    source: "web",
    target,
  }));
  const routes = computeEdgeRoutes(nodes as never, edges as never);
  const fanOut = edges.map((edge) => routes.get(edge.id)!);

  assert.equal(fanOut.length, 3);

  for (const route of fanOut) {
    assert.equal(
      route.source.side,
      "right",
      "a target to the right is reached sideways",
    );
    assert.equal(route.target.side, "left", "and arrives on the target's left");
  }

  assert.equal(
    new Set(fanOut.map((route) => route.source.y)).size,
    fanOut.length,
    "each line leaves the source on its own lane",
  );
  assert.equal(
    new Set(fanOut.map((route) => route.centerX)).size,
    fanOut.length,
    "and turns in its own corridor, so the lanes do not merge again",
  );

  // Lanes run in the order the targets are stacked, so no two lines swap places
  // between leaving and arriving.
  const byTarget = [...fanOut].sort((a, b) => a.target.y - b.target.y);
  assert.deepEqual(
    byTarget.map((route) => route.source.y),
    [...byTarget.map((route) => route.source.y)].sort((a, b) => a - b),
    "lanes keep the order of the column they run to",
  );
}

/** A hand-drawn edge names its handles, and that choice outranks the router. */
function checkHandPickedHandlesAreLeftAlone() {
  const routes = computeEdgeRoutes(
    [node("a", 0, 0), node("b", 400, 0)] as never,
    [
      {
        id: "chosen",
        source: "a",
        target: "b",
        sourceHandle: "bottom",
        targetHandle: "top",
      },
      { id: "auto", source: "a", target: "b" },
    ] as never,
  );

  assert.equal(routes.get("chosen"), undefined);
  assert.ok(routes.get("auto"));
}

function node(id: string, x: number, y: number) {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y },
    width: 180,
    height: 100,
    data: { label: id, color: DEFAULT_NODE_COLOR, shape: DEFAULT_NODE_SHAPE },
  };
}

function shapedNode(id: string, shape: NodeShape, x: number, y: number) {
  const { width, height } = NODE_DEFAULT_SIZES[shape];

  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y },
    width,
    height,
    data: { label: id, color: DEFAULT_NODE_COLOR, shape },
  };
}

function resizedShapeNode(id: string, shape: NodeShape, x: number, y: number) {
  return {
    ...shapedNode(id, shape, x, y),
    width: 120,
    height: 72,
  };
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
      assert.notEqual(
        edge.source,
        edge.target,
        `${edge.id} is not a self-loop`,
      );
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

  assert.equal(
    roundTripped?.nodes.length,
    1,
    "a valid node survives a round trip",
  );
  assert.deepEqual(
    roundTripped?.nodes[0]?.data,
    { label: "API", color: "blue", shape: "rectangle" },
    "node data is preserved verbatim",
  );

  // Anything that is not a `{ nodes, edges }` envelope is rejected outright.
  for (const junk of [
    null,
    undefined,
    42,
    "{}",
    [],
    {},
    { nodes: [] },
    { edges: [] },
  ]) {
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

  assert.equal(
    partial?.nodes.length,
    1,
    "malformed and duplicate nodes are dropped",
  );
  assert.equal(
    partial?.nodes[0]?.data.label,
    "API",
    "the first node of an ID wins",
  );

  // An unknown colour or shape degrades rather than failing the snapshot.
  const degraded = parseCanvasSnapshot({
    nodes: [
      {
        ...validNode,
        data: { label: "x", color: "chartreuse", shape: "blob" },
      },
    ],
    edges: [],
  });

  assert.equal(degraded?.nodes[0]?.data.color, DEFAULT_NODE_COLOR);
  assert.equal(degraded?.nodes[0]?.data.shape, DEFAULT_NODE_SHAPE);

  // Edges are only kept when both endpoints are in the same snapshot.
  const withEdges = parseCanvasSnapshot({
    nodes: [validNode, { ...validNode, id: "node-2" }],
    edges: [
      {
        id: "edge-1",
        source: "node-1",
        target: "node-2",
        data: { label: "calls" },
      },
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

function checkCanvasBrandingIsHidden() {
  const source = readFileSync(
    new URL("../components/canvas/canvas.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /proOptions=\{\{\s*hideAttribution:\s*true\s*}}/,
    "the bottom-right React Flow attribution box stays hidden",
  );
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
  checkMarkerSurvivesServerBundling();
  checkFanOutEdgesLeaveOnSeparateLanes();
  checkHandPickedHandlesAreLeftAlone();
  checkParallelEdgeLabelsUseSeparateLanes();
  checkParallelEdgeRenderedLabelsStayClear();
  checkVerticalParallelEdgeLabelsStayClear();
  checkGeneratedEdgesMeetEveryShapeOutline();
  checkSnapRadiusCoversEveryNodeCentre();
  checkShortcutsMatchTheSpecTable();
  checkTemplatesAreWellFormed();
  checkTemplateBoundsEncloseEveryNode();
  checkInitialsAlwaysRenderSomething();
  checkAvatarsAreOnePerPerson();
  checkSnapshotsRejectJunkAndSurviveRoundTrips();
  checkCanvasBrandingIsHidden();
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
