import { del, get, put } from "@vercel/blob";

import { createSnapshotFlow, type AgentCanvasFlow } from "@/lib/agent-canvas-write";
import {
  CanvasVersionConflictError,
  canvasBlobPath,
  parseCanvasSnapshot,
  serializeCanvasSnapshot,
  type CanvasSnapshot,
} from "@/lib/canvas-snapshot";
import { prisma } from "@/lib/prisma";

/**
 * The only store a canvas has (ADR 0005). Prisma holds the pointer and the
 * version, Blob holds the JSON. Every write uploads a new file and then swaps
 * the pointer with a compare-and-swap on `canvasVersion`, so the pointer and
 * the version always move together and a reader never sees one without the
 * other.
 */

/**
 * The store is configured for private access: a diagram is private to its
 * owner, and a public URL would be an unauthenticated read of the diagram.
 */
const BLOB_ACCESS = "private" as const;

export interface CanvasBlobClient {
  upload: (pathname: string, body: string) => Promise<string>;
  download: (url: string) => Promise<unknown>;
  remove: (url: string) => Promise<void>;
}

const vercelBlob: CanvasBlobClient = {
  upload: async (pathname, body) => {
    const blob = await put(pathname, body, {
      access: BLOB_ACCESS,
      contentType: "application/json",
      addRandomSuffix: true,
    });
    return blob.url;
  },
  download: async (url) => {
    // `get` attaches the token a private blob needs; a plain fetch cannot.
    const result = await get(url, { access: BLOB_ACCESS, useCache: false });

    if (!result || result.statusCode !== 200) {
      throw new Error(`Blob read returned ${result?.statusCode ?? "nothing"}`);
    }

    return new Response(result.stream).json();
  },
  remove: async (url) => {
    await del(url);
  },
};

export class CanvasSnapshotUploadError extends Error {
  constructor(cause: unknown) {
    super("Canvas snapshot upload failed", { cause });
    this.name = "CanvasSnapshotUploadError";
  }
}

export class CanvasSnapshotReadError extends Error {
  constructor(cause: unknown) {
    super("Canvas snapshot download failed", { cause });
    this.name = "CanvasSnapshotReadError";
  }
}

/** The pointer resolves, but what it names is not a canvas. */
export class CanvasSnapshotInvalidError extends Error {
  constructor(diagramId: string) {
    super(`Stored canvas for ${diagramId} is not a valid snapshot`);
    this.name = "CanvasSnapshotInvalidError";
  }
}

export interface StoredCanvas {
  /** `null` until the first save. */
  snapshot: CanvasSnapshot | null;
  version: number;
  isAgentWrite: boolean;
}

const HEAD_SELECT = {
  canvasJsonPath: true,
  canvasVersion: true,
  canvasWrittenByAgent: true,
} as const;

async function readHead(diagramId: string) {
  const head = await prisma.diagram.findUnique({ where: { id: diagramId }, select: HEAD_SELECT });

  if (!head) {
    throw new Error(`Diagram ${diagramId} does not exist`);
  }

  return head;
}

/**
 * The current canvas. A download that fails is retried once when the pointer
 * moved in the meantime: a concurrent write deletes the file it replaced, and
 * a reader holding the old pointer should get the new canvas, not a 502.
 */
export async function readStoredCanvas(
  diagramId: string,
  blob: CanvasBlobClient = vercelBlob,
): Promise<StoredCanvas> {
  let head = await readHead(diagramId);

  for (let attempt = 0; ; attempt += 1) {
    const meta = { version: head.canvasVersion, isAgentWrite: head.canvasWrittenByAgent };

    if (!head.canvasJsonPath) {
      return { snapshot: null, ...meta };
    }

    let stored: unknown;

    try {
      stored = await blob.download(head.canvasJsonPath);
    } catch (error: unknown) {
      const latest = await readHead(diagramId);

      if (attempt === 0 && latest.canvasJsonPath !== head.canvasJsonPath) {
        head = latest;
        continue;
      }

      throw new CanvasSnapshotReadError(error);
    }

    const snapshot = parseCanvasSnapshot(stored);

    if (!snapshot) {
      throw new CanvasSnapshotInvalidError(diagramId);
    }

    return { snapshot, ...meta };
  }
}

/** A poll: skips the Blob download entirely when `since` is still current. */
export async function readStoredCanvasSince(
  diagramId: string,
  since: number | null,
  blob: CanvasBlobClient = vercelBlob,
): Promise<StoredCanvas | "unchanged"> {
  if (since !== null && (await readHead(diagramId)).canvasVersion === since) {
    return "unchanged";
  }

  return readStoredCanvas(diagramId, blob);
}

async function removeQuietly(blob: CanvasBlobClient, url: string): Promise<void> {
  try {
    await blob.remove(url);
  } catch (error: unknown) {
    // An orphaned private blob costs storage, not correctness.
    console.error(`Canvas blob cleanup failed for ${url}`, error);
  }
}

/**
 * Stores `snapshot` if the canvas is still at `expectedVersion`, and returns
 * the new version. Throws `CanvasVersionConflictError` when it moved.
 */
export async function writeStoredCanvas(
  diagramId: string,
  snapshot: CanvasSnapshot,
  { expectedVersion, isAgentWrite }: { expectedVersion: number; isAgentWrite: boolean },
  blob: CanvasBlobClient = vercelBlob,
): Promise<number> {
  const before = await readHead(diagramId);

  // Cheap early refusal: no upload for a writer that is already stale.
  if (before.canvasVersion !== expectedVersion) {
    throw new CanvasVersionConflictError(diagramId);
  }

  let url: string;

  try {
    url = await blob.upload(canvasBlobPath(diagramId), serializeCanvasSnapshot(snapshot));
  } catch (error: unknown) {
    throw new CanvasSnapshotUploadError(error);
  }

  const { count } = await prisma.diagram.updateMany({
    where: { id: diagramId, canvasVersion: expectedVersion },
    data: {
      canvasJsonPath: url,
      canvasVersion: { increment: 1 },
      canvasWrittenByAgent: isAgentWrite,
    },
  });

  if (count === 0) {
    await removeQuietly(blob, url);
    throw new CanvasVersionConflictError(diagramId);
  }

  // The swap matched `expectedVersion`, so `before.canvasJsonPath` is exactly
  // the file this write replaced.
  if (before.canvasJsonPath) {
    await removeQuietly(blob, before.canvasJsonPath);
  }

  return expectedVersion + 1;
}

/**
 * Read, modify and write under one version, for the agent-token routes. The
 * callback sees the same `AgentCanvasFlow` surface `mutateCanvas` passes to it. A
 * callback that changes nothing writes nothing.
 */
export async function mutateStoredCanvas(
  diagramId: string,
  callback: (flow: AgentCanvasFlow) => void | Promise<void>,
  blob: CanvasBlobClient = vercelBlob,
): Promise<void> {
  const stored = await readStoredCanvas(diagramId, blob);
  const flow = createSnapshotFlow(stored.snapshot ?? { nodes: [], edges: [] });

  await callback(flow);

  if (!flow.hasChanged) {
    return;
  }

  await writeStoredCanvas(
    diagramId,
    flow.toSnapshot(),
    { expectedVersion: stored.version, isAgentWrite: true },
    blob,
  );
}

