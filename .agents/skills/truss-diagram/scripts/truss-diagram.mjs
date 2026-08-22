import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

import {
  clearCredential,
  readCredential,
  readProjects,
  writeCredential,
  writeProjects,
} from "./credentials.mjs";
import { startLoopback } from "./loopback.mjs";

const MAX_TITLE_LENGTH = 120;
const MAX_GRAPH_NODES = 40;
const MAX_GRAPH_EDGES = 60;
const MAX_NODE_ID_LENGTH = 48;
const MAX_NODE_LABEL_LENGTH = 80;
const MAX_EDGE_LABEL_LENGTH = 40;
const MAX_FRAGMENT_LENGTH = 16_384;
const MIN_POSITION = -10_000;
const MAX_POSITION = 10_000;
const DEFAULT_BASE_URL = "http://localhost:3000";
// Matches the loopback's idle timeout (Global Constraints: 120000 ms).
const LOOPBACK_TIMEOUT_MS = 120_000;
const LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GRAPH_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// trs_agent_ + base64url(32 random bytes) — see the shared agent-auth
// contract. 32 bytes encodes to exactly 43 base64url characters.
const AGENT_TOKEN_PATTERN = /^trs_agent_[A-Za-z0-9_-]{43}$/;
const MAX_EDIT_ATTEMPTS = 2;
// How long a cached project list may answer a resolution before it is
// refetched. Short: the cache exists to skip a round trip, not to be a source
// of truth, and a stale miss costs the user a wrong answer about their own
// library.
const PROJECTS_CACHE_TTL_MS = 300_000;
const MAX_SLUG_LENGTH = 60;
const ROOM_ID_SUFFIX_LENGTH = 6;
const MAX_ROOM_ID_ATTEMPTS = 3;
const OPS = new Set(["create", "edit", "delete", "login"]);
const SHAPES = new Set([
  "rectangle",
  "diamond",
  "circle",
  "pill",
  "cylinder",
  "hexagon",
]);
const COLORS = new Set([
  "neutral",
  "blue",
  "purple",
  "orange",
  "red",
  "pink",
  "green",
  "teal",
]);

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.has(key));
}

function isGraphId(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_NODE_ID_LENGTH &&
    GRAPH_ID_PATTERN.test(value)
  );
}

function isTrimmedString(value, maximumLength, allowEmpty = false) {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximumLength
  );
}

function validateGraph(rawGraph) {
  if (
    rawGraph === null ||
    typeof rawGraph !== "object" ||
    Array.isArray(rawGraph) ||
    !hasOnlyKeys(rawGraph, new Set(["version", "nodes", "edges"]))
  ) {
    throw new Error("The graph must use the compact graph contract.");
  }
  if (
    rawGraph.version !== 1 ||
    !Array.isArray(rawGraph.nodes) ||
    !Array.isArray(rawGraph.edges) ||
    rawGraph.nodes.length < 1 ||
    rawGraph.nodes.length > MAX_GRAPH_NODES ||
    rawGraph.edges.length > MAX_GRAPH_EDGES
  ) {
    throw new Error("The graph is outside its allowed limits.");
  }

  const nodeIds = new Set();
  const nodes = rawGraph.nodes.map((node) => {
    if (
      node === null ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      !hasOnlyKeys(
        node,
        new Set(["id", "label", "shape", "color", "x", "y"]),
      ) ||
      !isGraphId(node.id) ||
      !isTrimmedString(node.label, MAX_NODE_LABEL_LENGTH) ||
      !SHAPES.has(node.shape) ||
      !COLORS.has(node.color) ||
      !Number.isInteger(node.x) ||
      !Number.isInteger(node.y) ||
      node.x < MIN_POSITION ||
      node.x > MAX_POSITION ||
      node.y < MIN_POSITION ||
      node.y > MAX_POSITION ||
      nodeIds.has(node.id)
    ) {
      throw new Error("The graph contains an invalid node.");
    }
    nodeIds.add(node.id);
    return {
      id: node.id,
      label: node.label,
      shape: node.shape,
      color: node.color,
      x: node.x,
      y: node.y,
    };
  });

  const edgeIds = new Set();
  const endpointPairs = new Set();
  const edges = rawGraph.edges.map((edge) => {
    if (
      edge === null ||
      typeof edge !== "object" ||
      Array.isArray(edge) ||
      !hasOnlyKeys(edge, new Set(["id", "source", "target", "label"])) ||
      !isGraphId(edge.id) ||
      !isGraphId(edge.source) ||
      !isGraphId(edge.target) ||
      !isTrimmedString(edge.label, MAX_EDGE_LABEL_LENGTH, true) ||
      edge.source === edge.target ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target) ||
      edgeIds.has(edge.id) ||
      endpointPairs.has(`${edge.source}\u0000${edge.target}`)
    ) {
      throw new Error("The graph contains an invalid edge.");
    }
    edgeIds.add(edge.id);
    endpointPairs.add(`${edge.source}\u0000${edge.target}`);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
    };
  });

  return { version: 1, nodes, edges };
}

