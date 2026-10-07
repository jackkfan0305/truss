import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  clearCredential,
  readCredential,
  readDiagrams,
  writeCredential,
  writeDiagrams,
} from "./credentials.mjs";
import { startLoopback } from "./loopback.mjs";

export const MAX_TITLE_LENGTH = 120;
export const MAX_GRAPH_NODES = 40;
export const MAX_GRAPH_EDGES = 60;
export const MAX_GRAPH_V2_NODES = 80;
export const MAX_GRAPH_V2_EDGES = 120;
const MAX_SIGNATURE_LENGTH = 120;
const MAX_ROWS = 12;
const MAX_ROW_LENGTH = 60;
const MAX_SOURCE_PATH_LENGTH = 200;
const GITHUB_PREFIX = "https://github.com/";
const EDGE_KINDS = new Set(["calls", "uses"]);
export const MAX_NODE_ID_LENGTH = 48;
export const MAX_NODE_LABEL_LENGTH = 80;
export const MAX_EDGE_LABEL_LENGTH = 40;
export const MIN_POSITION = -10_000;
export const MAX_POSITION = 10_000;
export const MAX_DIMENSION = 1_000_000;
export const DEFAULT_BASE_URL = "http://localhost:3000";
// Matches the loopback's idle timeout (Global Constraints: 120000 ms).
const LOOPBACK_TIMEOUT_MS = 120_000;
const GRAPH_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// trs_agent_ + base64url(32 random bytes) — see the shared agent-auth
// contract. 32 bytes encodes to exactly 43 base64url characters.
const AGENT_TOKEN_PATTERN = /^trs_agent_[A-Za-z0-9_-]{43}$/;
// How long a cached diagram list may answer a resolution before it is
// refetched. Short: the cache exists to skip a round trip, not to be a source
// of truth, and a stale miss costs the user a wrong answer about their own
// library.
const DIAGRAMS_CACHE_TTL_MS = 300_000;
const MAX_SLUG_LENGTH = 60;
const ROOM_ID_SUFFIX_LENGTH = 6;
const MAX_ROOM_ID_ATTEMPTS = 3;
// Comfortably covers slug(60) + "-" + suffix(6); a basic shape guard, not the
// authority — the server owns the real answer to "does this diagram exist".
const MAX_DIAGRAM_ID_LENGTH = 128;

export const SHAPES = new Set([
  "rectangle",
  "diamond",
  "circle",
  "pill",
  "cylinder",
  "hexagon",
]);
export const COLORS = new Set([
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

function isDiagramId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DIAGRAM_ID_LENGTH
  );
}

const COMMON_V2_KEYS = ["id", "kind", "label", "parentId", "x", "y", "width", "height"];
const NODE_KEYS_V2 = {
  generic: new Set([...COMMON_V2_KEYS, "shape", "color"]),
  "aws-service": new Set([...COMMON_V2_KEYS, "catalogId"]),
  boundary: new Set([...COMMON_V2_KEYS, "catalogId"]),
  code: new Set([...COMMON_V2_KEYS, "catalogId", "signature", "rows", "source"]),
  note: new Set(["id", "kind", "label", "color", "x", "y", "width", "height"]),
};
const NOTE_COLORS = new Set(["yellow", "pink", "blue", "green"]);
const MAX_NOTE_LENGTH = 1000;

// Note text keeps its line breaks and trailing spaces; only the length is capped.
function isNoteText(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= MAX_NOTE_LENGTH;
}
// Boundaries come from either family; the server checks the exact id.
const CATALOG_PREFIXES = { "aws-service": ["aws-"], boundary: ["boundary-", "code-"], code: ["code-"] };

function isSingleLine(value, maximumLength) {
  return isTrimmedString(value, maximumLength) && !/[\r\n]/.test(value);
}

