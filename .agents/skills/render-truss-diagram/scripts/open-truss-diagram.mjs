import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2_000;
const LAUNCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DEFAULT_BASE_URL = "http://localhost:3000";

function parseArguments(argv) {
  const options = {
    title: undefined,
    description: undefined,
    baseUrl: undefined,
    stdinJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--stdin-json") {
      if (options.stdinJson) {
        throw new Error("--stdin-json may only be provided once.");
      }

      options.stdinJson = true;
      continue;
    }

    if (
      argument !== "--title" &&
      argument !== "--description" &&
      argument !== "--base-url"
    ) {
      throw new Error("Use --title and --description, or --stdin-json.");
    }

    const value = argv[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value.`);
    }

    const optionName =
      argument === "--title"
        ? "title"
        : argument === "--description"
          ? "description"
          : "baseUrl";

    if (options[optionName] !== undefined) {
      throw new Error(`${argument} may only be provided once.`);
    }

    options[optionName] = value;
    index += 1;
  }

  return options;
}

function validateInput(rawInput) {
  if (
    rawInput === null ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput) ||
    typeof rawInput.title !== "string" ||
    typeof rawInput.description !== "string"
  ) {
    throw new Error("A title and description are required.");
  }

  const title = rawInput.title.trim();
  const description = rawInput.description.trim();

  if (!title) {
    throw new Error("A non-empty title is required.");
  }

  if (!description) {
    throw new Error("A non-empty description is required.");
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw new Error("The title must be 120 characters or fewer.");
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error("The description must be 2,000 characters or fewer.");
  }

  return { title, description };
}

function parseJsonObject(stdinJson) {
  if (typeof stdinJson === "string") {
    try {
      return JSON.parse(stdinJson);
    } catch {
      throw new Error("--stdin-json must contain one valid JSON object.");
    }
  }

  return stdinJson;
}

export function parseLauncherInput(argv, stdinJson) {
  const options = parseArguments(argv);

  if (options.stdinJson) {
    if (options.title !== undefined || options.description !== undefined) {
      throw new Error("--stdin-json cannot be combined with --title or --description.");
    }

    return validateInput(parseJsonObject(stdinJson));
  }

  if (stdinJson !== undefined) {
    throw new Error("Provide --stdin-json before sending JSON input.");
  }

  return validateInput({
    title: options.title,
    description: options.description,
  });
}

export function normalizeBaseUrl(rawUrl) {
  if (
    typeof rawUrl !== "string" ||
    !rawUrl.trim() ||
    rawUrl.includes("?") ||
    rawUrl.includes("#")
  ) {
    throw new Error("The Truss base URL must be an HTTP(S) origin.");
  }

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
  ) {
    throw new Error("The Truss base URL must be an HTTP(S) origin without a path.");
  }

  return parsedUrl.origin;
}

export function buildLaunchUrl(input, options) {
  const validatedInput = validateInput(input);
  const baseUrl = normalizeBaseUrl(options?.baseUrl);
  const launchId = options?.launchId ?? randomUUID();

  if (!LAUNCH_ID_PATTERN.test(launchId)) {
    throw new Error("The launch ID must be a canonical UUID v4.");
  }

  const payload = {
    version: 1,
    launchId,
    title: validatedInput.title.trim(),
    description: validatedInput.description.trim(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${baseUrl}/agent/new#${encoded}`;
}

export function browserCommand(url, platform) {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", url],
    };
  }

  if (platform === "linux") {
    return { command: "xdg-open", args: [url] };
  }

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
  const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = [];

  for await (const line of readline) {
    lines.push(line);
  }

  return lines.join("\n");
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    const options = parseArguments(argv);
    const stdinJson = options.stdinJson ? await readStdinJson() : undefined;
    const input = parseLauncherInput(argv, stdinJson);
    const baseUrl = normalizeBaseUrl(
      options.baseUrl ?? process.env.TRUSS_APP_URL ?? DEFAULT_BASE_URL,
    );
    const launchId = randomUUID();
    const launchUrl = buildLaunchUrl(input, { baseUrl, launchId });

    await openLaunchUrl(launchUrl, process.platform);
    process.stdout.write(`${formatLauncherSuccess(baseUrl, launchId)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open Truss.";

    process.stderr.write(`Unable to open Truss: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
