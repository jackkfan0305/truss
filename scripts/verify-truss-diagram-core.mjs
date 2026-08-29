import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Everything here calls .agents/skills/truss-diagram/scripts/core.mjs's
// exported operations directly, in one process — replacing the old
// spawn-the-CLI-and-speak-NDJSON tests now that the skill is an MCP server
// instead of a script.
//
// `blockRealBrowser`/`unblockRealBrowser` bracket the sections that trigger a
// real `openLaunchUrl`(`open`/`xdg-open`) call: pointing PATH at nothing makes
// that spawn fail with ENOENT, so login falls back to the printed link URL
// these tests act on as the browser would, and delete fails the way it would
// on a real headless box with no browser at all. It is scoped, not global,
// because the buildPickUrl round-trip below shells out to this repo's own
// `tsx` and needs a real `node` on PATH to do it.
function blockRealBrowser() {
  process.env.PATH = "/truss-core-verifier-no-such-directory";
}
function unblockRealBrowser(originalPath) {
  process.env.PATH = originalPath;
}

const watchdog = setTimeout(() => {
  console.error("verify-truss-diagram-core: TIMED OUT — an operation never resolved.");
  process.exit(1);
}, 30_000);
watchdog.unref();

const SKILL_DIR = fileURLToPath(
  new URL("../.agents/skills/truss-diagram", import.meta.url),
);
const CORE_SCRIPT = join(SKILL_DIR, "scripts", "core.mjs");
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const {
  applyDiagramEdit,
  browserCommand,
  buildLinkUrl,
  buildPickUrl,
  buildRoomId,
  createDiagram,
  getDiagram,
  listDiagrams,
  login,
  normalizeBaseUrl,
  openLaunchUrl,
  promptDeleteDiagram,
  slugifyTitle,
  validateCreateInput,
  validateGraph,
} = await import(CORE_SCRIPT);

function mintToken() {
  return `trs_agent_${randomBytes(32).toString("base64url")}`;
}

function tempHome() {
  return mkdtempSync(join(tmpdir(), "truss-core-home-"));
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

function seedCredentialWithProjects(homeDir, origin, token, projects, fetchedAt) {
  const dir = join(homeDir, ".truss");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, "credentials.json"),
    JSON.stringify({
      version: 1,
      origins: {
        [origin]: {
          token,
          createdAt: new Date().toISOString(),
          projects,
          projectsFetchedAt: fetchedAt,
        },
      },
    }),
    { mode: 0o600 },
  );
}

// A minimal stand-in for the real Truss API. `routes` maps "METHOD path" to a
// queue of responder functions, one consumed per matching request — lets a
// test script a 401-then-200 or 409-then-409 sequence for the same endpoint.
function createStubServer(routes) {
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
    const queue = routes.get(`${req.method} ${url.pathname}`);
    const responder = queue && queue.length > 0 ? queue.shift() : null;

    if (!responder) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `no stub route for ${req.method} ${url.pathname}` }));
      return;
    }

    const { status, body } = responder({ headers: req.headers, body: bodyJson });
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

// The queue-based stub above needs every route known up front, but a headless
// create only learns its room ID from the request it is making. This variant
// takes one handler and answers whatever it returns, so a test can key a
// route off an ID core.mjs generated.
function createStubServerDynamic(handler) {
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
    const answer = handler(req.method, url.pathname, {
      headers: req.headers,
      body: bodyJson,
    });

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
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

// Intercepts the next full line core.mjs writes to stdout (the printed
// link/pick URL a headless SSH session would fall back to) without spawning a
// child process to read it from.
function interceptStdoutLine() {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let buffer = "";
  return new Promise((resolve) => {
    process.stdout.write = (chunk) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        process.stdout.write = originalWrite;
        resolve(buffer.slice(0, newlineIndex));
      }
      return true;
    };
  });
}