function validateInput(rawInput) {
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput) ||
    !hasOnlyKeys(rawInput, new Set(["title", "graph"])) ||
    !isTrimmedString(rawInput.title, MAX_TITLE_LENGTH)
  ) {
    throw new Error("A non-empty title and valid graph are required.");
  }
  return { title: rawInput.title, graph: validateGraph(rawInput.graph) };
}

function parseArguments(argv) {
  const options = { baseUrl: undefined, stdinJson: false, op: "create" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdin-json") {
      if (options.stdinJson)
        throw new Error("--stdin-json may only be provided once.");
      options.stdinJson = true;
      continue;
    }
    if (argument === "--op") {
      const value = argv[index + 1];
      if (value === undefined || !OPS.has(value))
        throw new Error("--op requires one of create, edit, delete, login.");
      options.op = value;
      index += 1;
      continue;
    }
    if (argument !== "--base-url")
      throw new Error("Use --stdin-json, --op, and an optional --base-url.");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error("--base-url requires a value.");
    if (options.baseUrl !== undefined)
      throw new Error("--base-url may only be provided once.");
    options.baseUrl = value;
    index += 1;
  }
  return options;
}

function parseJsonObject(stdinJson) {
  if (typeof stdinJson !== "string") return stdinJson;
  try {
    return JSON.parse(stdinJson);
  } catch {
    throw new Error("--stdin-json must contain one valid JSON object.");
  }
}

export function parseLauncherInput(argv, stdinJson) {
  const options = parseArguments(argv);
  if (!options.stdinJson) throw new Error("--stdin-json is required.");
  return validateInput(parseJsonObject(stdinJson));
}

export function normalizeBaseUrl(rawUrl) {
  if (
    typeof rawUrl !== "string" ||
    !rawUrl.trim() ||
    rawUrl.includes("?") ||
    rawUrl.includes("#")
  )
    throw new Error("The Truss base URL must be an HTTP(S) origin.");
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("The Truss base URL must be an HTTP(S) origin.");
  }
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash
  )
    throw new Error(
      "The Truss base URL must be an HTTP(S) origin without a path.",
    );
  return parsedUrl.origin;
}

export function buildLaunchUrl(input, options) {
  const validatedInput = validateInput(input);
  const baseUrl = normalizeBaseUrl(options?.baseUrl);
  const launchId = options?.launchId ?? randomUUID();
  if (!LAUNCH_ID_PATTERN.test(launchId))
    throw new Error("The launch ID must be a canonical UUID v4.");
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, launchId, ...validatedInput }),
    "utf8",
  ).toString("base64url");
  if (encoded.length > MAX_FRAGMENT_LENGTH)
    throw new Error("The diagram is too large to launch.");
  return `${baseUrl}/agent/new#${encoded}`;
}

