/**
 * The single chokepoint for "who is calling": a `trs_agent_...` bearer token
 * when one is present, otherwise the Clerk session cookie. Both
 * `getCurrentIdentity` in `lib/access.ts` and `authorizeDiagram` in
 * `lib/diagram-access.ts` route through this module.
 *
 * Resolution never calls the Clerk API beyond `auth()`.
 */

import { auth } from "@clerk/nextjs/server";

import type { Identity } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { hashAgentToken, isAgentTokenFormat } from "@/lib/agent-token";

const BEARER_PREFIX = "Bearer ";

export type IdentitySource =
  | { kind: "bearer"; userId: string; tokenId: string }
  | { kind: "session"; userId: string };

/**
 * Looks up the bearer token's owning `AgentToken` row, or `null` when the
 * header is absent, malformed, or names an unknown/revoked token.
 *
 * A *present* Authorization header that fails to resolve returns `null` here
 * rather than falling through to the Clerk session below — mixing auth
 * signals silently would let a bad bearer token quietly ride a legitimate
 * cookie instead of failing loudly with 401.
 */
async function resolveBearerSource(request: Request): Promise<IdentitySource | null | "no-header"> {
  const header = request.headers.get("authorization");

  if (!header) {
    return "no-header";
  }

  if (!header.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (!isAgentTokenFormat(token)) {
    return null;
  }

  const record = await prisma.agentToken.findUnique({
    where: { tokenHash: hashAgentToken(token) },
    select: { id: true, ownerId: true },
  });

  if (!record) {
    return null;
  }

  // Best-effort: a failed stamp must not fail the request it authorized.
  prisma.agentToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((error: unknown) => {
      console.error(`Agent token lastUsedAt stamp failed for ${record.id}`, error);
    });

  return { kind: "bearer", userId: record.ownerId, tokenId: record.id };
}

export async function resolveIdentitySource(request?: Request): Promise<IdentitySource | null> {
  const bearer = request ? await resolveBearerSource(request) : "no-header";

  if (bearer !== "no-header") {
    return bearer;
  }

  const { userId } = await auth();

  return userId ? { kind: "session", userId } : null;
}

/** `null` when signed out and no valid bearer token is present. */
export async function resolveIdentity(request?: Request): Promise<Identity | null> {
  const source = await resolveIdentitySource(request);

  return source ? { userId: source.userId } : null;
}
