import assert from "node:assert/strict";

import { specPayloadSchema, specRequestSchema } from "../lib/spec-requests";
import { specBlobPath, specFileName } from "../lib/spec-storage";

const valid = {
  roomId: "checkout-flow-a1b2",
  chatHistory: [{ role: "user", content: "Add a payments service" }],
  nodes: [
    { id: "api", data: { label: "API Gateway", shape: "hexagon" } },
    { id: "db", data: { label: "Orders DB", shape: "cylinder" } },
  ],
  edges: [{ id: "e1", source: "api", target: "db", data: { label: "writes" } }],
};

function checkSpecRequestParsing() {
  const parsed = specRequestSchema.parse(valid);

  assert.equal(parsed.roomId, "checkout-flow-a1b2");
  assert.equal(parsed.nodes.length, 2);
  assert.equal(parsed.edges[0].data.label, "writes");

  // The canvas sends full React Flow nodes. Extra keys are stripped, not
  // rejected — otherwise every canvas field added later would 400 this route.
  const withExtras = specRequestSchema.parse({
    ...valid,
    nodes: [
      {
        id: "api",
        type: "canvasNode",
        position: { x: 10, y: 20 },
        selected: true,
        data: { label: "API Gateway", shape: "hexagon", color: "blue" },
      },
    ],
  });

  assert.deepEqual(
    withExtras.nodes[0],
    { id: "api", data: { label: "API Gateway", shape: "hexagon" } },
    "keeps only what a spec is written from",
  );

  // An empty canvas is a valid request — the task decides whether there is
  // enough to write about, because it also sees the conversation.
  const empty = specRequestSchema.parse({ roomId: valid.roomId });

  assert.deepEqual(empty.nodes, [], "nodes default to empty");
  assert.deepEqual(empty.edges, [], "edges default to empty");
  assert.deepEqual(empty.chatHistory, [], "chatHistory defaults to empty");

  const rejected: unknown[] = [
    null,
    undefined,
    "a string body",
    [valid],
    {},
    { ...valid, roomId: "" },
    { ...valid, roomId: "ab" },
    { ...valid, roomId: "x".repeat(81) },
    { ...valid, roomId: 42 },
    { ...valid, nodes: "not an array" },
    { ...valid, nodes: [{ data: { label: "no id" } }] },
    { ...valid, edges: [{ id: "e1", source: "api" }] },
    { ...valid, chatHistory: [{ role: "system", content: "hi" }] },
    { ...valid, chatHistory: [{ role: "user", content: "" }] },
    { ...valid, chatHistory: [{ role: "user", content: "x".repeat(2001) }] },
    // Unbounded arrays are unbounded request bodies.
    { ...valid, nodes: Array.from({ length: 301 }, (_, i) => ({ id: `n${i}`, data: { label: "n" } })) },
  ];

  for (const body of rejected) {
    assert.equal(
      specRequestSchema.safeParse(body).success,
      false,
      `rejected: ${JSON.stringify(body)?.slice(0, 80)}`,
    );
  }
}

function checkSpecPayloadParsing() {
  // The worker re-parses what the route sent: a task payload is not only ever
  // written by that route.
  const payload = specPayloadSchema.parse({
    ...valid,
    projectId: valid.roomId,
  });

  assert.equal(payload.projectId, valid.roomId);

  assert.equal(
    specPayloadSchema.safeParse(valid).success,
    false,
    "a payload without a projectId is refused",
  );
}

function checkSpecStorage() {
  // The pathname the download route resolves. Namespaced by project, one
  // document per spec — matching the storage model in architecture-context.md.
  assert.equal(
    specBlobPath("proj_a1b2", "run_c3d4"),
    "specs/proj_a1b2/run_c3d4.md",
  );

  // Two specs of the same project never share a pathname, so nothing overwrites
  // anything but its own retry.
  assert.notEqual(
    specBlobPath("proj_a1b2", "run_c3d4"),
    specBlobPath("proj_a1b2", "run_e5f6"),
  );

  // The download filename goes into a `Content-Disposition` header, so it must
  // carry nothing that needs escaping there — no colons from the timestamp, no
  // quotes, no path separators.
  const name = specFileName(new Date("2026-08-08T14:32:07.123Z"));

  assert.equal(name, "spec-2026-08-08-14-32.md");
  assert.match(name, /^spec-[\d-]+\.md$/, "safe in a header, unquoted");

  // Minute precision, so two specs from one afternoon do not collide.
  assert.notEqual(
    specFileName(new Date("2026-08-08T14:32:00Z")),
    specFileName(new Date("2026-08-08T14:33:00Z")),
  );
}

checkSpecRequestParsing();
checkSpecPayloadParsing();
checkSpecStorage();

console.log("✅ Spec API parsing, task payload and spec storage paths verified");