function validateCodeFields(node) {
  if ("signature" in node && !isSingleLine(node.signature, MAX_SIGNATURE_LENGTH)) return false;
  if ("rows" in node && (!Array.isArray(node.rows) || node.rows.length > MAX_ROWS || !node.rows.every((row) => isSingleLine(row, MAX_ROW_LENGTH)))) return false;
  if ("source" in node) {
    const source = node.source;
    if (!isPlainObject(source) || !hasOnlyKeys(source, new Set(["path", "line", "url"]))) return false;
    if (!isSingleLine(source.path, MAX_SOURCE_PATH_LENGTH)) return false;
    if ("line" in source && !(Number.isInteger(source.line) && source.line > 0)) return false;
    if ("url" in source && !(typeof source.url === "string" && source.url.startsWith(GITHUB_PREFIX) && !/\s/.test(source.url))) return false;
  }
  return true;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function inRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateNodeV1(node, nodeIds) {
  if (
    !isPlainObject(node) ||
    !hasOnlyKeys(node, new Set(["id", "label", "shape", "color", "x", "y"])) ||
    !isGraphId(node.id) ||
    !isTrimmedString(node.label, MAX_NODE_LABEL_LENGTH) ||
    !SHAPES.has(node.shape) ||
    !COLORS.has(node.color) ||
    (("x" in node || "y" in node) && (
      !Number.isInteger(node.x) ||
      !Number.isInteger(node.y) ||
      node.x < MIN_POSITION ||
      node.x > MAX_POSITION ||
      node.y < MIN_POSITION ||
      node.y > MAX_POSITION
    )) ||
    nodeIds.has(node.id)
  ) {
    throw new Error("The graph contains an invalid node.");
  }
  return {
    id: node.id,
    label: node.label,
    shape: node.shape,
    color: node.color,
    ...("x" in node ? { x: node.x, y: node.y } : {}),
  };
}

// Catalog identity is server-authoritative (the .mjs runtime cannot import the
// TypeScript catalog); this checks only the field shape and the kind's prefix.
function validateNodeV2(node, nodeIds) {
  if (isPlainObject(node) && node.kind === "note") {
    for (const field of ["parentId", "catalogId"]) {
      if (field in node) throw new Error(`Notes cannot have a ${field}.`);
    }
  }
  const keys = isPlainObject(node) ? NODE_KEYS_V2[node.kind] : undefined;
  if (
    !keys ||
    !hasOnlyKeys(node, keys) ||
    !isGraphId(node.id) ||
    !(node.kind === "note" ? isNoteText(node.label) : isTrimmedString(node.label, MAX_NODE_LABEL_LENGTH)) ||
    ("parentId" in node && !isGraphId(node.parentId)) ||
    ("x" in node !== "y" in node) ||
    ("x" in node && (!inRange(node.x, MIN_POSITION, MAX_POSITION) || !inRange(node.y, MIN_POSITION, MAX_POSITION))) ||
    ("width" in node !== "height" in node) ||
    ("width" in node && (
      !inRange(node.width, Number.MIN_VALUE, MAX_DIMENSION) ||
      !inRange(node.height, Number.MIN_VALUE, MAX_DIMENSION)
    )) ||
    nodeIds.has(node.id)
  ) {
    throw new Error("The graph contains an invalid node.");
  }
  if (node.kind === "generic") {
    if (!SHAPES.has(node.shape) || !COLORS.has(node.color)) {
      throw new Error("The graph contains an invalid node.");
    }
  } else if (node.kind === "note") {
    if ("color" in node && !NOTE_COLORS.has(node.color)) {
      throw new Error("The graph contains an invalid node.");
    }
  } else if (
    typeof node.catalogId !== "string" ||
    !CATALOG_PREFIXES[node.kind].some((prefix) => node.catalogId.startsWith(prefix)) ||
    !isGraphId(node.catalogId)
  ) {
    throw new Error("The graph contains an invalid node.");
  }
  if (node.kind === "code" && !validateCodeFields(node)) {
    throw new Error("The graph contains an invalid code field.");
  }
  return { ...node };
}

// Parents must exist and be boundaries; a per-node visited set rejects cycles.
function validateHierarchy(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    if (node.parentId === undefined) continue;
    if (byId.get(node.parentId)?.kind !== "boundary") {
      throw new Error("The graph contains an invalid parent.");
    }
    const visited = new Set([node.id]);
    for (let next = node.parentId; next !== undefined; next = byId.get(next)?.parentId) {
      if (visited.has(next)) throw new Error("The graph contains a containment cycle.");
      visited.add(next);
    }
  }
  for (const node of nodes) {
    if (node.kind === "code" && node.catalogId === "code-method" && byId.get(node.parentId)?.catalogId !== "code-class") {
      throw new Error(`Method ${node.id} must sit inside a code-class boundary.`);
    }
  }
}

