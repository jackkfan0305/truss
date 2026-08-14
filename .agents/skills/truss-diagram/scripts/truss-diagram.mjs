import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

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
const OPS = new Set(["create", "edit", "delete"]);
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
        throw new Error("--op requires one of create, edit, delete.");
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

async function runInteractiveOp(op, options) {
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
      buildPickUrl(baseUrl, { op, port: loopback.port, nonce, pickId }),
      process.platform,
    );

    const projectsExchange = await loopback.receive();
    emitEvent({
      event: "projects",
      projects: projectsExchange.body?.projects ?? [],
    });
    const { projectId } = await lineReader.nextJson();
    projectsExchange.respond({ projectId });

    if (op === "edit") {
      const graphExchange = await loopback.receive();
      emitEvent({
        event: "graph",
        graph: graphExchange.body?.graph,
        opaqueNodeIds: graphExchange.body?.opaqueNodeIds,
        fingerprint: graphExchange.body?.fingerprint,
      });
      const { desiredGraph } = await lineReader.nextJson();
      graphExchange.respond({ desiredGraph });
    }

    emitEvent({ event: "done" });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : `Unable to complete the ${op}.`;
    emitEvent({ event: "error", message });
    process.exitCode = 1;
  } finally {
    lineReader.close();
    if (loopback) await loopback.close();
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

  if (options.op === "edit" || options.op === "delete") {
    await runInteractiveOp(options.op, options);
    return;
  }

  try {
    const input = parseLauncherInput(
      argv,
      options.stdinJson ? await readStdinJson() : undefined,
    );
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL,
    );
    const launchId = randomUUID();
    await openLaunchUrl(
      buildLaunchUrl(input, { baseUrl, launchId }),
      process.platform,
    );
    process.stdout.write(`${formatLauncherSuccess(baseUrl, launchId)}\n`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to open Truss.";
    process.stderr.write(`Unable to open Truss: ${message}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
)
  await main();
