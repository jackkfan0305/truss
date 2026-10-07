import assert from "node:assert/strict";
import {
  getAbsoluteBounds,
  getBoundaryInterior,
  collectDescendantIds,
  sortParentsBeforeChildren,
} from "../lib/canvas-hierarchy";
import { CANVAS_BOUNDARY_TYPE, CANVAS_NODE_TYPE, type CanvasNode } from "@/types/canvas";

// Test fixtures
const child: CanvasNode = {
  id: "child",
  type: CANVAS_NODE_TYPE,
  position: { x: 24, y: 64 },
  width: 180,
  height: 80,
  parentId: "parent",
  data: { label: "Child", shape: "rectangle", color: "neutral" },
};

const parent: CanvasNode = {
  id: "parent",
  type: CANVAS_BOUNDARY_TYPE,
  position: { x: 100, y: 200 },
  width: 400,
  height: 240,
  data: { label: "Parent", shape: "rectangle", color: "neutral", kind: "boundary", catalogId: "boundary-vpc" },
};

// Test absolute bounds
const bounds = getAbsoluteBounds("child", [child, parent]);
assert.deepEqual(bounds, { x: 124, y: 264, width: 180, height: 80 });

// Test sorting
const sorted = sortParentsBeforeChildren([child, parent]);
assert.deepEqual(
  sorted.map((n) => n.id),
  ["parent", "child"],
);

// Test descendants
const descendants = collectDescendantIds("parent", [child, parent]);
assert.deepEqual([...descendants], ["child"]);

// Test cycle detection
assert.throws(
  () => {
    const cycled = [
      { ...parent, parentId: "child" },
      { ...child, parentId: "parent" },
    ];
    sortParentsBeforeChildren(cycled);
  },
  /cycle/i,
  "Should detect cycle in sorting",
);

// Test two-boundary cycle
const boundary1 = { ...parent, id: "b1", parentId: "b2" };
const boundary2 = { ...parent, id: "b2", parentId: "b1" };
assert.throws(
  () => sortParentsBeforeChildren([boundary1, boundary2]),
  /cycle/i,
  "Should detect cycle between boundaries",
);

// Test non-boundary parent rejection in containment
const childWithNonBoundaryParent = { ...child, parentId: "not-a-boundary" };
const notBoundary: CanvasNode = { ...child, id: "not-a-boundary", type: CANVAS_NODE_TYPE };
assert.throws(
  () => getAbsoluteBounds("child", [childWithNonBoundaryParent, notBoundary]),
  /not found/i,
  "Should handle non-existent parent",
);

// Test boundary interior
const interior = getBoundaryInterior("parent", [child, parent]);
assert.ok(interior.x === 124, "Interior x should account for padding");
assert.ok(interior.y === 240, "Interior y should account for title height");

console.log("✓ All canvas hierarchy tests passed");