// Decodes a printed `/agent/link#…` URL and answers it as the browser would:
// POST {nonce, token} to the loopback and expect {ok:true}. Exercises the
// real production `buildLinkUrl` output end to end (no stand-in parser).
async function performBrowserLinkCallback(linkUrlPromise, allowedOrigin, tokenToSend) {
  const line = (await linkUrlPromise).trim();
  const url = new URL(line);
  const payload = JSON.parse(Buffer.from(url.hash.slice(1), "base64url").toString("utf8"));

  assert.equal(url.origin, allowedOrigin, "link URL uses the configured origin");
  assert.equal(url.pathname, "/agent/link", "link URL path matches the contract");
  assert.deepEqual(
    Object.keys(payload).sort(),
    ["linkId", "nonce", "port", "version"],
    "link fragment carries exactly the contract's fields",
  );
  assert.equal(payload.version, 1);
  assert.ok(UUID_V4_PATTERN.test(payload.linkId), "linkId is a canonical UUID v4");
  assert.ok(UUID_V4_PATTERN.test(payload.nonce), "nonce is a canonical UUID v4");
  assert.ok(payload.port >= 1024 && payload.port <= 65535, "port is in the valid range");

  const response = await fetch(`http://127.0.0.1:${payload.port}/`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: allowedOrigin },
    body: JSON.stringify({ nonce: payload.nonce, token: tokenToSend }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  return payload;
}

// --- graph validation (the compact graph contract) -------------------------

const GRAPH = {
  version: 1,
  nodes: [
    { id: "client", label: "Client", shape: "circle", color: "blue", x: 0, y: 0 },
    { id: "orders-api", label: "Orders API", shape: "rectangle", color: "teal", x: 280, y: 0 },
  ],
  edges: [{ id: "client-to-orders", source: "client", target: "orders-api", label: "HTTPS" }],
};

function rejectsGraph(graphCandidate, reason) {
  assert.throws(() => validateGraph(graphCandidate), Error, reason);
}

assert.deepEqual(validateGraph(GRAPH), GRAPH);

const graphSchemaMarkdown = await readFile(
  join(SKILL_DIR, "references", "graph-schema.md"),
  "utf8",
);
const documentedGraph = JSON.parse(
  graphSchemaMarkdown.match(/```json\n([\s\S]*?)\n```/)?.[1] ?? "",
);
assert.deepEqual(
  validateGraph(documentedGraph),
  documentedGraph,
  "the graph documented for skill consumers passes the real validator",
);

const maxNodes = Array.from({ length: 40 }, (_, index) => ({
  ...GRAPH.nodes[0],
  id: `node-${index}`,
}));
const maxEdges = Array.from({ length: 60 }, (_, index) => ({
  ...GRAPH.edges[0],
  id: `edge-${index}`,
  source: `node-${Math.floor(index / 39)}`,
  target: `node-${index < 39 ? index + 1 : index === 39 ? 0 : index - 38}`,
  label: `${index}`,
}));

assert.doesNotThrow(() => validateGraph({ ...GRAPH, nodes: maxNodes, edges: maxEdges }));
assert.doesNotThrow(() =>
  validateGraph({
    ...GRAPH,
    nodes: [{ ...GRAPH.nodes[0], id: "x".repeat(48), label: "x".repeat(80), x: -10_000, y: 10_000 }],
    edges: [],
  }),
);
assert.doesNotThrow(() =>
  validateGraph({ ...GRAPH, edges: [{ ...GRAPH.edges[0], label: "x".repeat(40) }] }),
);

rejectsGraph({ ...GRAPH, extra: true }, "rejects unknown graph fields");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], extra: true }], edges: [] }, "rejects unknown node fields");
rejectsGraph({ ...GRAPH, edges: [{ ...GRAPH.edges[0], extra: true }] }, "rejects unknown edge fields");
rejectsGraph({ ...GRAPH, nodes: [] }, "requires nodes");
rejectsGraph({ ...GRAPH, nodes: [...maxNodes, { ...GRAPH.nodes[0], id: "node-40" }], edges: [] }, "rejects 41 nodes");
rejectsGraph(
  { ...GRAPH, nodes: maxNodes, edges: [...maxEdges, { ...maxEdges[0], id: "edge-60" }] },
  "rejects 61 edges",
);
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], id: "UPPER" }], edges: [] }, "rejects invalid identifiers");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], id: "" }], edges: [] }, "rejects empty identifiers");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], id: "x".repeat(49) }], edges: [] }, "rejects long identifiers");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], label: " " }], edges: [] }, "rejects blank labels");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], label: " Client " }], edges: [] }, "rejects padded node labels");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], label: "x".repeat(81) }], edges: [] }, "rejects node label overflow");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], shape: "triangle" }], edges: [] }, "rejects shapes");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], color: "yellow" }], edges: [] }, "rejects colors");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], x: 1.5 }], edges: [] }, "rejects fractional positions");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], y: 10_001 }], edges: [] }, "rejects coordinate overflow");
rejectsGraph({ ...GRAPH, nodes: [{ ...GRAPH.nodes[0], x: -10_001 }], edges: [] }, "rejects coordinate underflow");
rejectsGraph({ ...GRAPH, nodes: [GRAPH.nodes[0], GRAPH.nodes[0]], edges: [] }, "rejects duplicate node IDs");
rejectsGraph({ ...GRAPH, edges: [GRAPH.edges[0], GRAPH.edges[0]] }, "rejects duplicate edge IDs");
rejectsGraph(
  { ...GRAPH, edges: [{ ...GRAPH.edges[0], id: "other" }, GRAPH.edges[0]] },
  "rejects duplicate endpoint pairs",
);
rejectsGraph({ ...GRAPH, edges: [{ ...GRAPH.edges[0], target: "missing" }] }, "rejects dangling targets");
rejectsGraph({ ...GRAPH, edges: [{ ...GRAPH.edges[0], target: "client" }] }, "rejects self loops");
rejectsGraph({ ...GRAPH, edges: [{ ...GRAPH.edges[0], label: "x".repeat(41) }] }, "rejects edge label overflow");
rejectsGraph({ ...GRAPH, edges: [{ ...GRAPH.edges[0], label: " HTTPS " }] }, "rejects padded edge labels");