export function validateGraph(rawGraph) {
  if (
    rawGraph === null ||
    typeof rawGraph !== "object" ||
    Array.isArray(rawGraph) ||
    !hasOnlyKeys(rawGraph, new Set(["version", "nodes", "edges"]))
  ) {
    throw new Error("The graph must use the compact graph contract.");
  }
  const version = rawGraph.version;
  if (
    (version !== 1 && version !== 2) ||
    !Array.isArray(rawGraph.nodes) ||
    !Array.isArray(rawGraph.edges) ||
    rawGraph.nodes.length < 1 ||
    rawGraph.nodes.length > (version === 2 ? MAX_GRAPH_V2_NODES : MAX_GRAPH_NODES) ||
    rawGraph.edges.length > (version === 2 ? MAX_GRAPH_V2_EDGES : MAX_GRAPH_EDGES)
  ) {
    throw new Error("The graph is outside its allowed limits.");
  }

  const nodeIds = new Set();
  const validateNode = version === 2 ? validateNodeV2 : validateNodeV1;
  const nodes = rawGraph.nodes.map((node) => {
    const valid = validateNode(node, nodeIds);
    nodeIds.add(valid.id);
    return valid;
  });
  if (version === 2) validateHierarchy(nodes);

  const edgeIds = new Set();
  const endpointPairs = new Set();
  const edges = rawGraph.edges.map((edge) => {
    if (
      edge === null ||
      typeof edge !== "object" ||
      Array.isArray(edge) ||
      !hasOnlyKeys(edge, new Set(version === 2 ? ["id", "source", "target", "label", "kind"] : ["id", "source", "target", "label"])) ||
      ("kind" in edge && !EDGE_KINDS.has(edge.kind)) ||
      !isGraphId(edge.id) ||
      !isGraphId(edge.source) ||
      !isGraphId(edge.target) ||
      !isTrimmedString(edge.label, MAX_EDGE_LABEL_LENGTH, true) ||
      edge.source === edge.target ||
      !nodeIds.has(edge.source) ||
      !nodeIds.has(edge.target) ||
      edgeIds.has(edge.id) ||
      endpointPairs.has(`${edge.source} ${edge.target}`)
    ) {
      throw new Error("The graph contains an invalid edge.");
    }
    edgeIds.add(edge.id);
    endpointPairs.add(`${edge.source} ${edge.target}`);
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      ...("kind" in edge ? { kind: edge.kind } : {}),
    };
  });

  return { version, nodes, edges };
}

