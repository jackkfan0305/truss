/**
 * The spec generation contract (27-spec-generation-flow), as Zod schemas shared
 * by `POST /api/ai/spec` and the `generate-spec` task.
 *
 * One definition, parsed twice: the route parses the browser's body, and
 * `schemaTask` re-parses the payload in the worker. A task payload is not only
 * ever written by that route — a dashboard replay or an older caller can put
 * anything on the queue — so the worker validates for itself rather than
 * trusting that the route already did.
 *
 * Unknown keys are stripped rather than rejected: the canvas sends full React
 * Flow nodes, and a spec only needs the labels and connections out of them.
 */

import { z } from "zod";

import { NODE_SHAPES } from "@/types/canvas";
import { AI_CHAT_ROLES, MAX_CHAT_CONTENT_LENGTH } from "@/types/tasks";

/** Room IDs are project ID slugs — see lib/project-requests.ts. */
const MIN_ROOM_ID_LENGTH = 3;
const MAX_ROOM_ID_LENGTH = 80;

const MAX_ELEMENT_ID_LENGTH = 200;
const MAX_LABEL_LENGTH = 200;

/**
 * Caps, not expectations. A canvas or transcript larger than this cannot be
 * described to the model in one prompt anyway, and an unbounded array here is
 * an unbounded request body.
 */
const MAX_GRAPH_ITEMS = 300;
const MAX_CHAT_MESSAGES = 60;

const elementId = z.string().trim().min(1).max(MAX_ELEMENT_ID_LENGTH);
const label = z.string().trim().max(MAX_LABEL_LENGTH).optional().default("");

/**
 * Position, size and styling are deliberately absent: a Markdown spec is written
 * from what the nodes *are*, not from where they sit. Shape carries meaning on
 * this canvas (cylinder = store, hexagon = external system), so it is kept.
 */
const specNodeSchema = z.object({
  id: elementId,
  data: z
    .object({ label, shape: z.enum(NODE_SHAPES).optional() })
    .optional()
    .default({ label: "" }),
});

const specEdgeSchema = z.object({
  id: elementId,
  source: elementId,
  target: elementId,
  data: z.object({ label }).optional().default({ label: "" }),
});

const specChatMessageSchema = z.object({
  role: z.enum(AI_CHAT_ROLES),
  content: z.string().trim().min(1).max(MAX_CHAT_CONTENT_LENGTH),
});

/**
 * The request body. No `projectId`: a room ID *is* its project ID
 * (lib/room-id.ts), so the route derives the project to authorize against
 * rather than accepting a second, client-chosen answer to the same question.
 */
export const specRequestSchema = z.object({
  roomId: z.string().trim().min(MIN_ROOM_ID_LENGTH).max(MAX_ROOM_ID_LENGTH),
  chatHistory: z
    .array(specChatMessageSchema)
    .max(MAX_CHAT_MESSAGES)
    .optional()
    .default([]),
  nodes: z.array(specNodeSchema).max(MAX_GRAPH_ITEMS).optional().default([]),
  edges: z.array(specEdgeSchema).max(MAX_GRAPH_ITEMS).optional().default([]),
});

/** The task payload: the request plus the project the route resolved for it. */
export const specPayloadSchema = specRequestSchema.extend({
  projectId: z.string().trim().min(MIN_ROOM_ID_LENGTH).max(MAX_ROOM_ID_LENGTH),
});

export type SpecRequest = z.infer<typeof specRequestSchema>;
export type SpecPayload = z.infer<typeof specPayloadSchema>;
export type SpecNode = z.infer<typeof specNodeSchema>;
export type SpecEdge = z.infer<typeof specEdgeSchema>;
