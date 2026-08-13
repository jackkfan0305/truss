import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createAgentLaunchFragmentBoundaryInput } from "./testing/agent-launch-fragment-fixtures.mjs";

const {
  browserCommand,
  buildLaunchUrl,
  formatLauncherSuccess,
  normalizeBaseUrl,
  openLaunchUrl,
  parseLauncherInput,
} =
  await import("../.agents/skills/render-truss-diagram/scripts/open-truss-diagram.mjs");

const graph = {
  version: 1,
  nodes: [
    {
      id: "client",
      label: "Client",
      shape: "circle",
      color: "blue",
      x: 0,
      y: 0,
    },
    {
      id: "orders-api",
      label: "Orders API",
      shape: "rectangle",
      color: "teal",
      x: 280,
      y: 0,
    },
  ],
  edges: [
    {
      id: "client-to-orders",
      source: "client",
      target: "orders-api",
      label: "HTTPS",
    },
  ],
};
const input = { title: "Global Checkout", graph };
const launchId = "00000000-0000-4000-8000-000000000001";
const launchUrl = buildLaunchUrl(input, {
  baseUrl: "https://truss.example/",
  launchId,
});
const parsedUrl = new URL(launchUrl);
const graphSchemaMarkdown = await readFile(
  new URL(
    "../.agents/skills/render-truss-diagram/references/graph-schema.md",
    import.meta.url,
  ),
  "utf8",
);
const documentedGraph = JSON.parse(
  graphSchemaMarkdown.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "",
);

assert.deepEqual(
  parseLauncherInput(["--stdin-json"], JSON.stringify(input)),
  input,
);
assert.deepEqual(
  parseLauncherInput(
    ["--stdin-json"],
    JSON.stringify({ title: "Documented graph", graph: documentedGraph }),
  ).graph,
  documentedGraph,
  "the graph documented for skill consumers passes the real launcher parser",
);
assert.throws(() => parseLauncherInput([], JSON.stringify(input)));
assert.throws(() => parseLauncherInput(["--title", input.title], input));
assert.throws(() =>
  parseLauncherInput(["--stdin-json", "--title", input.title], input),
);
assert.throws(() => parseLauncherInput(["--stdin-json"], "not json"));
assert.throws(() =>
  parseLauncherInput(
    ["--stdin-json"],
    JSON.stringify({ ...input, extra: true }),
  ),
);
assert.equal(parsedUrl.pathname, "/agent/new");
assert.equal(parsedUrl.search, "");
assert.ok(parsedUrl.hash.length > 1);
assert.deepEqual(
  JSON.parse(
    Buffer.from(parsedUrl.hash.slice(1), "base64url").toString("utf8"),
  ),
  { version: 1, launchId, title: input.title, graph },
);

function rejectsGraph(graphCandidate, reason) {
  assert.throws(
    () =>
      buildLaunchUrl(
        { ...input, graph: graphCandidate },
        { baseUrl: "https://truss.example", launchId },
      ),
    (error) => {
      assert.equal(error instanceof Error, true, reason);
      assert.equal(
        error.message.includes(input.title),
        false,
        `${reason} does not leak the title`,
      );
      assert.equal(
        error.message.includes(JSON.stringify(graphCandidate)),
        false,
        `${reason} does not leak the graph`,
      );
      return true;
    },
  );
}

const maxNodes = Array.from({ length: 40 }, (_, index) => ({
  ...graph.nodes[0],
  id: `node-${index}`,
}));
const maxEdges = Array.from({ length: 60 }, (_, index) => ({
  ...graph.edges[0],
  id: `edge-${index}`,
  source: `node-${Math.floor(index / 39)}`,
  target: `node-${index < 39 ? index + 1 : index === 39 ? 0 : index - 38}`,
  label: `${index}`,
}));