export function validateCreateInput(rawTitle, rawGraph) {
  if (!isTrimmedString(rawTitle, MAX_TITLE_LENGTH)) {
    throw new Error("A non-empty title is required.");
  }
  return { title: rawTitle, graph: validateGraph(rawGraph) };
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

function resolveBaseUrl(rawUrl) {
  return normalizeBaseUrl(rawUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL);
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

// Mints a fresh agent token via the one-shot loopback link flow: open (and
// print, for headless/SSH sessions with no local browser) `/agent/link#…`,
// then wait for the page to POST the token back. Shared by every operation's
// auto-link-when-absent/on-401 path.
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
    process.stderr.write(`${linkUrl}\n`);
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
// server itself is misbehaving) fails the whole operation rather than looping.
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

function fetchDiagrams(baseUrl, token) {
  return fetchJson(`${baseUrl}/api/diagrams`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

// Recoverable server refusals carry a code and the item IDs to revise.
export function graphRequestError(body, fallback) {
  const message = typeof body?.error === "string"
    ? body.error
    : typeof body?.message === "string" ? body.message : fallback;
  const { code, issues, itemIds, boundaryId, requiredVersion } = body ?? {};
  const details = code || issues
    ? ` ${JSON.stringify({ code, issues, itemIds, boundaryId, requiredVersion })}`
    : "";
  return new Error(`${message}${details}`);
}

const versionQuery = (graph) => (graph.version === 2 ? "?version=2" : "");

function fetchGraph(baseUrl, diagramId, token) {
  return fetchJson(
    `${baseUrl}/api/diagrams/${encodeURIComponent(diagramId)}/agent-graph?version=2`,
    { headers: { authorization: `Bearer ${token}` } },
  );
}

function postGraphEdit(baseUrl, diagramId, token, fingerprint, graph) {
  return fetchJson(
    `${baseUrl}/api/diagrams/${encodeURIComponent(diagramId)}/agent-graph-edit${versionQuery(graph)}`,
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

// Mirrors lib/room-id.ts. The diagram ID doubles as the /editor/[roomId]
// segment, so a headless create has to build the same readable `<slug>-<suffix>`
// the create dialog does rather than let the schema's cuid() default produce an
// opaque one.
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

function postDiagram(baseUrl, token, id, name) {
  return fetchJson(`${baseUrl}/api/diagrams`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, name }),
  });
}

function postGraphImport(baseUrl, diagramId, token, launchId, graph) {
  return fetchJson(
    `${baseUrl}/api/diagrams/${encodeURIComponent(diagramId)}/agent-launch-import${versionQuery(graph)}`,
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
 * Serves the diagram list from the link-time cache when it is fresh enough,
 * and refetches otherwise. `force` skips the cache outright.
 */
async function loadDiagrams(baseUrl, auth, { force = false } = {}) {
  if (!force) {
    const cached = await readDiagrams(baseUrl);
    if (cached && Date.now() - cached.fetchedAt < DIAGRAMS_CACHE_TTL_MS) {
      return { diagrams: cached.diagrams, fromCache: true };
    }
  }

  const result = await auth.call((token) => fetchDiagrams(baseUrl, token));
  if (result.status !== 200) {
    throw new Error("We couldn't read your diagrams. Please try again.");
  }

  const diagrams = Array.isArray(result.body?.diagrams)
    ? result.body.diagrams
        .filter((diagram) => typeof diagram?.id === "string" && typeof diagram?.name === "string")
        .map((diagram) => ({ id: diagram.id, name: diagram.name }))
    : [];

  await writeDiagrams(baseUrl, diagrams);
  return { diagrams, fromCache: false };
}

/**
 * Reads the public catalog (AWS and code blocks). It holds no owner data, so this neither needs
 * nor opens a sign-in; the origin is still validated like every other call.
 */
export async function getCatalog(rawBaseUrl) {
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const result = await fetchJson(`${baseUrl}/api/agent/catalog`);
  if (
    result.status !== 200 ||
    result.body?.catalogVersion !== 1 ||
    !Array.isArray(result.body?.entries)
  ) {
    throw new Error("We couldn't read the catalog. Please try again.");
  }
  return result.body;
}

/** `--op login` — mints and caches an agent token, priming the diagram cache. */
export async function login(rawBaseUrl) {
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const token = await performLink(baseUrl);
  await writeCredential(baseUrl, token);

  // Prime the diagram cache while we are already authenticated, so the next
  // call resolves a name without a round trip. A failure here is not fatal:
  // the cache is an optimisation, and the next call refetches anyway.
  try {
    await loadDiagrams(baseUrl, createAuthedFetcher(baseUrl, token), { force: true });
  } catch {
    // Left uncached deliberately.
  }

  return { baseUrl };
}

/** Lists the signed-in user's diagrams (diagram id + name), authenticating first if needed. */
export async function listDiagrams(rawBaseUrl) {
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));
  const { diagrams } = await loadDiagrams(baseUrl, auth);
  return { diagrams };
}

/**
 * Reads one diagram's compact graph, ready to hand back for editing.
 *
 * `diagramId` is trusted only after it is found in a listing this function
 * itself just fetched (fresh, or a still-valid cache) — the guarantee a
 * browser tab used to provide by only ever offering real diagrams to pick
 * from (see lib/agent-pick-browser.ts) moves here for the headless path, so
 * a hallucinated id can never reach the graph-read or, downstream, the edit
 * write.
 */
export async function getDiagram(rawBaseUrl, diagramId) {
  if (!isDiagramId(diagramId)) {
    throw new Error("A diagram id is required.");
  }
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));

  let { diagrams, fromCache } = await loadDiagrams(baseUrl, auth);
  let matchedDiagram = diagrams.find((diagram) => diagram.id === diagramId);

  // A miss against the cache is not proof the diagram is gone: it may have
  // been created since the cache was written. Pay for one fresh read before
  // telling the caller their own diagram does not exist.
  if (!matchedDiagram && fromCache) {
    ({ diagrams } = await loadDiagrams(baseUrl, auth, { force: true }));
    matchedDiagram = diagrams.find((diagram) => diagram.id === diagramId);
  }

  if (!matchedDiagram) {
    throw new Error("The agent chose a diagram we don't recognize.");
  }

  const result = await auth.call((token) => fetchGraph(baseUrl, diagramId, token));
  if (result.status !== 200) {
    // The cache can name a diagram a collaborator has since deleted. Drop it
    // so the next call does not offer the same dead entry again.
    if (result.status === 404 && fromCache) {
      await loadDiagrams(baseUrl, auth, { force: true });
    }
    throw graphRequestError(result.body, "We couldn't read this diagram. Please try again.");
  }
  return {
    ...result.body,
    graph: result.body?.graph,
    opaqueNodeIds: Array.isArray(result.body?.opaqueNodeIds) ? result.body.opaqueNodeIds : [],
    fingerprint: result.body?.fingerprint,
    editorUrl: `${baseUrl}/editor/${diagramId}`,
  };
}

/** Apply against the graph the caller read; conflicts require a new edit. */
export async function applyDiagramEdit(rawBaseUrl, diagramId, fingerprint, desiredGraph) {
  if (!isDiagramId(diagramId)) {
    throw new Error("A diagram id is required.");
  }
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const graph = validateGraph(desiredGraph);
  const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));
  const result = await auth.call((token) =>
    postGraphEdit(baseUrl, diagramId, token, fingerprint, graph),
  );
  // A 409 with a code is a refused contract, not a stale read.
  if (result.status === 409 && !result.body?.code) {
    throw new Error(
      "This diagram changed since you read it. Read it again with truss_get_diagram, reapply your changes to the current graph, and submit its fingerprint.",
    );
  }
  if (result.status !== 200) {
    throw graphRequestError(result.body, "We couldn't apply that change. Please try again.");
  }
  return { ...result.body, editorUrl: `${baseUrl}/editor/${diagramId}` };
}

