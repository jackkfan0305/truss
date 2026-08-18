import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Shared agent-auth contract: ~/.truss/credentials.json, dir 0700, file 0600,
// keyed by normalized origin. Plaintext tokens live only here and on the
// server's SHA-256 index — never logged, never echoed back.
const CREDENTIALS_PATH = join(homedir(), ".truss", "credentials.json");
const CREDENTIALS_VERSION = 1;

function emptyStore() {
  return { version: CREDENTIALS_VERSION, origins: {} };
}

function isValidStore(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.version === CREDENTIALS_VERSION &&
    value.origins !== null &&
    typeof value.origins === "object" &&
    !Array.isArray(value.origins)
  );
}

// Missing, unreadable, or malformed all collapse to "no credential" — a
// corrupt cache file must never crash the CLI, only make it re-link.
async function readStore() {
  let raw;
  try {
    raw = await readFile(CREDENTIALS_PATH, "utf8");
  } catch {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(raw);
    return isValidStore(parsed) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

// `writeFile`'s `mode` applies only when it CREATES the file: an existing
// credentials.json keeps whatever mode it already had, so a file that was
// once 0644 would silently stay world-readable through every rewrite. Write a
// fresh 0600 temp file and rename over the target instead. The rename is also
// atomic, so a crash mid-write leaves the previous credential intact rather
// than a truncated file the next run has to discard.
async function writeStore(store) {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true, mode: 0o700 });

  const tempPath = `${CREDENTIALS_PATH}.${process.pid}.tmp`;

  try {
    await writeFile(tempPath, JSON.stringify(store, null, 2), { mode: 0o600 });
    await rename(tempPath, CREDENTIALS_PATH);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export async function readCredential(origin) {
  const store = await readStore();
  const entry = store.origins[origin];
  return typeof entry?.token === "string" ? entry.token : null;
}

export async function writeCredential(origin, token) {
  const store = await readStore();
  store.origins[origin] = { token, createdAt: new Date().toISOString() };
  await writeStore(store);
}

export async function clearCredential(origin) {
  const store = await readStore();
  if (!(origin in store.origins)) return;
  delete store.origins[origin];
  await writeStore(store);
}