// --- title validation --------------------------------------------------

assert.deepEqual(validateCreateInput("Global Checkout", GRAPH), { title: "Global Checkout", graph: GRAPH });
assert.throws(() => validateCreateInput("t".repeat(121), GRAPH), "rejects titles over 120 characters");
assert.throws(() => validateCreateInput(" Global Checkout ", GRAPH), "rejects padded titles");
assert.throws(() => validateCreateInput("", GRAPH), "rejects an empty title");

// --- normalizeBaseUrl ----------------------------------------------------

assert.throws(() => normalizeBaseUrl("javascript:alert(1)"));
assert.throws(() => normalizeBaseUrl("https://user:pass@truss.example"));
assert.throws(() => normalizeBaseUrl("https://truss.example/base"));
assert.throws(() => normalizeBaseUrl("https://truss.example?prompt=secret"));
assert.throws(() => normalizeBaseUrl("https://truss.example#fragment"));
assert.equal(normalizeBaseUrl("https://truss.example/"), "https://truss.example");

// --- browserCommand / openLaunchUrl --------------------------------------

assert.deepEqual(browserCommand("https://truss.example", "darwin"), {
  command: "open",
  args: ["https://truss.example"],
});
assert.deepEqual(browserCommand("https://truss.example", "win32"), {
  command: "cmd.exe",
  args: ["/d", "/s", "/c", "start", "", "https://truss.example"],
});

{
  const spawnCalls = [];
  const fakeChild = new EventEmitter();
  fakeChild.unrefCalled = false;
  fakeChild.unref = () => {
    fakeChild.unrefCalled = true;
  };
  const openPromise = openLaunchUrl("https://truss.example", "linux", (...args) => {
    spawnCalls.push(args);
    return fakeChild;
  });
  queueMicrotask(() => fakeChild.emit("spawn"));
  await openPromise;
  assert.deepEqual(spawnCalls[0], [
    "xdg-open",
    ["https://truss.example"],
    { detached: true, shell: false, stdio: "ignore" },
  ]);
  assert.equal(fakeChild.unrefCalled, true);
}

{
  const failedChild = new EventEmitter();
  failedChild.unrefCalled = false;
  failedChild.unref = () => {
    failedChild.unrefCalled = true;
  };
  failedChild.on("error", () => {});
  const failedOpenPromise = openLaunchUrl("https://truss.example", "linux", () => failedChild);
  queueMicrotask(() => failedChild.emit("error", new Error("boom")));
  await assert.rejects(failedOpenPromise, (error) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error.message, "Unable to open Truss in a browser.");
    return true;
  });
  assert.equal(failedChild.unrefCalled, true);
}

// --- buildLinkUrl / buildPickUrl fragment round-trips ---------------------

{
  const linkId = "00000000-0000-4000-8000-000000000010";
  const nonce = "00000000-0000-4000-8000-000000000011";
  const url = buildLinkUrl("https://truss.example", { linkId, port: 54_321, nonce });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://truss.example");
  assert.equal(parsed.pathname, "/agent/link");
  assert.deepEqual(
    JSON.parse(Buffer.from(parsed.hash.slice(1), "base64url").toString("utf8")),
    { version: 1, linkId, port: 54_321, nonce },
  );
}

