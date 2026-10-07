import assert from "node:assert/strict";

import { createSnapshotFlow } from "../lib/agent-canvas-write";
import {
  parseCanvasReadResponse,
  type RemoteCanvas,
} from "../lib/canvas-client";
import {
  canonicalCanvasPayload,
  parseCanvasVersion,
  parseCanvasWrite,
  type CanvasSnapshot,
} from "../lib/canvas-snapshot";
import { CANVAS_NODE_TYPE, type CanvasNode } from "../types/canvas";

function node(id: string, x = 0): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y: 0 },
    width: 160,
    height: 80,
    data: { label: id, color: "neutral", shape: "rectangle" },
  } as CanvasNode;
}

const SNAPSHOT: CanvasSnapshot = { nodes: [node("web")], edges: [] };

function checkVersionParsing() {
  assert.equal(parseCanvasVersion(0), 0);
  assert.equal(parseCanvasVersion(7), 7);
  assert.equal(parseCanvasVersion("12"), 12, "a query-string version parses");
  for (const bad of [-1, 1.5, Number.NaN, "", "1e3", "-2", null, undefined, {}]) {
    assert.equal(parseCanvasVersion(bad), null, `rejects ${String(bad)}`);
  }
}

function checkWriteParsing() {
  assert.deepEqual(parseCanvasWrite({ version: 3, canvas: SNAPSHOT })?.version, 3);
  assert.equal(parseCanvasWrite(SNAPSHOT), null, "a bare snapshot has no version");
  assert.equal(parseCanvasWrite({ version: 3, canvas: { nodes: "no" } }), null);
  assert.equal(parseCanvasWrite({ version: "x", canvas: SNAPSHOT }), null);
}

/** Review Focus 3: opening an editor must never look like an edit. */
function checkCanonicalPayloadIgnoresRuntimeFields() {
  const decorated = {
    nodes: [
      {
        ...node("web"),
        selected: true,
        dragging: false,
        measured: { width: 160, height: 80 },
      },
    ],
    edges: [],
  } as CanvasSnapshot;

  assert.equal(canonicalCanvasPayload(decorated), canonicalCanvasPayload(SNAPSHOT));
  assert.notEqual(
    canonicalCanvasPayload({ nodes: [node("web", 20)], edges: [] }),
    canonicalCanvasPayload(SNAPSHOT),
    "a real move still changes the payload",
  );
}

function checkReadResponseParsing() {
  assert.equal(parseCanvasReadResponse({ changed: false, version: 4 }), "unchanged");
  assert.deepEqual(
    parseCanvasReadResponse({ changed: true, canvas: null, version: 0, isAgentWrite: false }),
    { snapshot: { nodes: [], edges: [] }, version: 0, isAgentWrite: false },
    "never saved reads as an empty canvas",
  );
  assert.equal(
    (parseCanvasReadResponse({ changed: true, canvas: SNAPSHOT, version: 2, isAgentWrite: true }) as RemoteCanvas)
      .isAgentWrite,
    true,
  );
  assert.equal(parseCanvasReadResponse({ changed: true, canvas: SNAPSHOT }), null, "no version");
  assert.equal(parseCanvasReadResponse("junk"), null);
}

function checkSnapshotFlow() {
  const untouched = createSnapshotFlow(SNAPSHOT);
  assert.equal(untouched.hasChanged, false);

  const flow = createSnapshotFlow(SNAPSHOT);
  flow.addNodes([node("db", 280)]);
  flow.updateNode("web", { position: { x: 40, y: 0 } });
  flow.removeNodes(["missing"]);
  assert.equal(flow.hasChanged, true);
  assert.deepEqual(flow.toSnapshot().nodes.map((n) => [n.id, n.position.x]), [
    ["web", 40],
    ["db", 280],
  ]);
  assert.deepEqual(SNAPSHOT.nodes[0].position, { x: 0, y: 0 }, "the source snapshot is never mutated");
}

checkVersionParsing();
checkWriteParsing();
checkCanonicalPayloadIgnoresRuntimeFields();
checkReadResponseParsing();
checkSnapshotFlow();
console.log("✅ canvas version helpers verified");

// A write with a broken hierarchy is rejected; the tolerant read path is untouched.
{
  const node = (id: string, kind: "boundary" | "generic", parentId?: string) => ({
    id, position: { x: 0, y: 0 }, ...(parentId ? { parentId } : {}), data: { label: id, kind },
  });
  const write = (nodes: unknown[]) => parseCanvasWrite({ version: 1, canvas: { nodes, edges: [] } });
  assert.ok(write([node("b", "boundary"), node("n", "generic", "b")]), "valid parent accepted");
  assert.equal(write([node("n", "generic", "missing")]), null, "missing parent rejected");
  assert.equal(write([node("g", "generic"), node("n", "generic", "g")]), null, "non-boundary parent rejected");
  assert.equal(write([node("a", "boundary", "b"), node("b", "boundary", "a")]), null, "cycle rejected");
}