/** Delete through the owner-authorized API and report its completed result. */
export async function deleteDiagram(rawBaseUrl, diagramId) {
  if (!isDiagramId(diagramId)) {
    throw new Error("A diagram id is required.");
  }
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));
  const result = await auth.call((token) =>
    fetchJson(`${baseUrl}/api/diagrams/${encodeURIComponent(diagramId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  if (result.status !== 204) {
    throw new Error("We couldn't delete that diagram. Check that you own it and try again.");
  }
  const cached = await readDiagrams(baseUrl);
  if (cached) {
    await writeDiagrams(baseUrl, cached.diagrams.filter((diagram) => diagram.id !== diagramId));
  }
  return { diagramId, deleted: true };
}

/** Creates a new diagram: makes the diagram, then imports the graph into it. */
export async function createDiagram(rawBaseUrl, title, graph) {
  const input = validateCreateInput(title, graph);
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const auth = createAuthedFetcher(baseUrl, await ensureCredential(baseUrl));
  const launchId = randomUUID();

  let diagramId = "";
  for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt += 1) {
    const candidate = buildRoomId(input.title, createRoomIdSuffix());
    if (!candidate) {
      throw new Error("That title has no characters a diagram ID can use.");
    }

    const created = await auth.call((token) =>
      postDiagram(baseUrl, token, candidate, input.title),
    );

    if (created.status === 201) {
      diagramId = candidate;
      break;
    }

    // The suffix collided with an existing room. Draw a new one and retry,
    // matching what the create dialog does on 409.
    if (created.status !== 409) {
      throw new Error("We couldn't create that diagram. Please try again.");
    }
  }

  if (!diagramId) {
    throw new Error("We couldn't find a free diagram ID. Please try again.");
  }

  const imported = await auth.call((token) =>
    postGraphImport(baseUrl, diagramId, token, launchId, input.graph),
  );

  const editorUrl = `${baseUrl}/editor/${diagramId}`;

  if (imported.status !== 200) {
    // The diagram exists but is empty. Say so with the URL rather than
    // silently reporting success — and do not delete it, since the user may
    // well want to keep it and draw by hand.
    const cause = graphRequestError(imported.body, "");
    throw new Error(
      `The diagram was created but the diagram could not be drawn. Open ${editorUrl} and try the edit again.${cause.message ? ` ${cause.message}` : ""}`,
    );
  }

  await loadDiagrams(baseUrl, auth, { force: true });
  return { ...imported.body, editorUrl, diagramId };
}

/**
 * Opens Truss to its own delete-confirm dialog for one diagram and relays the
 * caller's chosen `diagramId` into it — the browser page fetches its own
 * diagram list (over the human's session, not the agent token) and renders
 * whichever diagram this call names. This never performs the delete itself:
 * the dialog inside that browser tab is the only thing that can, using the
 * human's own auth. `applyDiagramEdit`'s guarantees do not extend here — there
 * is no server-side fingerprint check to fall back on if the human confirms
 * the wrong diagram, so resolve and confirm the target with the human before
 * calling this.
 */
export async function promptDeleteDiagram(rawBaseUrl, diagramId) {
  if (!isDiagramId(diagramId)) {
    throw new Error("A diagram id is required.");
  }
  const baseUrl = resolveBaseUrl(rawBaseUrl);
  const nonce = randomUUID();
  const pickId = randomUUID();
  const loopback = await startLoopback({
    nonce,
    allowedOrigin: baseUrl,
    timeoutMs: LOOPBACK_TIMEOUT_MS,
  });
  try {
    await openLaunchUrl(
      buildPickUrl(baseUrl, { op: "delete", port: loopback.port, nonce, pickId }),
      process.platform,
    );

    const exchange = await loopback.receive();
    exchange.respond({ diagramId });
    return { relayed: true };
  } finally {
    await loopback.close();
  }
}