// buildPickUrl round-trips through the real parseAgentPickFragment
// (lib/agent-pick.ts). That module is TypeScript with a `@/*` path alias,
// which plain `node` cannot resolve, so shell out to the repo's own tsx
// binary rather than re-implement (and risk drifting from) the schema it
// enforces.
{
  const pickPayload = {
    op: "edit",
    port: 54_321,
    nonce: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    pickId: "00000000-0000-4000-8000-000000000002",
  };
  const pickUrl = buildPickUrl("https://truss.example", pickPayload);
  const parsedPickUrl = new URL(pickUrl);
  assert.equal(parsedPickUrl.origin, "https://truss.example");
  assert.equal(parsedPickUrl.pathname, "/agent/pick");
  assert.ok(parsedPickUrl.hash.length > 1);

  const repoRoot = new URL("..", import.meta.url).pathname;
  const roundTripOutput = execFileSync(
    `${repoRoot}node_modules/.bin/tsx`,
    [
      "-e",
      `import("./lib/agent-pick.ts").then(({ parseAgentPickFragment }) => {
        process.stdout.write(JSON.stringify(parseAgentPickFragment(${JSON.stringify(parsedPickUrl.hash)})));
      });`,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  ).trim();
  assert.deepEqual(
    JSON.parse(roundTripOutput),
    { version: 1, ...pickPayload },
    "buildPickUrl round-trips through parseAgentPickFragment",
  );
}

// --- buildRoomId / slugifyTitle -------------------------------------------

assert.equal(slugifyTitle("Global Checkout!!"), "global-checkout");
assert.equal(buildRoomId("Global Checkout", "abc123"), "global-checkout-abc123");
assert.equal(buildRoomId("!!!", "abc123"), "", "a title with no usable characters yields no room id");

// Every section below this point may trigger a real login/delete link flow.
const realPath = process.env.PATH;
blockRealBrowser();

// --- credentials.json: mode, and malformed-file-is-absent-credential ------

{
  const homeDir = tempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;

  const { readCredential, writeCredential, clearCredential } = await import(
    join(SKILL_DIR, "scripts", "credentials.mjs")
  );

  const origin = "http://localhost:3000";
  const credPath = join(homeDir, ".truss", "credentials.json");

  assert.equal(await readCredential(origin), null, "no file yet reads as no credential");

  const token = mintToken();
  await writeCredential(origin, token);

  assert.equal(statSync(join(homeDir, ".truss")).mode & 0o777, 0o700, "credentials directory is created 0700");
  assert.equal(statSync(credPath).mode & 0o777, 0o600, "credentials file is created 0600");
  assert.equal(await readCredential(origin), token);

  await clearCredential(origin);
  assert.equal(await readCredential(origin), null, "a cleared credential reads as absent");

  writeFileSync(credPath, "not json{{{", { mode: 0o600 });
  assert.equal(await readCredential(origin), null, "invalid JSON is treated as no credential");

  writeFileSync(credPath, JSON.stringify({ nope: true }), { mode: 0o600 });
  assert.equal(await readCredential(origin), null, "well-formed JSON in the wrong shape is treated as no credential");

  writeFileSync(credPath, JSON.stringify({ version: 2, origins: { [origin]: { token } } }), { mode: 0o600 });
  assert.equal(await readCredential(origin), null, "a future/unknown version is treated as no credential");

  process.env.HOME = previousHome;
  rmSync(homeDir, { recursive: true, force: true });
}

// --- headless edit happy path (cached credential, stubbed Truss API) ------

async function withHome(run) {
  const homeDir = tempHome();
  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    await run(homeDir);
  } finally {
    process.env.HOME = previousHome;
    rmSync(homeDir, { recursive: true, force: true });
  }
}

await withHome(async (homeDir) => {
  const token = mintToken();
  const graph = { version: 1, nodes: [{ id: "a", label: "A", shape: "rectangle", color: "blue", x: 0, y: 0 }], edges: [] };
  const desiredGraph = { version: 1, nodes: [{ id: "a", label: "A renamed", shape: "rectangle", color: "blue", x: 0, y: 0 }], edges: [] };
  const fingerprint = "a".repeat(64);

  const stub = await createStubServer(
    new Map([
      ["GET /api/projects", [({ headers }) => {
        assert.equal(headers.authorization, `Bearer ${token}`);
        return { status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } };
      }]],
      ["GET /api/projects/p1/agent-graph", [({ headers }) => {
        assert.equal(headers.authorization, `Bearer ${token}`);
        return { status: 200, body: { graph, opaqueNodeIds: ["opaque-1"], fingerprint } };
      }]],
      ["POST /api/projects/p1/agent-graph-edit", [({ headers, body }) => {
        assert.equal(headers.authorization, `Bearer ${token}`);
        assert.deepEqual(body, { fingerprint, graph: desiredGraph });
        return { status: 200, body: { applied: true } };
      }]],
    ]),
  );
  seedCredential(homeDir, stub.origin, token);

  const { projects } = await listDiagrams(stub.origin);
  assert.deepEqual(projects, [{ id: "p1", name: "Payments" }]);

  const read = await getDiagram(stub.origin, "p1");
  assert.deepEqual(read.graph, graph);
  assert.deepEqual(read.opaqueNodeIds, ["opaque-1"]);
  assert.equal(read.fingerprint, fingerprint);

  const applied = await applyDiagramEdit(stub.origin, "p1", read.fingerprint, desiredGraph);
  assert.equal(applied.editorUrl, `${stub.origin}/editor/p1`);

  await stub.close();
});

