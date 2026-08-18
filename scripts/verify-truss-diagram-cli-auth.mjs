import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Headless `--op edit`/`--op login` — no browser tab. Covers:
//   - ~/.truss/credentials.json: mode, malformed-file handling
//   - buildLinkUrl's fragment round-trips
//   - the headless edit happy path against a stub Truss backend
//   - the hallucinated-projectId guard the browser used to own
//   - the 409-retry-once-then-fail path
//   - absent-credential-triggers-inline-login, and 401-triggers-relink-once
//
// `open`/`xdg-open` is never let to actually run: every spawned child gets a
// PATH with nothing in it, so openLaunchUrl's spawn fails with ENOENT and
// performLink falls back to the printed URL — the same fallback a real
// headless SSH session hits. That fallback URL is what these tests act on
// (as the "browser" would) to complete each link exchange.
const watchdog = setTimeout(() => {
  console.error("verify-truss-diagram-cli-auth: TIMED OUT — a child process never exited.");
  process.exit(1);
}, 30_000);
watchdog.unref();

const SKILL_SCRIPT = fileURLToPath(
  new URL("../.agents/skills/truss-diagram/scripts/truss-diagram.mjs", import.meta.url),
);
const BLOCKED_PATH = "/truss-cli-auth-verifier-no-such-directory";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function mintToken() {
  return `trs_agent_${randomBytes(32).toString("base64url")}`;
}

