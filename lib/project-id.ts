import { z } from "zod";

/**
 * A project ID is also its editor path segment and Liveblocks room ID.
 * Keep the one wire/storage format in one schema so every boundary agrees.
 */
export const projectIdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export function isProjectId(value: string): boolean {
  return projectIdSchema.safeParse(value).success;
}
