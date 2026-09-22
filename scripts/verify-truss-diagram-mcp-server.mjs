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
    const answer = handler(req.method, url.pathname, { headers: req.headers, body: bodyJson });
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

const stub = await createStubServer((method, pathname, ctx) => {
  if (method === "GET" && pathname === "/api/projects") {
    assert.equal(ctx.headers.authorization, `Bearer ${token}`);
    return { status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } };
  }
  if (method === "GET" && pathname === "/api/projects/p1/agent-graph") {
    return { status: 200, body: { graph, opaqueNodeIds: [], fingerprint } };
  }
  if (method === "POST" && pathname === "/api/projects/p1/agent-graph-edit") {
    return { status: 200, body: { applied: true } };
  }
  if (method === "DELETE" && pathname === "/api/projects/p1") {
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
      "truss_get_diagram",
      "truss_list_diagrams",
      "truss_login",
    ],
    "the server registers exactly the documented tools",
  );

  const listResult = await client.callTool({ name: "truss_list_diagrams", arguments: {} });
  assert.equal(listResult.isError, undefined, "a successful call carries no isError flag");
  assert.deepEqual(listResult.structuredContent, { projects: [{ id: "p1", name: "Payments" }] });

  const getResult = await client.callTool({
    name: "truss_get_diagram",
    arguments: { projectId: "p1" },
  });
  assert.deepEqual(getResult.structuredContent.graph, graph);
  assert.equal(getResult.structuredContent.fingerprint, fingerprint);

  const editResult = await client.callTool({
    name: "truss_apply_diagram_edit",
    arguments: {
      projectId: "p1",
      fingerprint: getResult.structuredContent.fingerprint,
      desiredGraph: graph,
    },
  });
  assert.equal(editResult.structuredContent.editorUrl, `${stub.origin}/editor/p1`);

  const deleteResult = await client.callTool({
    name: "truss_delete_diagram",
    arguments: { projectId: "p1" },
  });
  assert.deepEqual(deleteResult.structuredContent, { projectId: "p1", deleted: true });

  // A malformed call (missing the required `projectId`) must fail as a clean
  // tool-error result, never as an uncaught exception or a stack trace.
  const badCall = await client.callTool({ name: "truss_get_diagram", arguments: {} });
  assert.equal(badCall.isError, true);
  assert.equal(badCall.content[0].type, "text");
  assert.doesNotMatch(badCall.content[0].text, /\bat \w|node:internal/, "no stack trace reaches the tool result");

  // A thrown core.mjs error (an id no listing ever offered) must also come
  // back as a clean tool-error result with the exact message, not a crash.
  const rejectedCall = await client.callTool({
    name: "truss_get_diagram",
    arguments: { projectId: "not-in-the-list" },
  });
  assert.equal(rejectedCall.isError, true);
  assert.equal(rejectedCall.content[0].text, "The agent chose a project we don't recognize.");
} finally {
  await client.close();
  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

console.info("Truss diagram MCP server checks passed");