// --- a hallucinated projectId is rejected, never reaches the graph read ---

await withHome(async (homeDir) => {
  const token = mintToken();
  const stub = await createStubServer(
    new Map([
      ["GET /api/projects", [() => ({ status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } })]],
    ]),
  );
  seedCredential(homeDir, stub.origin, token);

  await assert.rejects(getDiagram(stub.origin, "not-in-the-list"), (error) => {
    assert.equal(error.message, "The agent chose a project we don't recognize.");
    return true;
  });

  await stub.close();
});

// --- a 409 retries exactly once from a fresh read, then fails cleanly -----

await withHome(async (homeDir) => {
  const token = mintToken();
  const graph = { version: 1, nodes: [{ id: "a", label: "A", shape: "circle", color: "green", x: 0, y: 0 }], edges: [] };
  let graphReads = 0;
  let editAttempts = 0;

  const stub = await createStubServer(
    new Map([
      ["GET /api/projects", [() => ({ status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } })]],
      ["GET /api/projects/p1/agent-graph", [
        () => { graphReads += 1; return { status: 200, body: { graph, opaqueNodeIds: [], fingerprint: `${graphReads}`.repeat(64).slice(0, 64) } }; },
        () => { graphReads += 1; return { status: 200, body: { graph, opaqueNodeIds: [], fingerprint: `${graphReads}`.repeat(64).slice(0, 64) } }; },
      ]],
      ["POST /api/projects/p1/agent-graph-edit", [
        () => { editAttempts += 1; return { status: 409, body: { error: "stale" } }; },
        () => { editAttempts += 1; return { status: 409, body: { error: "stale" } }; },
      ]],
    ]),
  );
  seedCredential(homeDir, stub.origin, token);

  const read = await getDiagram(stub.origin, "p1");
  await assert.rejects(applyDiagramEdit(stub.origin, "p1", read.fingerprint, graph), (error) => {
    assert.equal(error.message, "This diagram is being actively edited elsewhere. Please try again in a moment.");
    return true;
  });
  assert.equal(editAttempts, 2, "the edit is posted exactly twice: initial + one retry");
  assert.equal(graphReads, 2, "the graph is read once by getDiagram and once for the 409 retry");

  await stub.close();
});

// --- no cached credential: an operation links inline before continuing ----

await withHome(async (homeDir) => {
  const newToken = mintToken();

  const stub = await createStubServer(
    new Map([
      ["GET /api/projects", [({ headers }) => {
        assert.equal(headers.authorization, `Bearer ${newToken}`);
        return { status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } };
      }]],
    ]),
  );
  // Deliberately no seedCredential call: the credentials file does not exist.

  const linkUrlPromise = interceptStdoutLine();
  const listPromise = listDiagrams(stub.origin);
  await performBrowserLinkCallback(linkUrlPromise, stub.origin, newToken);

  const { projects } = await listPromise;
  assert.deepEqual(projects, [{ id: "p1", name: "Payments" }]);

  const credPath = join(homeDir, ".truss", "credentials.json");
  assert.ok(existsSync(credPath), "the newly-linked token is cached for next time");
  assert.equal(statSync(credPath).mode & 0o777, 0o600);

  await stub.close();
});

// --- a 401 clears the credential and relinks exactly once, then succeeds --

