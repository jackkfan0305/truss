import "dotenv/config";

import assert from "node:assert/strict";

import {
  mutateStoredCanvas,
  readStoredCanvas,
  readStoredCanvasSince,
  writeStoredCanvas,
  type CanvasBlobClient,
} from "../lib/canvas-persistence";
import { CanvasVersionConflictError, type CanvasSnapshot } from "../lib/canvas-snapshot";
import { prisma } from "../lib/prisma";
import { CANVAS_NODE_TYPE, type CanvasNode } from "../types/canvas";

const DIAGRAM_ID = "verify-canvas-store";
const OWNER_ID = "verify_canvas_store_owner";

function node(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    width: 160,
    height: 80,
    data: { label: id, color: "neutral", shape: "rectangle" },
  } as CanvasNode;
}

function snapshot(...ids: string[]): CanvasSnapshot {
  return { nodes: ids.map(node), edges: [] };
}

function memoryBlob() {
  const files = new Map<string, string>();
  let counter = 0;
  const client: CanvasBlobClient = {
    upload: async (pathname, body) => {
      counter += 1;
      const url = `memory://${pathname}#${counter}`;
      files.set(url, body);
      return url;
    },
    download: async (url) => {
      const body = files.get(url);
      if (body === undefined) throw new Error(`missing ${url}`);
      return JSON.parse(body);
    },
    remove: async (url) => {
      files.delete(url);
    },
  };
  return { files, client };
}

async function reset() {
  await prisma.diagram.deleteMany({ where: { id: DIAGRAM_ID } });
  await prisma.diagram.create({ data: { id: DIAGRAM_ID, ownerId: OWNER_ID, name: "Store" } });
}

async function checkFreshWriteAndRead() {
  await reset();
  const { files, client } = memoryBlob();

  const empty = await readStoredCanvas(DIAGRAM_ID, client);
  assert.deepEqual(empty, { snapshot: null, version: 0, isAgentWrite: false });

  assert.equal(await writeStoredCanvas(DIAGRAM_ID, snapshot("web"), { expectedVersion: 0, isAgentWrite: false }, client), 1);
  assert.equal(await writeStoredCanvas(DIAGRAM_ID, snapshot("web", "db"), { expectedVersion: 1, isAgentWrite: false }, client), 2);

  const stored = await readStoredCanvas(DIAGRAM_ID, client);
  assert.deepEqual(stored.snapshot?.nodes.map((n) => n.id), ["web", "db"]);
  assert.equal(stored.version, 2);
  assert.equal(files.size, 1, "a successful write deletes the snapshot it replaced");
}

/** Review Focus 1: a stale writer is refused and the stored canvas is untouched. */
async function checkStaleWriteIsRefused() {
  await reset();
  const { files, client } = memoryBlob();
  await writeStoredCanvas(DIAGRAM_ID, snapshot("agent"), { expectedVersion: 0, isAgentWrite: true }, client);

  await assert.rejects(
    writeStoredCanvas(DIAGRAM_ID, snapshot("human"), { expectedVersion: 0, isAgentWrite: false }, client),
    CanvasVersionConflictError,
  );

  const stored = await readStoredCanvas(DIAGRAM_ID, client);
  assert.deepEqual(stored.snapshot?.nodes.map((n) => n.id), ["agent"]);
  assert.equal(stored.version, 1);
  assert.equal(stored.isAgentWrite, true);
  assert.equal(files.size, 1, "a refused write leaves no orphan behind");
}

/** Two writers that both pass the first check: the loser's upload is cleaned up. */
async function checkLostSwapRemovesItsUpload() {
  await reset();
  const { files, client } = memoryBlob();
  const racing: CanvasBlobClient = {
    ...client,
    upload: async (pathname, body) => {
      const url = await client.upload(pathname, body);
      // Another writer lands between this upload and the pointer swap.
      await prisma.diagram.update({ where: { id: DIAGRAM_ID }, data: { canvasVersion: { increment: 1 } } });
      return url;
    },
  };

  await assert.rejects(
    writeStoredCanvas(DIAGRAM_ID, snapshot("late"), { expectedVersion: 0, isAgentWrite: false }, racing),
    CanvasVersionConflictError,
  );
  assert.equal(files.size, 0);
}

/** Review Focus 2: a download that fails because the pointer moved is retried once. */
async function checkReadRetriesAfterPointerMoves() {
  await reset();
  const { client } = memoryBlob();
  await writeStoredCanvas(DIAGRAM_ID, snapshot("one"), { expectedVersion: 0, isAgentWrite: false }, client);

  let isFirstDownload = true;
  const moving: CanvasBlobClient = {
    ...client,
    download: async (url) => {
      if (isFirstDownload) {
        isFirstDownload = false;
        await writeStoredCanvas(DIAGRAM_ID, snapshot("two"), { expectedVersion: 1, isAgentWrite: false }, client);
        return client.download(url);
      }
      return client.download(url);
    },
  };

  const stored = await readStoredCanvas(DIAGRAM_ID, moving);
  assert.deepEqual(stored.snapshot?.nodes.map((n) => n.id), ["two"]);
  assert.equal(stored.version, 2);
}

async function checkSinceSkipsTheDownload() {
  await reset();
  const { client } = memoryBlob();
  await writeStoredCanvas(DIAGRAM_ID, snapshot("web"), { expectedVersion: 0, isAgentWrite: false }, client);

  const refusing: CanvasBlobClient = {
    ...client,
    download: async () => {
      throw new Error("an unchanged poll must not touch Blob");
    },
  };

  assert.equal(await readStoredCanvasSince(DIAGRAM_ID, 1, refusing), "unchanged");
  const newer = await readStoredCanvasSince(DIAGRAM_ID, 0, client);
  assert.notEqual(newer, "unchanged");
}

async function checkMutateWritesOnlyChanges() {
  await reset();
  const { client } = memoryBlob();

  await mutateStoredCanvas(DIAGRAM_ID, () => undefined, client);
  assert.equal((await readStoredCanvas(DIAGRAM_ID, client)).version, 0, "a no-op mutate writes nothing");

  await mutateStoredCanvas(DIAGRAM_ID, (flow) => flow.addNodes([node("agent")]), client);
  const stored = await readStoredCanvas(DIAGRAM_ID, client);
  assert.equal(stored.version, 1);
  assert.equal(stored.isAgentWrite, true, "mutate is the agent write path");

  await writeStoredCanvas(DIAGRAM_ID, snapshot("agent", "human"), { expectedVersion: 1, isAgentWrite: false }, client);
  assert.equal((await readStoredCanvas(DIAGRAM_ID, client)).isAgentWrite, false);
}

async function main() {
  try {
    await checkFreshWriteAndRead();
    await checkStaleWriteIsRefused();
    await checkLostSwapRemovesItsUpload();
    await checkReadRetriesAfterPointerMoves();
    await checkSinceSkipsTheDownload();
    await checkMutateWritesOnlyChanges();
    console.log("✅ canvas store verified");
  } finally {
    await prisma.diagram.deleteMany({ where: { id: DIAGRAM_ID } });
    await prisma.$disconnect();
  }
}

void main();