function tempHome() {
  return mkdtempSync(join(tmpdir(), "truss-cli-home-"));
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

// A minimal stand-in for the real Truss API. `routes` maps "METHOD path" to
// a queue of responder functions, one consumed per matching request — lets a
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

function spawnCli(args, homeDir) {
  const child = spawn(process.execPath, [SKILL_SCRIPT, ...args], {
    env: { ...process.env, HOME: homeDir, PATH: BLOCKED_PATH },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const it = rl[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    async nextLine() {
      const { value, done } = await it.next();
      if (done) throw new Error(`child stdout closed early. stderr:\n${stderr}`);
      return value;
    },
    async nextEvent() {
      return JSON.parse(await this.nextLine());
    },
    writeLine(value) {
      child.stdin.write(`${JSON.stringify(value)}\n`);
    },
    getStderr: () => stderr,
    waitExit() {
      return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
    },
  };
}

// Decodes a printed `/agent/link#…` URL and answers it as the browser would:
// POST {nonce, token} to the loopback and expect {ok:true}. Exercises the
// real production `buildLinkUrl` output end to end (no stand-in parser).
async function performBrowserLinkCallback(cli, allowedOrigin, tokenToSend) {
  const line = (await cli.nextLine()).trim();
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

// --- 1. credentials.json: mode, and malformed-file-is-absent-credential ---
{
  const originalHome = process.env.HOME;
  const homeDir = tempHome();
  process.env.HOME = homeDir;

  // credentials.mjs computes its path from homedir() once, at import time,
  // so HOME must be set before this first import.
  const { readCredential, writeCredential, clearCredential } = await import(
    "../.agents/skills/truss-diagram/scripts/credentials.mjs"
  );

  const origin = "http://localhost:3000";
  const credPath = join(homeDir, ".truss", "credentials.json");

  assert.equal(await readCredential(origin), null, "no file yet reads as no credential");

  const token = mintToken();
  await writeCredential(origin, token);

  assert.equal(
    statSync(join(homeDir, ".truss")).mode & 0o777,
    0o700,
    "credentials directory is created 0700",
  );
  assert.equal(statSync(credPath).mode & 0o777, 0o600, "credentials file is created 0600");
  assert.equal(await readCredential(origin), token);

  await clearCredential(origin);
  assert.equal(await readCredential(origin), null, "a cleared credential reads as absent");

  writeFileSync(credPath, "not json{{{", { mode: 0o600 });
  assert.equal(await readCredential(origin), null, "invalid JSON is treated as no credential");

  writeFileSync(credPath, JSON.stringify({ nope: true }), { mode: 0o600 });
  assert.equal(
    await readCredential(origin),
    null,
    "well-formed JSON in the wrong shape is treated as no credential",
  );

  writeFileSync(
    credPath,
    JSON.stringify({ version: 2, origins: { [origin]: { token } } }),
    { mode: 0o600 },
  );
  assert.equal(await readCredential(origin), null, "a future/unknown version is treated as no credential");

  process.env.HOME = originalHome;
  rmSync(homeDir, { recursive: true, force: true });
}

// --- 2. buildLinkUrl fragment round-trips ---
{
  const { buildLinkUrl } = await import(
    "../.agents/skills/truss-diagram/scripts/truss-diagram.mjs"
  );
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

// --- 3. headless edit happy path (cached credential, stubbed Truss API) ---
{
  const homeDir = tempHome();
  const token = mintToken();
  const graph = {
    version: 1,
    nodes: [{ id: "a", label: "A", shape: "rectangle", color: "blue", x: 0, y: 0 }],
    edges: [],
  };
  const desiredGraph = {
    version: 1,
    nodes: [{ id: "a", label: "A renamed", shape: "rectangle", color: "blue", x: 0, y: 0 }],
    edges: [],
  };
  const fingerprint = "a".repeat(64);

  const stub = await createStubServer(
    new Map([
      [
        "GET /api/projects",
        [
          ({ headers }) => {
            assert.equal(headers.authorization, `Bearer ${token}`);
            return { status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } };
          },
        ],
      ],
      [
        "GET /api/projects/p1/agent-graph",
        [
          ({ headers }) => {
            assert.equal(headers.authorization, `Bearer ${token}`);
            return { status: 200, body: { graph, opaqueNodeIds: ["opaque-1"], fingerprint } };
          },
        ],
      ],
      [
        "POST /api/projects/p1/agent-graph-edit",
        [
          ({ headers, body }) => {
            assert.equal(headers.authorization, `Bearer ${token}`);
            assert.deepEqual(body, { fingerprint, graph: desiredGraph });
            return { status: 200, body: { applied: true } };
          },
        ],
      ],
    ]),
  );
  seedCredential(homeDir, stub.origin, token);

  const cli = spawnCli(["--op", "edit", "--base-url", stub.origin], homeDir);

  // Byte-identical to the pre-headless protocol event shapes (references/operations.md).
  assert.deepEqual(await cli.nextEvent(), {
    event: "projects",
    projects: [{ id: "p1", name: "Payments" }],
  });
  cli.writeLine({ projectId: "p1" });

  assert.deepEqual(await cli.nextEvent(), {
    event: "graph",
    graph,
    opaqueNodeIds: ["opaque-1"],
    fingerprint,
  });
  cli.writeLine({ desiredGraph });
  cli.child.stdin.end();

  assert.deepEqual(await cli.nextEvent(), {
    event: "done",
    editorUrl: `${stub.origin}/editor/p1`,
  });
  assert.equal(await cli.waitExit(), 0, cli.getStderr());

  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

// --- 4. a hallucinated projectId is rejected, never reaches the graph read ---
{
  const homeDir = tempHome();
  const token = mintToken();
  const stub = await createStubServer(
    new Map([
      [
        "GET /api/projects",
        [() => ({ status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } })],
      ],
    ]),
  );
  seedCredential(homeDir, stub.origin, token);

  const cli = spawnCli(["--op", "edit", "--base-url", stub.origin], homeDir);
  await cli.nextEvent();
  cli.writeLine({ projectId: "not-in-the-list" });
  cli.child.stdin.end();

  assert.deepEqual(await cli.nextEvent(), {
    event: "error",
    message: "The agent chose a project we don't recognize.",
  });
  assert.equal(await cli.waitExit(), 1);

  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

// --- 5. a 409 retries exactly once from a fresh read, then fails cleanly ---
{
  const homeDir = tempHome();
  const token = mintToken();
  const graph = { version: 1, nodes: [{ id: "a", label: "A", shape: "circle", color: "green", x: 0, y: 0 }], edges: [] };
  const desiredGraph = graph;
  let graphReads = 0;
  let editAttempts = 0;

  const stub = await createStubServer(
    new Map([
      [
        "GET /api/projects",
        [() => ({ status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } })],
      ],
      [
        "GET /api/projects/p1/agent-graph",
        [
          () => {
            graphReads += 1;
            return { status: 200, body: { graph, opaqueNodeIds: [], fingerprint: `${graphReads}`.repeat(64).slice(0, 64) } };
          },
          () => {
            graphReads += 1;
            return { status: 200, body: { graph, opaqueNodeIds: [], fingerprint: `${graphReads}`.repeat(64).slice(0, 64) } };
          },
        ],
      ],
      [
        "POST /api/projects/p1/agent-graph-edit",
        [
          () => {
            editAttempts += 1;
            return { status: 409, body: { error: "stale" } };
          },
          () => {
            editAttempts += 1;
            return { status: 409, body: { error: "stale" } };
          },
        ],
      ],
    ]),
  );
  seedCredential(homeDir, stub.origin, token);

  const cli = spawnCli(["--op", "edit", "--base-url", stub.origin], homeDir);
  await cli.nextEvent();
  cli.writeLine({ projectId: "p1" });
  await cli.nextEvent();
  cli.writeLine({ desiredGraph });
  cli.child.stdin.end();

  assert.deepEqual(await cli.nextEvent(), {
    event: "error",
    message: "This diagram is being actively edited elsewhere. Please try again in a moment.",
  });
  assert.equal(await cli.waitExit(), 1);
  assert.equal(editAttempts, 2, "the edit is posted exactly twice: initial + one retry");
  assert.equal(graphReads, 2, "the graph is read once initially and once for the 409 retry");

  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

// --- 6. no cached credential: edit links inline before continuing ---
{
  const homeDir = tempHome();
  const newToken = mintToken();
  const graph = { version: 1, nodes: [{ id: "a", label: "A", shape: "pill", color: "purple", x: 0, y: 0 }], edges: [] };
  const fingerprint = "b".repeat(64);

  const stub = await createStubServer(
    new Map([
      [
        "GET /api/projects",
        [
          ({ headers }) => {
            assert.equal(headers.authorization, `Bearer ${newToken}`);
            return { status: 200, body: { projects: [{ id: "p1", name: "Payments" }] } };
          },
        ],
      ],
      [
        "GET /api/projects/p1/agent-graph",
        [() => ({ status: 200, body: { graph, opaqueNodeIds: [], fingerprint } })],
      ],
      [
        "POST /api/projects/p1/agent-graph-edit",
        [() => ({ status: 200, body: { applied: true } })],
      ],
    ]),
  );
  // Deliberately no seedCredential call: the credentials file does not exist.

  const cli = spawnCli(["--op", "edit", "--base-url", stub.origin], homeDir);
  await performBrowserLinkCallback(cli, stub.origin, newToken);

  assert.deepEqual(await cli.nextEvent(), {
    event: "projects",
    projects: [{ id: "p1", name: "Payments" }],
  });
  cli.writeLine({ projectId: "p1" });
  await cli.nextEvent();
  cli.writeLine({ desiredGraph: graph });
  cli.child.stdin.end();

  assert.deepEqual(await cli.nextEvent(), {
    event: "done",
    editorUrl: `${stub.origin}/editor/p1`,
  });
  assert.equal(await cli.waitExit(), 0, cli.getStderr());

  const credPath = join(homeDir, ".truss", "credentials.json");
  assert.ok(existsSync(credPath), "the newly-linked token is cached for next time");
  assert.equal(statSync(credPath).mode & 0o777, 0o600);

  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

// --- 7. a 401 clears the credential and relinks exactly once, then succeeds ---
{
  const homeDir = tempHome();
  const staleToken = mintToken();
  const newToken = mintToken();
  const graph = { version: 1, nodes: [{ id: "a", label: "A", shape: "hexagon", color: "teal", x: 0, y: 0 }], edges: [] };
  const fingerprint = "c".repeat(64);
  let projectCalls = 0;

  const stub = await createStubServer(
    new Map([
      [
        "GET /api/projects",
        [
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
        ],
      ],
      [
        "GET /api/projects/p1/agent-graph",
        [() => ({ status: 200, body: { graph, opaqueNodeIds: [], fingerprint } })],
      ],
      [
        "POST /api/projects/p1/agent-graph-edit",
        [() => ({ status: 200, body: { applied: true } })],
      ],
    ]),
  );
  seedCredential(homeDir, stub.origin, staleToken);

  const cli = spawnCli(["--op", "edit", "--base-url", stub.origin], homeDir);
  await performBrowserLinkCallback(cli, stub.origin, newToken);

  assert.deepEqual(await cli.nextEvent(), {
    event: "projects",
    projects: [{ id: "p1", name: "Payments" }],
  });
  cli.writeLine({ projectId: "p1" });
  await cli.nextEvent();
  cli.writeLine({ desiredGraph: graph });
  cli.child.stdin.end();

  assert.deepEqual(await cli.nextEvent(), {
    event: "done",
    editorUrl: `${stub.origin}/editor/p1`,
  });
  assert.equal(await cli.waitExit(), 0, cli.getStderr());
  assert.equal(projectCalls, 2, "exactly one retry after the single relink");

  // Read the file directly rather than through credentials.mjs: that module
  // binds its path to HOME at first import (see test 1), which already ran
  // with a different HOME in this same process.
  const raw = JSON.parse(await readFile(join(homeDir, ".truss", "credentials.json"), "utf8"));
  assert.equal(raw.origins[stub.origin].token, newToken, "the cache now holds the new token");

  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

// --- 8. a 401 that persists after the one relink fails cleanly, no second relink ---
{
  const homeDir = tempHome();
  const staleToken = mintToken();
  let projectCalls = 0;
  let linkCalls = 0;

  const stub = await createStubServer(
    new Map([
      [
        "GET /api/projects",
        [
          () => {
            projectCalls += 1;
            return { status: 401, body: { error: "Unauthorized" } };
          },
          () => {
            projectCalls += 1;
            return { status: 401, body: { error: "Unauthorized" } };
          },
        ],
      ],
    ]),
  );
  seedCredential(homeDir, stub.origin, staleToken);

  const cli = spawnCli(["--op", "edit", "--base-url", stub.origin], homeDir);
  cli.child.stdin.end();

  const relinkedToken = mintToken();
  const payload = await performBrowserLinkCallback(cli, stub.origin, relinkedToken);
  linkCalls += 1;
  void payload;

  assert.deepEqual(await cli.nextEvent(), {
    event: "error",
    message: "We couldn't read your projects. Please try again.",
  });
  assert.equal(await cli.waitExit(), 1);
  assert.equal(projectCalls, 2, "the request is retried exactly once after the relink");
  assert.equal(linkCalls, 1, "only one link exchange happens for the whole run");

  await stub.close();
  rmSync(homeDir, { recursive: true, force: true });
}

console.log("verify-truss-diagram-cli-auth: ok");
