import { z } from "zod";

import { decodeBase64Url } from "@/lib/agent-launch";

export const AGENT_PICK_PATH = "/agent/pick";
export const AGENT_PICK_QUERY_KEY = "pick";
export const AGENT_PICK_STORAGE_PREFIX = "truss.agent-pick.v1:";
// The pick payload is just an id, an op, a port and a nonce — nowhere near
// the graph-carrying launch fragment's cap, so a much smaller bound is
// enough to reject garbage early.
export const MAX_AGENT_PICK_FRAGMENT_LENGTH = 2048;

// Same canonical UUID v4 pattern as `AGENT_LAUNCH_ID_PATTERN` in
// lib/agent-launch.ts, reused here for both `pickId` and `nonce`.
const AGENT_PICK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type AgentPickOperation = "edit" | "delete";

export interface AgentPickPayloadV1 {
  version: 1;
  pickId: string;
  op: AgentPickOperation;
  port: number;
  nonce: string;
}

const agentPickPayloadSchema = z.strictObject({
  version: z.literal(1),
  pickId: z.string().regex(AGENT_PICK_ID_PATTERN),
  op: z.enum(["edit", "delete"]),
  port: z.number().int().min(1024).max(65535),
  nonce: z.string().regex(AGENT_PICK_ID_PATTERN),
});

export function isAgentPickId(value: unknown): value is string {
  return typeof value === "string" && AGENT_PICK_ID_PATTERN.test(value);
}

export function agentPickStorageKey(pickId: string): string {
  return `${AGENT_PICK_STORAGE_PREFIX}${pickId}`;
}

export function parseAgentPickFragment(hash: string): AgentPickPayloadV1 | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;

  if (!fragment || fragment.length > MAX_AGENT_PICK_FRAGMENT_LENGTH) {
    return null;
  }

  const decoded = decodeBase64Url(fragment);

  if (decoded === null) {
    return null;
  }

  try {
    const parsed = agentPickPayloadSchema.safeParse(JSON.parse(decoded));

    return parsed.success ? { ...parsed.data } : null;
  } catch {
    return null;
  }
}
