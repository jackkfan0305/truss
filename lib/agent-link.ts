import { z } from "zod";

import { decodeBase64Url } from "@/lib/agent-launch";

export const AGENT_LINK_PATH = "/agent/link";
export const AGENT_LINK_QUERY_KEY = "link";
export const AGENT_LINK_STORAGE_PREFIX = "truss.agent-link.v1:";
// The link payload is just an id, a port and a nonce — no graph, no op — so
// the same small bound as the pick fragment is enough to reject garbage
// early. See MAX_AGENT_PICK_FRAGMENT_LENGTH in lib/agent-pick.ts.
export const MAX_AGENT_LINK_FRAGMENT_LENGTH = 2048;

// Same canonical UUID v4 pattern as `AGENT_LAUNCH_ID_PATTERN` in
// lib/agent-launch.ts and `AGENT_PICK_ID_PATTERN` in lib/agent-pick.ts,
// reused here for both `linkId` and `nonce`.
const AGENT_LINK_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface AgentLinkPayloadV1 {
  version: 1;
  linkId: string;
  port: number;
  nonce: string;
}

const agentLinkPayloadSchema = z.strictObject({
  version: z.literal(1),
  linkId: z.string().regex(AGENT_LINK_ID_PATTERN),
  port: z.number().int().min(1024).max(65535),
  nonce: z.string().regex(AGENT_LINK_ID_PATTERN),
});

export function isAgentLinkId(value: unknown): value is string {
  return typeof value === "string" && AGENT_LINK_ID_PATTERN.test(value);
}

export function agentLinkStorageKey(linkId: string): string {
  return `${AGENT_LINK_STORAGE_PREFIX}${linkId}`;
}

export function parseAgentLinkFragment(hash: string): AgentLinkPayloadV1 | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;

  if (!fragment || fragment.length > MAX_AGENT_LINK_FRAGMENT_LENGTH) {
    return null;
  }

  const decoded = decodeBase64Url(fragment);

  if (decoded === null) {
    return null;
  }

  try {
    const parsed = agentLinkPayloadSchema.safeParse(JSON.parse(decoded));

    return parsed.success ? { ...parsed.data } : null;
  } catch {
    return null;
  }
}