await withHome(async (homeDir) => {
  const staleToken = mintToken();
  const newToken = mintToken();
  let projectCalls = 0;

  const stub = await createStubServer(
    new Map([
      ["GET /api/projects", [
        ({ headers }) => {
          projectCalls += 1;
          assert.equal(headers.authorization, `Bearer ${staleToken}`, "first attempt uses the stale cached token");
          return { status: 401, body: { error: "Unauthorized" } };
        },
        ({ headers }) => {
          projectCalls += 1;
          assert.equal(headers.authorization, `Bearer ${newToken}`, "retry uses the freshly-linked token");
          return { status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } };
        },
      ]],
    ]),
  );
  seedCredential(homeDir, stub.origin, staleToken);

  const linkUrlPromise = interceptStdoutLine();
  const listPromise = listDiagrams(stub.origin);
  await performBrowserLinkCallback(linkUrlPromise, stub.origin, newToken);
  const { projects } = await listPromise;

  assert.deepEqual(projects, [{ id: "p1", name: "Payments" }]);
  assert.equal(projectCalls, 2, "exactly one retry after the single relink");

  const raw = JSON.parse(readFileSync(join(homeDir, ".truss", "credentials.json"), "utf8"));
  assert.equal(raw.origins[stub.origin].token, newToken, "the cache now holds the new token");

  await stub.close();
});

// --- a 401 that persists after the one relink fails cleanly, no second relink

await withHome(async (homeDir) => {
  const staleToken = mintToken();
  let projectCalls = 0;

  const stub = await createStubServer(
    new Map([
      ["GET /api/projects", [
        () => { projectCalls += 1; return { status: 401, body: { error: "Unauthorized" } }; },
        () => { projectCalls += 1; return { status: 401, body: { error: "Unauthorized" } }; },
      ]],
    ]),
  );
  seedCredential(homeDir, stub.origin, staleToken);

  const linkUrlPromise = interceptStdoutLine();
  const listPromise = listDiagrams(stub.origin);
  await performBrowserLinkCallback(linkUrlPromise, stub.origin, mintToken());

  await assert.rejects(listPromise, (error) => {
    assert.equal(error.message, "We couldn't read your projects. Please try again.");
    return true;
  });
  assert.equal(projectCalls, 2, "the request is retried exactly once after the relink");

  await stub.close();
});

// --- headless create ---------------------------------------------------

await withHome(async (homeDir) => {
  const token = mintToken();
  const seen = {};

  const stub = await createStubServerDynamic((method, pathname, ctx) => {
    if (method === "POST" && pathname === "/api/projects") {
      seen.createAuth = ctx.headers.authorization;
      seen.createdId = ctx.body.id;
      seen.createdName = ctx.body.name;
      return { status: 201, body: { project: { id: ctx.body.id, name: ctx.body.name } } };
    }
    if (method === "POST" && pathname === `/api/projects/${seen.createdId}/agent-launch-import`) {
      seen.importAuth = ctx.headers.authorization;
      seen.importLaunchId = ctx.body.launchId;
      seen.importGraph = ctx.body.graph;
      return { status: 200, body: { imported: true } };
    }
    if (method === "GET" && pathname === "/api/projects") {
      return { status: 200, body: { projects: [{ id: seen.createdId, name: seen.createdName }] } };
    }
    return null;
  });
  seedCredential(homeDir, stub.origin, token);

  const result = await createDiagram(stub.origin, "My Diagram", GRAPH);

  assert.equal(result.editorUrl, `${stub.origin}/editor/${seen.createdId}`);
  assert.equal(seen.createAuth, `Bearer ${token}`, "create must send the bearer token");
  assert.equal(seen.importAuth, `Bearer ${token}`, "import must send the bearer token");
  assert.equal(seen.createdName, "My Diagram");
  assert.match(seen.createdId, /^my-diagram-[0-9a-f]{6}$/, "room id is slug+suffix");
  assert.match(seen.importLaunchId, UUID_V4_PATTERN, "import carries a launch id");
  assert.deepEqual(seen.importGraph, GRAPH, "the graph reaches the import route unchanged");

  const cached = JSON.parse(readFileSync(join(homeDir, ".truss", "credentials.json"), "utf8")).origins[stub.origin];
  assert.ok(cached.projects.some((project) => project.id === seen.createdId), "create refreshes the project cache");

  await stub.close();
});

