import assert from "node:assert/strict";

import {
  SHAPE_DRAG_MIME,
  buildShapeDragPayload,
  createNodeId,
  parseShapeDragPayload,
} from "../lib/canvas-drag";
import { NODE_DEFAULT_SIZES, NODE_SHAPES } from "../types/canvas";

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

  assert.equal(new Set(ids).size, ids.length, "node IDs are unique");
  assert.ok(
    ids.every((id) => id.startsWith("rectangle-")),
    "node IDs carry the shape name",
  );
}

function checkMimeTypeIsSpecific() {
  // A generic type would let any text drag land on the canvas as a node.
  assert.ok(
    SHAPE_DRAG_MIME.startsWith("application/"),
    "the drag MIME type is app-specific",
  );
}

function main() {
  checkPayloadRoundTrips();
  checkDefaultSizeRules();
  checkBadPayloadsAreRejected();
  checkNodeIdsAreUnique();
  checkMimeTypeIsSpecific();
  console.log("✅ Canvas shape drag contract verified");
}

try {
  main();
} catch (error) {
  console.error("❌ Canvas verification failed");
  console.error(error);
  process.exitCode = 1;
}