// Mirrors buildPickUrl: same shape, different page and payload. See the
// shared agent-auth contract for the exact fragment fields.
export function buildLinkUrl(baseUrl, { linkId, port, nonce }) {
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, linkId, port, nonce }),
    "utf8",
  ).toString("base64url");
  return `${normalizeBaseUrl(baseUrl)}/agent/link#${encoded}`;
}

export function buildPickUrl(baseUrl, { op, port, nonce, pickId }) {
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, pickId, op, port, nonce }),
    "utf8",
  ).toString("base64url");

  return `${normalizeBaseUrl(baseUrl)}/agent/pick#${encoded}`;
}

export function browserCommand(url, platform) {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32")
    return { command: "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
  if (platform === "linux") return { command: "xdg-open", args: [url] };
  throw new Error(`Opening a browser is not supported on ${platform}.`);
}

export async function openLaunchUrl(url, platform, spawnImpl = spawn) {
  const { command, args } = browserCommand(url, platform);
  let child;
  try {
    child = spawnImpl(command, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
    });
  } catch {
    throw new Error("Unable to open Truss in a browser.");
  }
  return new Promise((resolve, reject) => {
    child.once("error", () => {
      child.unref();
      reject(new Error("Unable to open Truss in a browser."));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function formatLauncherSuccess(baseUrl, launchId) {
  return `Truss opened at ${normalizeBaseUrl(baseUrl)} and will create a new project immediately (launch ${launchId}).`;
}

async function readStdinJson() {
  const readline = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  const lines = [];
  for await (const line of readline) lines.push(line);
  return lines.join("\n");
}

// Line-delimited JSON protocol for --op edit/delete: one event object per
// stdout line, one reply object per stdin line. See references/operations.md.
function emitEvent(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function createLineReader() {
  const readline = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  const iterator = readline[Symbol.asyncIterator]();
  return {
    async nextJson() {
      const { value, done } = await iterator.next();
      if (done) throw new Error("stdin closed before a response arrived.");
      try {
        return JSON.parse(value);
      } catch {
        throw new Error("Expected one JSON object per line on stdin.");
      }
    },
    close() {
      readline.close();
    },
  };
}

// Delete keeps the browser-tab confirm flow: the CLI relays project selection
// through the loopback and the browser shows its own final confirm dialog.
async function runDeleteOp(options) {
  const lineReader = createLineReader();
  let loopback;
  try {
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL,
    );
    const nonce = randomUUID();
    const pickId = randomUUID();
    loopback = await startLoopback({
      nonce,
      allowedOrigin: baseUrl,
      timeoutMs: LOOPBACK_TIMEOUT_MS,
    });
    await openLaunchUrl(
      buildPickUrl(baseUrl, { op: "delete", port: loopback.port, nonce, pickId }),
      process.platform,
    );

    const projectsExchange = await loopback.receive();
    emitEvent({
      event: "projects",
      projects: projectsExchange.body?.projects ?? [],
    });
    const { projectId } = await lineReader.nextJson();
    projectsExchange.respond({ projectId });

    emitEvent({ event: "done" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to complete the delete.";
    emitEvent({ event: "error", message });
    process.exitCode = 1;
  } finally {
    lineReader.close();
    if (loopback) await loopback.close();
  }
}

// Mints a fresh agent token via the one-shot loopback link flow: open (and
// print, for headless/SSH sessions with no local browser) `/agent/link#…`,
// then wait for the page to POST the token back. Shared by `--op login` and
// by `--op edit`'s auto-link-when-absent/on-401 paths — both need exactly
// this exchange, just triggered differently.
async function performLink(baseUrl) {
  const nonce = randomUUID();
  const linkId = randomUUID();
  const loopback = await startLoopback({
    nonce,
    allowedOrigin: baseUrl,
    timeoutMs: LOOPBACK_TIMEOUT_MS,
  });
  try {
    const linkUrl = buildLinkUrl(baseUrl, { linkId, port: loopback.port, nonce });
    process.stdout.write(`${linkUrl}\n`);
    try {
      await openLaunchUrl(linkUrl, process.platform);
    } catch {
      // No local browser to open (e.g. over SSH) — the printed URL above is
      // the fallback, so a failure here is not fatal.
    }

    const exchange = await loopback.receive();
    const token = exchange.body?.token;

    if (typeof token !== "string" || !AGENT_TOKEN_PATTERN.test(token)) {
      exchange.respond({ ok: false });
      throw new Error("The link callback returned an invalid token.");
    }

    exchange.respond({ ok: true });
    return token;
  } finally {
    await loopback.close();
  }
}

async function runLoginOp(options) {
  try {
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL,
    );
    const token = await performLink(baseUrl);
    await writeCredential(baseUrl, token);
    emitEvent({ event: "linked" });

    // Prime the project cache while we are already authenticated, so the next
    // edit resolves a name without a round trip. A failure here is not fatal:
    // the cache is an optimisation, and the next run refetches anyway.
    try {
      const { projects } = await loadProjects(
        baseUrl,
        createAuthedFetcher(baseUrl, token),
        { force: true },
      );
      emitEvent({ event: "projects", projects });
    } catch {
      // Left uncached deliberately.
    }

    emitEvent({ event: "done" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to link Truss.";
    emitEvent({ event: "error", message });
    process.exitCode = 1;
  }
}

async function ensureCredential(baseUrl) {
  const cached = await readCredential(baseUrl);
  if (cached) return cached;
  const token = await performLink(baseUrl);
  await writeCredential(baseUrl, token);
  return token;
}

// Wraps a fetch call with the "clear + relink once" 401 recovery the contract
// asks for. `hasRelinked` is shared across every call made through the same
// fetcher, so a token that is invalid for reasons other than expiry (e.g. the
// server itself is misbehaving) fails the whole edit rather than looping.
function createAuthedFetcher(baseUrl, initialToken) {
  let token = initialToken;
  let hasRelinked = false;

  return {
    async call(requestFn) {
      let result = await requestFn(token);
      if (result.status === 401 && !hasRelinked) {
        hasRelinked = true;
        await clearCredential(baseUrl);
        token = await performLink(baseUrl);
        await writeCredential(baseUrl, token);
        result = await requestFn(token);
      }
      return result;
    },
  };
}

async function fetchJson(url, requestOptions) {
  const response = await fetch(url, requestOptions);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

function fetchProjects(baseUrl, token) {
  return fetchJson(`${baseUrl}/api/projects`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function fetchGraph(baseUrl, projectId, token) {
  return fetchJson(
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/agent-graph`,
    { headers: { authorization: `Bearer ${token}` } },
  );
}

function postGraphEdit(baseUrl, projectId, token, fingerprint, graph) {
  return fetchJson(
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/agent-graph-edit`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fingerprint, graph }),
    },
  );
}

// Mirrors lib/room-id.ts. The project ID doubles as the /editor/[roomId]
// segment and the Liveblocks room ID, so a headless create has to build the
// same readable `<slug>-<suffix>` the create dialog does rather than let the
// schema's cuid() default produce an opaque one.
export function slugifyTitle(name) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildRoomId(name, suffix) {
  const slug = slugifyTitle(name).slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "");
  return slug && suffix ? `${slug}-${suffix}` : "";
}

function createRoomIdSuffix() {
  return randomUUID().replace(/-/g, "").slice(0, ROOM_ID_SUFFIX_LENGTH);
}

function postProject(baseUrl, token, id, name) {
  return fetchJson(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, name }),
  });
}

function postGraphImport(baseUrl, projectId, token, launchId, graph) {
  return fetchJson(
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/agent-launch-import`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ launchId, graph }),
    },
  );
}

/**
 * Serves the project list from the link-time cache when it is fresh enough,
 * and refetches otherwise. `force` skips the cache outright — used to
 * re-check before rejecting an ID the agent chose, so a project created since
 * the cache was written is never reported as nonexistent.
 */
async function loadProjects(baseUrl, auth, { force = false } = {}) {
  if (!force) {
    const cached = await readProjects(baseUrl);
    if (cached && Date.now() - cached.fetchedAt < PROJECTS_CACHE_TTL_MS) {
      return { projects: cached.projects, fromCache: true };
    }
  }

  const result = await auth.call((token) => fetchProjects(baseUrl, token));
  if (result.status !== 200) {
    throw new Error("We couldn't read your projects. Please try again.");
  }

  const projects = Array.isArray(result.body?.projects)
    ? result.body.projects
        .filter((project) => typeof project?.id === "string" && typeof project?.name === "string")
        .map((project) => ({ id: project.id, name: project.name }))
    : [];

  await writeProjects(baseUrl, projects);
  return { projects, fromCache: false };
}

// Headless create: make the project, then import the graph into it. Replaces
// the /agent/new tab, whose only real job was holding a session — the editor
// it redirected to ran exactly these two calls.
async function runHeadlessCreateOp(options, argv) {
  try {
    const input = parseLauncherInput(
      argv,
      options.stdinJson ? await readStdinJson() : undefined,
    );
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL,
    );
    const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));
    const launchId = randomUUID();

    let projectId = "";
    for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt += 1) {
      const candidate = buildRoomId(input.title, createRoomIdSuffix());
      if (!candidate) {
        throw new Error("That title has no characters a project ID can use.");
      }

      const created = await auth.call((token) =>
        postProject(baseUrl, token, candidate, input.title),
      );

      if (created.status === 201) {
        projectId = candidate;
        break;
      }

      // The suffix collided with an existing room. Draw a new one and retry,
      // matching what the create dialog does on 409.
      if (created.status !== 409) {
        throw new Error("We couldn't create that project. Please try again.");
      }
    }

    if (!projectId) {
      throw new Error("We couldn't find a free project ID. Please try again.");
    }

    const imported = await auth.call((token) =>
      postGraphImport(baseUrl, projectId, token, launchId, input.graph),
    );

    const editorUrl = `${baseUrl}/editor/${projectId}`;

    if (imported.status !== 200) {
      // The project exists but is empty. Say so with the URL rather than
      // silently reporting success — and do not delete it, since the user may
      // well want to keep it and draw by hand.
      throw new Error(
        `The project was created but the diagram could not be drawn. Open ${editorUrl} and try the edit again.`,
      );
    }

    await loadProjects(baseUrl, auth, { force: true });
    emitEvent({ event: "done", editorUrl });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create the diagram.";
    emitEvent({ event: "error", message });
    process.exitCode = 1;
  }
}

// Headless replacement for the old browser-driven edit: the CLI now holds
// the agent token and calls the API directly, no tab. The stdout/stdin event
// protocol is unchanged from the browser-relay version (see
// references/operations.md) so the calling agent's instructions still apply.
async function runHeadlessEditOp(options) {
  const lineReader = createLineReader();
  try {
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL,
    );
    const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));

    let { projects, fromCache } = await loadProjects(baseUrl, auth);
    emitEvent({ event: "projects", projects });

    const { projectId } = await lineReader.nextJson();
    // The browser used to be the only thing standing between a hallucinated
    // projectId and the delete/edit APIs (see the comment on
    // runAgentPickOperation in lib/agent-pick-browser.ts). That guarantee
    // moves here: only an id this process actually listed is trusted.
    let matchedProject =
      typeof projectId === "string"
        ? projects.find((project) => project.id === projectId)
        : undefined;

    // A miss against the cache is not proof the project is gone: it may have
    // been created since the cache was written. Pay for one fresh read before
    // telling the user their own diagram does not exist.
    if (!matchedProject && fromCache && typeof projectId === "string") {
      ({ projects } = await loadProjects(baseUrl, auth, { force: true }));
      matchedProject = projects.find((project) => project.id === projectId);
    }

    if (!matchedProject) {
      throw new Error("The agent chose a project we don't recognize.");
    }

    const graphResult = await auth.call((token) =>
      fetchGraph(baseUrl, matchedProject.id, token),
    );
    if (graphResult.status !== 200) {
      // The cache can name a project a collaborator has since deleted. Drop it
      // so the next run does not offer the same dead entry again.
      if (graphResult.status === 404 && fromCache) {
        await loadProjects(baseUrl, auth, { force: true });
      }
      throw new Error("We couldn't read this diagram. Please try again.");
    }
    emitEvent({
      event: "graph",
      graph: graphResult.body?.graph,
      opaqueNodeIds: graphResult.body?.opaqueNodeIds,
      fingerprint: graphResult.body?.fingerprint,
    });

    const { desiredGraph } = await lineReader.nextJson();

    let fingerprint = graphResult.body?.fingerprint;
    let applied = false;

    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const editResult = await auth.call((token) =>
        postGraphEdit(baseUrl, matchedProject.id, token, fingerprint, desiredGraph),
      );

      if (editResult.status === 200) {
        applied = true;
        break;
      }

      if (editResult.status !== 409) {
        throw new Error("We couldn't apply that change. Please try again.");
      }

      // A 409 on the last attempt falls through to the "actively edited
      // elsewhere" message below, rather than the generic one — a repeated
      // collision deserves the more specific explanation.
      if (attempt === MAX_EDIT_ATTEMPTS - 1) {
        break;
      }

      // Stale fingerprint: retry once from a fresh read, matching the
      // browser's prior behaviour (runEditFlow in lib/agent-pick-browser.ts).
      const retryRead = await auth.call((token) =>
        fetchGraph(baseUrl, matchedProject.id, token),
      );
      if (retryRead.status !== 200) {
        throw new Error("We couldn't read this diagram. Please try again.");
      }
      fingerprint = retryRead.body?.fingerprint;
    }

    if (!applied) {
      throw new Error(
        "This diagram is being actively edited elsewhere. Please try again in a moment.",
      );
    }

    emitEvent({ event: "done", editorUrl: `${baseUrl}/editor/${matchedProject.id}` });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to complete the edit.";
    emitEvent({ event: "error", message });
    process.exitCode = 1;
  } finally {
    lineReader.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);

  /*
   * Parsed inside the try, not above it.
   *
   * `parseArguments` throws on every malformed invocation, and hoisting it out
   * meant those escaped uncaught: create printed a stack trace instead of the
   * one-line non-sensitive error SKILL.md promises, and edit/delete exited with
   * no terminating protocol event at all — leaving the calling agent waiting on
   * a `done`/`error` line that would never come.
   *
   * The op is unknown until parsing succeeds, so a failure here reports through
   * the create-shaped stderr path. That is the right default: an argv this
   * malformed has no established protocol channel to answer on.
   */
  let options;

  try {
    options = parseArguments(argv);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to open Truss.";
    process.stderr.write(`Unable to open Truss: ${message}\n`);
    process.exitCode = 1;
    return;
  }

  if (options.op === "delete") {
    await runDeleteOp(options);
    return;
  }

  if (options.op === "edit") {
    await runHeadlessEditOp(options);
    return;
  }

  if (options.op === "login") {
    await runLoginOp(options);
    return;
  }

  await runHeadlessCreateOp(options, argv);
}

// Resolve symlinks and encode the path properly: ESM sets import.meta.url from the
// module's realpath, so an invocation through a symlinked skill directory (a
// .claude/skills/* link into .agents/skills/*) would otherwise fail this check and
// exit 0 having done nothing.
if (process.argv[1] && import.meta.url === entrypointUrl(process.argv[1]))
  await main();

function entrypointUrl(argvPath) {
  try {
    return pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return pathToFileURL(argvPath).href;
  }
}