await withHome(async (homeDir) => {
  const token = mintToken();
  const attempted = [];
  let created = null;

  const stub = await createStubServerDynamic((method, pathname, ctx) => {
    if (method === "POST" && pathname === "/api/projects") {
      attempted.push(ctx.body.id);
      if (attempted.length === 1) return { status: 409, body: { error: "taken" } };
      created = ctx.body.id;
      return { status: 201, body: { project: { id: ctx.body.id, name: ctx.body.name } } };
    }
    if (method === "POST" && pathname === `/api/projects/${created}/agent-launch-import`) {
      return { status: 200, body: { imported: true } };
    }
    if (method === "GET" && pathname === "/api/projects") {
      return { status: 200, body: { projects: [] } };
    }
    return null;
  });
  seedCredential(homeDir, stub.origin, token);

  const result = await createDiagram(stub.origin, "My Diagram", GRAPH);

  assert.ok(result.editorUrl);
  assert.equal(attempted.length, 2, "exactly one retry after the collision");
  assert.notEqual(attempted[0], attempted[1], "the retry draws a fresh suffix");

  await stub.close();
});

await withHome(async (homeDir) => {
  const token = mintToken();
  let created = null;

  const stub = await createStubServerDynamic((method, pathname, ctx) => {
    if (method === "POST" && pathname === "/api/projects") {
      created = ctx.body.id;
      return { status: 201, body: { project: { id: ctx.body.id, name: ctx.body.name } } };
    }
    if (method === "POST" && pathname === `/api/projects/${created}/agent-launch-import`) {
      return { status: 502, body: { error: "nope" } };
    }
    return null;
  });
  seedCredential(homeDir, stub.origin, token);

  await assert.rejects(createDiagram(stub.origin, "My Diagram", GRAPH), (error) => {
    // The project exists and is empty; the message has to say so and point at
    // it, rather than implying nothing happened.
    assert.match(error.message, /created but the diagram could not be drawn/);
    assert.ok(error.message.includes(`${stub.origin}/editor/${created}`), "names the editor URL");
    return true;
  });

  await stub.close();
});

// --- project cache: fresh, stale, and cache-miss-before-rejecting ---------

await withHome(async (homeDir) => {
  const token = mintToken();
  let projectListCalls = 0;

  const stub = await createStubServerDynamic((method, pathname) => {
    if (method === "GET" && pathname === "/api/projects") {
      projectListCalls += 1;
      return { status: 200, body: { projects: [{ id: "p1", name: "Cached" }] } };
    }
    return null;
  });
  seedCredentialWithProjects(homeDir, stub.origin, token, [{ id: "p1", name: "Cached" }], Date.now());

  const { projects } = await listDiagrams(stub.origin);
  assert.deepEqual(projects, [{ id: "p1", name: "Cached" }]);
  assert.equal(projectListCalls, 0, "a fresh cache must not hit the network");

  await stub.close();
});

await withHome(async (homeDir) => {
  const token = mintToken();
  let projectListCalls = 0;

  const stub = await createStubServerDynamic((method, pathname) => {
    if (method === "GET" && pathname === "/api/projects") {
      projectListCalls += 1;
      return { status: 200, body: { projects: [{ id: "p2", name: "Fresh" }] } };
    }
    return null;
  });
  // Older than the 5-minute TTL.
  seedCredentialWithProjects(homeDir, stub.origin, token, [{ id: "p1", name: "Stale" }], Date.now() - 600_000);

  const { projects } = await listDiagrams(stub.origin);
  assert.equal(projectListCalls, 1, "a stale cache must refetch");
  assert.deepEqual(projects, [{ id: "p2", name: "Fresh" }], "serves the fresh list");

  await stub.close();
});

await withHome(async (homeDir) => {
  const token = mintToken();
  let projectListCalls = 0;

  const stub = await createStubServerDynamic((method, pathname) => {
    if (method === "GET" && pathname === "/api/projects") {
      projectListCalls += 1;
      // The project was created after the cache was written.
      return { status: 200, body: { projects: [{ id: "p1", name: "Cached" }, { id: "new", name: "Brand New" }] } };
    }
    if (method === "GET" && pathname === "/api/projects/new/agent-graph") {
      return { status: 200, body: { graph: GRAPH, opaqueNodeIds: [], fingerprint: "a".repeat(64) } };
    }
    return null;
  });
  seedCredentialWithProjects(homeDir, stub.origin, token, [{ id: "p1", name: "Cached" }], Date.now());

  const read = await getDiagram(stub.origin, "new");
  assert.deepEqual(read.graph, GRAPH, "a cache miss refetches instead of rejecting outright");
  assert.equal(projectListCalls, 1, "exactly one forced refetch");

  await stub.close();
});

