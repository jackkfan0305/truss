/**
 * The spec generation contract (27-spec-generation-flow), as a Zod schema the
 * `generate-spec` task parses its payload with.
 *
 * `schemaTask` re-parses in the worker rather than trusting whoever queued the
 * run: a dashboard replay or an older caller can put anything on the queue, so
 * the worker validates for itself.
 *
 * The canvas graph and the chat transcript used to arrive here from the browser
 * and are gone (35-orchestrator-backend). The task reads the room itself, which
 * removes a large client-supplied body, removes the chance of a spec describing
 * a stale canvas, and leaves this schema as the four identifiers a run needs.
 */

import { z } from "zod";

import { projectIdSchema } from "@/lib/project-id";

const MAX_MESSAGE_ID_LENGTH = 256;

/** Enough for a sentence of emphasis; this is a hint, not a brief. */
const MAX_FOCUS_LENGTH = 500;

const roomId = z
  .string()
  .trim()
  .pipe(projectIdSchema);

export const specPayloadSchema = z
  .object({
    projectId: roomId,
    roomId,
    /** The human message this spec answers, excluded from the history it reads. */
    promptMessageId: z.string().trim().max(MAX_MESSAGE_ID_LENGTH).optional(),
    /** The run owning the turn's chat row, so its own row is not read back in. */
    chatRunId: z.string().trim().max(MAX_MESSAGE_ID_LENGTH).optional(),
    /** Optional emphasis the orchestrator carried over from the user's request. */
    focus: z.string().trim().max(MAX_FOCUS_LENGTH).optional(),
  })
  .refine(({ projectId, roomId }) => projectId === roomId, {
    message: "projectId and roomId must match",
    path: ["roomId"],
  });

export type SpecPayload = z.infer<typeof specPayloadSchema>;
