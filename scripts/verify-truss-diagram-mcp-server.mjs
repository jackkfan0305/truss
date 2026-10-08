import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// A thin end-to-end smoke test over the real MCP transport: proves the server
// starts, registers exactly the documented tools, validates arguments, and
// wraps a thrown core.mjs error into a clean tool-error result. Every auth,
// retry, and cache edge case already has direct coverage in
// verify-truss-diagram-core.mjs against the same core.mjs functions — this
// file exists only to prove the MCP wiring on top of them isn't broken, so it
// stays intentionally small.

const watchdog = setTimeout(() => {
  console.error("verify-truss-diagram-mcp-server: TIMED OUT.");
  process.exit(1);
}, 30_000);
watchdog.unref();

const SERVER_SCRIPT = fileURLToPath(
  new URL("../.agents/skills/truss-diagram/scripts/mcp-server.mjs", import.meta.url),
);

function mintToken() {
  return `trs_agent_${randomBytes(32).toString("base64url")}`;
}

function tempHome() {
  return mkdtempSync(join(tmpdir(), "truss-mcp-home-"));
}

function seedCredential(homeDir, origin, token) {
  const dir = join(homeDir, ".truss");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({
      version: 1,
      origins: { [origin]: { token, createdAt: new Date().toISOString() } },
    }),
    { mode: 0o600 },
  );
}

