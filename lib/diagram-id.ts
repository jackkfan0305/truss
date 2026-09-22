import { z } from "zod";

/**
 * A diagram ID is also its editor path segment and Liveblocks room ID.
 * Keep the one wire/storage format in one schema so every boundary agrees.
 */
export const diagramIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function isDiagramId(value: string): boolean {
  return diagramIdSchema.safeParse(value).success;
}