assert.doesNotThrow(() =>
  buildLaunchUrl(
    { ...input, graph: { ...graph, nodes: maxNodes, edges: maxEdges } },
    { baseUrl: "https://truss.example", launchId },
  ),
);
assert.doesNotThrow(() =>
  buildLaunchUrl(
    {
      ...input,
      graph: {
        ...graph,
        nodes: [
          {
            ...graph.nodes[0],
            id: "x".repeat(48),
            label: "x".repeat(80),
            x: -10_000,
            y: 10_000,
          },
        ],
        edges: [],
      },
    },
    { baseUrl: "https://truss.example", launchId },
  ),
);
assert.doesNotThrow(() =>
  buildLaunchUrl(
    {
      ...input,
      graph: {
        ...graph,
        edges: [{ ...graph.edges[0], label: "x".repeat(40) }],
      },
    },
    { baseUrl: "https://truss.example", launchId },
  ),
);
rejectsGraph({ ...graph, extra: true }, "rejects unknown graph fields");
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], extra: true }], edges: [] },
  "rejects unknown node fields",
);
rejectsGraph(
  { ...graph, edges: [{ ...graph.edges[0], extra: true }] },
  "rejects unknown edge fields",
);
rejectsGraph({ ...graph, nodes: [] }, "requires nodes");
rejectsGraph(
  {
    ...graph,
    nodes: [...maxNodes, { ...graph.nodes[0], id: "node-40" }],
    edges: [],
  },
  "rejects 41 nodes",
);
rejectsGraph(
  {
    ...graph,
    nodes: maxNodes,
    edges: [...maxEdges, { ...maxEdges[0], id: "edge-60" }],
  },
  "rejects 61 edges",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], id: "UPPER" }], edges: [] },
  "rejects invalid identifiers",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], id: "" }], edges: [] },
  "rejects empty identifiers",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], id: "x".repeat(49) }], edges: [] },
  "rejects long identifiers",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], label: " " }], edges: [] },
  "rejects blank labels",
);
rejectsGraph(
  {
    ...graph,
    nodes: [{ ...graph.nodes[0], label: " Client " }],
    edges: [],
  },
  "rejects padded node labels",
);
rejectsGraph(
  {
    ...graph,
    nodes: [{ ...graph.nodes[0], label: "x".repeat(81) }],
    edges: [],
  },
  "rejects node label overflow",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], shape: "triangle" }], edges: [] },
  "rejects shapes",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], color: "yellow" }], edges: [] },
  "rejects colors",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], x: 1.5 }], edges: [] },
  "rejects fractional positions",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], y: 10_001 }], edges: [] },
  "rejects coordinate overflow",
);
rejectsGraph(
  { ...graph, nodes: [{ ...graph.nodes[0], x: -10_001 }], edges: [] },
  "rejects coordinate underflow",
);
rejectsGraph(
  { ...graph, nodes: [graph.nodes[0], graph.nodes[0]], edges: [] },
  "rejects duplicate node IDs",
);
rejectsGraph(
  { ...graph, edges: [graph.edges[0], graph.edges[0]] },
  "rejects duplicate edge IDs",
);
rejectsGraph(
  { ...graph, edges: [{ ...graph.edges[0], id: "other" }, graph.edges[0]] },
  "rejects duplicate endpoint pairs",
);
rejectsGraph(
  { ...graph, edges: [{ ...graph.edges[0], target: "missing" }] },
  "rejects dangling targets",
);
rejectsGraph(
  { ...graph, edges: [{ ...graph.edges[0], target: "client" }] },
  "rejects self loops",
);
rejectsGraph(
  { ...graph, edges: [{ ...graph.edges[0], label: "x".repeat(41) }] },
  "rejects edge label overflow",
);
rejectsGraph(
  { ...graph, edges: [{ ...graph.edges[0], label: " HTTPS " }] },
  "rejects padded edge labels",
);

assert.throws(() =>
  buildLaunchUrl(
    { ...input, title: "t".repeat(121) },
    { baseUrl: "https://truss.example", launchId },
  ),
);
assert.throws(
  () =>
    buildLaunchUrl(
      { ...input, title: " Global Checkout " },
      { baseUrl: "https://truss.example", launchId },
    ),
  "rejects padded titles",
);

