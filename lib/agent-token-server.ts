import { hashAgentToken, mintAgentToken } from "@/lib/agent-token";
import { jsonError, readJsonBody } from "@/lib/project-requests";

const MAX_LABEL_LENGTH = 80;
const DEFAULT_LABEL = "Truss agent";

/** The shared agent-auth contract's cap: at most 10 live tokens per owner. */
export const MAX_LIVE_AGENT_TOKENS = 10;

export interface AgentTokenMintDependencies {
  countTokens: (ownerId: string) => Promise<number>;
  createToken: (params: {
    ownerId: string;
    tokenHash: string;
    label: string;
  }) => Promise<void>;
}

/** Trimmed, capped, defaulted. `null` means the caller should get a 400. */
function parseLabel(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const raw = (body as { label?: unknown }).label;

  if (raw === undefined || raw === null) {
    return DEFAULT_LABEL;
  }

  if (typeof raw !== "string") {
    return null;
  }

  const label = raw.trim();

  if (!label) {
    return DEFAULT_LABEL;
  }

  return label.length > MAX_LABEL_LENGTH ? null : label;
}

/**
 * Injectable mint workflow for `POST /api/agent/tokens`.
 *
 * `ownerId` is resolved by the route *before* this runs, and only from the
 * Clerk session cookie — see the route's own comment for why a bearer agent
 * token must never reach here.
 *
 * The 10-token cap is a plain count-then-create, not the conditional-upsert
 * lock `lib/ai-request-rate-limit.ts` uses: minting is a rare, human-initiated
 * action from one browser tab, not a serverless burst path, so the small race
 * window between the count and the insert is an accepted cost rather than
 * something worth a raw SQL guard for.
 */
export async function handleAgentTokenMintPost(
  request: Request,
  ownerId: string,
  dependencies: AgentTokenMintDependencies,
): Promise<Response> {
  const label = parseLabel(await readJsonBody(request));

  if (label === null) {
    return jsonError("Label must be 80 characters or fewer", 400);
  }

  const liveTokenCount = await dependencies.countTokens(ownerId);

  if (liveTokenCount >= MAX_LIVE_AGENT_TOKENS) {
    return jsonError("You already have the maximum number of agent tokens", 409);
  }

  // Plaintext lives only in this stack frame and the response body — hashed
  // before it ever reaches `createToken`, and never logged.
  const token = mintAgentToken();

  await dependencies.createToken({
    ownerId,
    tokenHash: hashAgentToken(token),
    label,
  });

  return Response.json({ token, label }, { status: 201 });
}