function createStubServer(handler) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let bodyJson = null;
    try {
      bodyJson = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      bodyJson = null;
    }
    const url = new URL(req.url, "http://127.0.0.1");
    const answer = handler(req.method, url.pathname, { headers: req.headers, body: bodyJson, query: url.search });
    if (!answer) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `no stub route for ${req.method} ${url.pathname}` }));
      return;
    }
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(JSON.stringify(answer.body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const homeDir = tempHome();
const token = mintToken();
const graph = {
  version: 1,
  nodes: [{ id: "a", label: "A", shape: "rectangle", color: "blue", x: 0, y: 0 }],
  edges: [],
};
const fingerprint = "a".repeat(64);

const catalog = { catalogVersion: 1, entries: [{ id: "aws-lambda", family: "aws", name: "AWS Lambda", kind: "service" }, { id: "code-entry", family: "code", name: "Entry point", kind: "block" }] };
const nestedGraph = {
  version: 2,
  nodes: [
    { id: "vpc", kind: "boundary", catalogId: "boundary-vpc", label: "VPC" },
    { id: "worker", kind: "aws-service", catalogId: "aws-lambda", label: "Worker", parentId: "vpc" },
  ],
  edges: [],
};
const spatial = { coordinateSpace: "canvas", nodes: [{ id: "vpc", bounds: { x: 0, y: 0, width: 400, height: 240 } }], edges: [] };
const freshFingerprint = "b".repeat(64);
// Scripted answers for POSTs to the graph endpoints, plus a record of what arrived.
const scripted = [];
const posts = [];

const stub = await createStubServer((method, pathname, ctx) => {
  if (method === "GET" && pathname === "/api/agent/catalog") {
    assert.equal(ctx.headers.authorization, undefined, "the catalog read sends no credential");
    return { status: 200, body: catalog };
  }
  if (method === "GET" && pathname === "/api/diagrams/p1/agent-graph") {
    return { status: 200, body: { graph: nestedGraph, opaqueNodeIds: ["Opaque_Item"], opaqueEdgeIds: [], spatial, fingerprint: freshFingerprint, query: ctx.query } };
  }
  if (method === "POST" && pathname === "/api/diagrams" && scripted.length) {
    return { status: 201, body: { diagram: { id: ctx.body.id } } };
  }
  if (method === "POST" && scripted.length && /agent-(graph-edit|launch-import)$/.test(pathname)) {
    posts.push({ pathname, query: ctx.query, body: ctx.body });
    return scripted.shift();
  }
  if (method === "GET" && pathname === "/api/diagrams") {
    assert.equal(ctx.headers.authorization, `Bearer ${token}`);
    return { status: 200, body: { diagrams: [{ id: "p1", name: "Payments" }] } };
  }
  if (method === "GET" && pathname === "/api/diagrams/p1/agent-graph") {
    return { status: 200, body: { graph, opaqueNodeIds: [], fingerprint } };
  }
  if (method === "POST" && pathname === "/api/diagrams/p1/agent-graph-edit") {
    return { status: 200, body: { applied: true } };
  }
  if (method === "DELETE" && pathname === "/api/diagrams/p1") {
    assert.equal(ctx.headers.authorization, `Bearer ${token}`);
    return { status: 204, body: null };
  }
  return null;
});
seedCredential(homeDir, stub.origin, token);

const transport = new StdioClientTransport({
  stderr: "pipe",
  command: process.execPath,
  args: [SERVER_SCRIPT],
  env: {
    ...process.env,
    HOME: homeDir,
    TRUSS_APP_URL: stub.origin,
    // Login exercises its link callback without opening a real browser.
    PATH: "/truss-mcp-verifier-no-such-directory",
  },
});

const protocolErrors = [];
transport.onerror = (error) => protocolErrors.push(error);
const client = new Client({ name: "truss-diagram-verify", version: "0.0.0" });
await client.connect(transport);

try {
  const linkLine = new Promise((resolve) => {
    let buffer = "";
    const readLink = (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes("\n")) return;
      transport.stderr.off("data", readLink);
      resolve(buffer.split("\n")[0]);
    };
    transport.stderr.on("data", readLink);
  });
  const loginCall = client.callTool({ name: "truss_login", arguments: {} });
  const linkUrl = new URL(await linkLine);
  const payload = JSON.parse(Buffer.from(linkUrl.hash.slice(1), "base64url").toString("utf8"));
  const callback = await fetch(`http://127.0.0.1:${payload.port}/`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: stub.origin },
    body: JSON.stringify({ nonce: payload.nonce, token }),
  });
  assert.equal(callback.status, 200);
  assert.equal((await loginCall).isError, undefined);
  assert.deepEqual(protocolErrors, [], "auth output never corrupts MCP stdout");

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    [
      "truss_apply_diagram_edit",
      "truss_create_diagram",
      "truss_delete_diagram",
      "truss_get_catalog",
      "truss_get_diagram",
      "truss_list_diagrams",
      "truss_login",
    ],
    "the server registers exactly the documented tools",
  );

  const editTool = tools.find((tool) => tool.name === "truss_apply_diagram_edit");
  assert.match(editTool.description, /Never connect notes\./);
  assert.match(tools.find((tool) => tool.name === "truss_create_diagram").description, /Never connect notes\./);
  const v2Node = editTool.inputSchema.properties.desiredGraph.anyOf[1].properties.nodes.items;
  assert.ok(v2Node.properties.kind.enum.includes("note"), "the edit tool accepts note nodes");
  assert.ok(v2Node.properties.color.enum.includes("yellow"), "notes can be yellow");

  const listResult = await client.callTool({ name: "truss_list_diagrams", arguments: {} });
  assert.equal(listResult.isError, undefined, "a successful call carries no isError flag");
  assert.deepEqual(listResult.structuredContent, { diagrams: [{ id: "p1", name: "Payments" }] });

  const getResult = await client.callTool({
    name: "truss_get_diagram",
    arguments: { diagramId: "p1" },
  });
  assert.deepEqual(getResult.structuredContent.graph, nestedGraph);
  assert.equal(getResult.structuredContent.fingerprint, freshFingerprint);

  const editResult = await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: {
      diagramId: "p1",
      fingerprint: getResult.structuredContent.fingerprint,
      desiredGraph: graph, // a v1 graph still goes to the original endpoint
    },
  });
  assert.equal(editResult.structuredContent.editorUrl, `${stub.origin}/editor/p1`);

  // Nested v2: catalog, read, create, edit and error surfaces over the real transport.
  const catalogResult = await client.callTool({ name: "truss_get_catalog", arguments: {} });
  assert.deepEqual(catalogResult.structuredContent, catalog);

  const v2Read = await client.callTool({ name: "truss_get_diagram", arguments: { diagramId: "p1" } });
  assert.deepEqual(v2Read.structuredContent.spatial, spatial);
  assert.deepEqual(v2Read.structuredContent.opaqueNodeIds, ["Opaque_Item"]);
  assert.equal(v2Read.structuredContent.query, "?version=2");

  const committed = { applied: true, graph: nestedGraph, opaqueNodeIds: [], opaqueEdgeIds: [], spatial, fingerprint: freshFingerprint };
  scripted.push({ status: 200, body: { imported: true, ...committed } });
  const created = await client.callTool({
    name: "truss_create_diagram",
    arguments: { title: "AWS", graph: nestedGraph },
  });
  assert.equal(created.isError, undefined, created.content[0].text);
  assert.equal(created.structuredContent.fingerprint, freshFingerprint);
  assert.deepEqual(created.structuredContent.spatial, spatial);
  assert.deepEqual(posts[0].body.graph, nestedGraph, "the create body is exactly the input graph");
  assert.equal(posts[0].query, "?version=2");

  scripted.push({ status: 200, body: committed });
  const nestedEdit = await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: { diagramId: "p1", fingerprint, desiredGraph: nestedGraph },
  });
  assert.equal(nestedEdit.structuredContent.fingerprint, freshFingerprint);
  assert.deepEqual(posts[1].body, { fingerprint, graph: nestedGraph });
  assert.equal(posts[1].pathname, "/api/diagrams/p1/agent-graph-edit");

  // Code diagrams: the request body carries signature, rows, source and edge kind unchanged.
  const codeGraph = {
    version: 2,
    nodes: [
      { id: "main", kind: "code", catalogId: "code-entry", label: "main", signature: "main()", summary: "Starts the app.", pseudocode: ["start the app"], source: { path: "src/main.ts", line: 1, url: "https://github.com/o/r/blob/abc/src/main.ts#L1" } },
      { id: "svc", kind: "boundary", catalogId: "code-class", label: "Service" },
      { id: "run", kind: "code", catalogId: "code-method", label: "run", summary: "Runs it.", pseudocode: ["read Config", "do the work"], parentId: "svc" },
      { id: "cfg", kind: "code", catalogId: "code-type", label: "Config", rows: ["port: number"], parentId: "types" },
    { id: "types", kind: "boundary", catalogId: "code-module", label: "Types" },
    ],
    edges: [
      { id: "e1", source: "main", target: "run", label: "", kind: "calls" },
      { id: "e2", source: "run", target: "cfg", label: "", kind: "uses" },
    ],
  };
  scripted.push({ status: 200, body: { imported: true, ...committed, graph: codeGraph } });
  const codeCreated = await client.callTool({ name: "truss_create_diagram", arguments: { title: "Code", graph: codeGraph } });
  assert.equal(codeCreated.isError, undefined, codeCreated.content[0].text);
  assert.deepEqual(posts.at(-1).body.graph, codeGraph, "the code create body is exactly the input graph");
  scripted.push({ status: 200, body: committed });
  const codeEdit = await client.callTool({ name: "truss_apply_diagram_edit", arguments: { diagramId: "p1", fingerprint, desiredGraph: codeGraph } });
  assert.equal(codeEdit.isError, undefined, codeEdit.content[0].text);
  assert.deepEqual(posts.at(-1).body.graph, codeGraph);
  const badSource = await client.callTool({
    name: "truss_create_diagram",
    arguments: { title: "Code", graph: { ...codeGraph, nodes: [{ ...codeGraph.nodes[0], source: { path: "a.ts", url: "javascript:x" } }, ...codeGraph.nodes.slice(1)] } },
  });
  assert.equal(badSource.isError, true);

  // A recoverable geometry refusal keeps the server code and the actionable item IDs.
  scripted.push({
    status: 422,
    body: { error: "Could not resolve diagram layout", code: "invalidGeometry", issues: [{ code: "siblingCollision", itemIds: ["worker", "queue"] }] },
  });
  const geometry = await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: { diagramId: "p1", fingerprint, desiredGraph: nestedGraph },
  });
  assert.equal(geometry.isError, true);
  assert.match(geometry.content[0].text, /invalidGeometry/);
  assert.match(geometry.content[0].text, /"itemIds":\["worker","queue"\]/);

  // A 409 asks for a fresh read; the revised edit then carries the refreshed fingerprint.
  scripted.push({ status: 409, body: { error: "The canvas changed since it was read" } });
  const stale = await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: { diagramId: "p1", fingerprint, desiredGraph: nestedGraph },
  });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /truss_get_diagram/);
  const reread = await client.callTool({ name: "truss_get_diagram", arguments: { diagramId: "p1" } });
  scripted.push({ status: 200, body: committed });
  const revised = { ...nestedGraph, nodes: [...nestedGraph.nodes, { id: "queue", kind: "aws-service", catalogId: "aws-s3", label: "Uploads", parentId: "vpc" }] };
  await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: { diagramId: "p1", fingerprint: reread.structuredContent.fingerprint, desiredGraph: revised },
  });
  assert.equal(posts.at(-1).body.fingerprint, freshFingerprint);
  assert.deepEqual(posts.at(-1).body.graph, revised);

  // Transport schemas reject an extra field before any request leaves.
  const before = posts.length;
  const extra = await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: {
      diagramId: "p1", fingerprint,
      desiredGraph: { ...nestedGraph, nodes: [{ ...nestedGraph.nodes[0], iconUrl: "https://x/y.svg" }] },
    },
  });
  assert.equal(extra.isError, true);
  assert.equal(posts.length, before);

  const deleteResult = await client.callTool({
    name: "truss_delete_diagram",
    arguments: { diagramId: "p1" },
  });
  assert.deepEqual(deleteResult.structuredContent, { diagramId: "p1", deleted: true });

  // A malformed call (missing the required `diagramId`) must fail as a clean
  // tool-error result, never as an uncaught exception or a stack trace.
  const badCall = await client.callTool({ name: "truss_get_diagram", arguments: {} });
  assert.equal(badCall.isError, true);
  assert.equal(badCall.content[0].type, "text");
  assert.doesNotMatch(badCall.content[0].text, /\bat \w|node:internal/, "no stack trace reaches the tool result");

  // A thrown core.mjs error (an id no listing ever offered) must also come
  // back as a clean tool-error result with the exact message, not a crash.
  const rejectedCall = await client.callTool({
    name: "truss_get_diagram",
    arguments: { diagramId: "not-in-the-list" },
  });
  assert.equal(rejectedCall.isError, true);
  assert.equal(rejectedCall.content[0].text, "The agent chose a diagram we don't recognize.");
} finally {
  await client.close();
  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

console.info("Truss diagram MCP server checks passed");
