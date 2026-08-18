import { put } from "@vercel/blob";

import {
  canvasBlobPath,
  serializeCanvasSnapshot,
  type CanvasSnapshot,
} from "@/lib/canvas-snapshot";
import { prisma } from "@/lib/prisma";

const BLOB_ACCESS = "private" as const;

/** Raised only when Blob cannot accept a snapshot; Prisma failures propagate. */
export class CanvasSnapshotUploadError extends Error {
  constructor(cause: unknown) {
    super("Canvas snapshot upload failed", { cause });
    this.name = "CanvasSnapshotUploadError";
  }
}

/**
 * Stores a private snapshot before pointing the project at it. A pointer never
 * names an artifact that has not been uploaded successfully.
 */
export async function saveCanvasSnapshot(
  projectId: string,
  snapshot: CanvasSnapshot,
): Promise<string> {
  let url: string;

  try {
    const blob = await put(
      canvasBlobPath(projectId),
      serializeCanvasSnapshot(snapshot),
      {
        access: BLOB_ACCESS,
        contentType: "application/json",
        allowOverwrite: true,
        addRandomSuffix: false,
      },
    );

    url = blob.url;
  } catch (error: unknown) {
    throw new CanvasSnapshotUploadError(error);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { canvasJsonPath: url },
  });

  return url;
}
