import { auth } from "@clerk/nextjs/server";

import {
  handleAgentTokenMintPost,
  type AgentTokenMintDependencies,
} from "@/lib/agent-token-server";
import { prisma } from "@/lib/prisma";
import { jsonError } from "@/lib/project-requests";

const dependencies: AgentTokenMintDependencies = {
  countTokens: (ownerId) => prisma.agentToken.count({ where: { ownerId } }),
  createToken: async ({ ownerId, tokenHash, label }) => {
    await prisma.agentToken.create({ data: { ownerId, tokenHash, label } });
  },
};

/**
 * Mints a long-lived `trs_agent_...` bearer token so a CLI can call the API
 * headlessly (the shared agent-auth contract).
 *
 * Clerk SESSION COOKIE only. This deliberately does not go through
 * `resolveIdentity`/`authorizeProject` — both treat a bearer token as a
 * legitimate identity, which is exactly what this one route must refuse: a
 * caller presenting an `Authorization` header is rejected outright, so a
 * minted token can never be used to mint another.
 */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("authorization")) {
    return jsonError("Unauthorized", 401);
  }

  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  return handleAgentTokenMintPost(request, userId, dependencies);
}