const atFragmentCap = createAgentLaunchFragmentBoundaryInput(12_288, launchId);
const atFragmentCapUrl = buildLaunchUrl(atFragmentCap, {
  baseUrl: "https://truss.example",
  launchId,
});
assert.equal(
  new URL(atFragmentCapUrl).hash.length - 1,
  16_384,
  "accepts exactly 16,384 encoded characters",
);
const aboveFragmentCap = createAgentLaunchFragmentBoundaryInput(12_289, launchId);
assert.throws(
  () =>
    buildLaunchUrl(aboveFragmentCap, {
      baseUrl: "https://truss.example",
      launchId,
    }),
  "rejects the smallest valid encoded fragment over 16,384 characters",
);
const oversizedGraph = {
  version: 1,
  nodes: Array.from({ length: 40 }, (_, index) => ({
    id: `node-${index}-${"x".repeat(40)}`,
    label: "l".repeat(80),
    shape: "rectangle",
    color: "blue",
    x: index * 240,
    y: 0,
  })),
  edges: Array.from({ length: 60 }, (_, index) => ({
    id: `edge-${index}-${"x".repeat(40)}`,
    source: `node-${Math.floor(index / 39)}-${"x".repeat(40)}`,
    target: `node-${index < 39 ? index + 1 : index === 39 ? 0 : index - 38}-${"x".repeat(40)}`,
    label: "l".repeat(40),
  })),
};
assert.throws(
  () =>
    buildLaunchUrl(
      { title: "t".repeat(120), graph: oversizedGraph },
      { baseUrl: "https://truss.example", launchId },
    ),
  "rejects an encoded fragment over 16,384 characters",
);

assert.deepEqual(browserCommand(launchUrl, "darwin"), {
  command: "open",
  args: [launchUrl],
});
assert.deepEqual(browserCommand(launchUrl, "win32"), {
  command: "cmd.exe",
  args: ["/d", "/s", "/c", "start", "", launchUrl],
});

const spawnCalls = [];
const fakeChild = new EventEmitter();
fakeChild.unrefCalled = false;
fakeChild.unref = () => {
  fakeChild.unrefCalled = true;
};
const openPromise = openLaunchUrl(launchUrl, "linux", (...args) => {
  spawnCalls.push(args);
  return fakeChild;
});
queueMicrotask(() => fakeChild.emit("spawn"));
await openPromise;
assert.deepEqual(spawnCalls[0], [
  "xdg-open",
  [launchUrl],
  { detached: true, shell: false, stdio: "ignore" },
]);
assert.equal(fakeChild.unrefCalled, true);

const failedChild = new EventEmitter();
failedChild.unrefCalled = false;
failedChild.unref = () => {
  failedChild.unrefCalled = true;
};
failedChild.on("error", () => {});
const failedOpenPromise = openLaunchUrl(launchUrl, "linux", () => failedChild);
queueMicrotask(() => failedChild.emit("error", new Error(launchUrl)));
await assert.rejects(failedOpenPromise, (error) => {
  assert.equal(error instanceof Error, true);
  assert.equal(error.message, "Unable to open Truss in a browser.");
  assert.equal(error.message.includes(input.title), false);
  assert.equal(error.message.includes(JSON.stringify(graph)), false);
  assert.equal(error.message.includes(parsedUrl.hash), false);
  return true;
});
assert.equal(failedChild.unrefCalled, true);

assert.throws(() => normalizeBaseUrl("javascript:alert(1)"));
assert.throws(() => normalizeBaseUrl("https://user:pass@truss.example"));
assert.throws(() => normalizeBaseUrl("https://truss.example/base"));
assert.throws(() => normalizeBaseUrl("https://truss.example?prompt=secret"));
assert.throws(() => normalizeBaseUrl("https://truss.example#fragment"));
assert.throws(() => normalizeBaseUrl("https://truss.example?"));
assert.throws(() => normalizeBaseUrl("https://truss.example#"));
assert.throws(() => normalizeBaseUrl("https://truss.example/?"));
assert.throws(() => normalizeBaseUrl("https://truss.example/#"));

const success = formatLauncherSuccess("https://truss.example", launchId);
assert.equal(success.includes(input.title), false);
assert.equal(success.includes(JSON.stringify(graph)), false);
assert.equal(success.includes(parsedUrl.hash), false);

console.info("Render Truss skill checks passed");