await withHome(async (homeDir) => {
  const token = mintToken();

  const stub = await createStubServerDynamic((method, pathname) => {
    if (method === "GET" && pathname === "/api/projects") {
      return { status: 200, body: { projects: [{ id: "p1", name: "Cached" }] } };
    }
    return null;
  });
  seedCredentialWithProjects(homeDir, stub.origin, token, [{ id: "p1", name: "Cached" }], Date.now());

  await assert.rejects(getDiagram(stub.origin, "ghost"), (error) => {
    assert.match(error.message, /don't recognize/);
    return true;
  });

  await stub.close();
});

// --- login primes the project cache ---------------------------------------

await withHome(async (homeDir) => {
  const token = mintToken();

  const stub = await createStubServerDynamic((method, pathname, ctx) => {
    if (method === "GET" && pathname === "/api/projects") {
      assert.equal(ctx.headers.authorization, `Bearer ${token}`);
      return { status: 200, body: { projects: [{ id: "p1", name: "Primed" }] } };
    }
    return null;
  });

  const linkUrlPromise = interceptStdoutLine();
  const loginPromise = login(stub.origin);
  await performBrowserLinkCallback(linkUrlPromise, stub.origin, token);
  await loginPromise;

  const stored = JSON.parse(readFileSync(join(homeDir, ".truss", "credentials.json"), "utf8"));
  assert.deepEqual(stored.origins[stub.origin].projects, [{ id: "p1", name: "Primed" }], "login writes the cache to disk");
  assert.equal(typeof stored.origins[stub.origin].projectsFetchedAt, "number");

  await stub.close();
});

// --- clearing a credential drops its cached projects too -------------------

await withHome(async () => {
  const { clearCredential, readProjects, writeCredential, writeProjects } = await import(
    join(SKILL_DIR, "scripts", "credentials.mjs")
  );
  // A re-link can be a different user; a surviving list would resolve names
  // against the previous account's projects.
  await writeCredential("http://example.test", mintToken());
  await writeProjects("http://example.test", [{ id: "p1", name: "Theirs" }]);
  assert.ok(await readProjects("http://example.test"));
  await clearCredential("http://example.test");
  assert.equal(await readProjects("http://example.test"), null);
});

// --- delete: never deletes anything itself, and cannot silently no-op ------
//
// Unlike login, delete has no headless/SSH fallback — see promptDeleteDiagram's
// own docstring: there is no server-side check standing in for the human's
// own confirm click, so a browser that fails to open must fail the whole
// call rather than pretend the relay happened. This is the one path in the
// skill where a blocked PATH (this file's stand-in for "no browser
// available") produces the same failure a real headless box would hit.

await withHome(async (homeDir) => {
  const token = mintToken();
  const stub = await createStubServer(new Map());
  seedCredential(homeDir, stub.origin, token);

  await assert.rejects(promptDeleteDiagram(stub.origin, "p1"), (error) => {
    assert.equal(error.message, "Unable to open Truss in a browser.");
    return true;
  });

  await stub.close();
});

await withHome(async (homeDir) => {
  const token = mintToken();
  const stub = await createStubServer(new Map());
  seedCredential(homeDir, stub.origin, token);

  await assert.rejects(promptDeleteDiagram(stub.origin, ""), (error) => {
    assert.equal(error.message, "A project id is required.");
    return true;
  });

  await stub.close();
});

// --- SKILL.md / operations.md describe the MCP tool contract --------------

const skillMarkdown = await readFile(join(SKILL_DIR, "SKILL.md"), "utf8");
assert.match(skillMarkdown, /^---\nname: truss-diagram\n/, "frontmatter name is truss-diagram");
assert.match(skillMarkdown, /\bcreate\b/i, "SKILL.md references create");
assert.match(skillMarkdown, /\bedit\b/i, "SKILL.md references edit");
assert.match(skillMarkdown, /\bdelete\b/i, "SKILL.md references delete");
assert.match(skillMarkdown, /truss_list_diagrams/, "SKILL.md names the MCP tools, not the retired CLI protocol");
assert.match(skillMarkdown, /operations\.md/, "SKILL.md points to references/operations.md");

const operationsMarkdown = await readFile(join(SKILL_DIR, "references", "operations.md"), "utf8");
assert.match(operationsMarkdown, /empty library, editing/i, "operations.md covers the empty-library branch for edit");
assert.match(operationsMarkdown, /empty library, deleting/i, "operations.md covers the empty-library branch for delete");
assert.match(operationsMarkdown, /truss_apply_diagram_edit/, "operations.md names the edit tool");
assert.match(operationsMarkdown, /truss_delete_diagram_prompt/, "operations.md names the delete tool");

unblockRealBrowser(realPath);
console.info("Truss diagram core checks passed");
