import "dotenv/config";

import assert from "node:assert/strict";

import { POST as mintTokenRoute } from "../app/api/agent/tokens/route";
import {
  resolveIdentity,
  resolveIdentitySource,
} from "../lib/agent-identity";
import {
  agentTokenHashesEqual,
  hashAgentToken,
  isAgentTokenFormat,
  mintAgentToken,
} from "../lib/agent-token";
import {
  handleAgentTokenMintPost,
  MAX_LIVE_AGENT_TOKENS,
  type AgentTokenMintDependencies,
} from "../lib/agent-token-server";
import { prisma } from "../lib/prisma";
import { authorizeProject } from "../lib/project-access";

/**
 * Exercises the agent-token chokepoint against the live database: DB-backed
 * bearer resolution, the mint route's session-only guard, and
 * `authorizeProject`'s 401 → 404 → 403 ordering under a bearer identity.
 *
 * The Clerk *session-cookie* path (`auth()`/`currentUser()`) cannot run here —
 * both are guarded by Next.js request-scoped context that only exists inside
 * a real request, and throw when called from a plain script. That is exactly
 * why every other unit script (`verify-agent-graph-edit.ts`,
 * `verify-project-api.ts`, ...) mocks `authorizeProject` wholesale rather than
 * calling it directly. This script instead proves the ordering logic itself —
 * shared by both identity sources, since nothing after identity resolution
 * branches on which kind produced `userId` — by driving it end to end through
 * the bearer path, which needs no Next.js request context.
 */

const OWNER_ID = "verify_agent_token_owner";
const OTHER_OWNER_ID = "verify_agent_token_other_owner";
// Separate from OWNER_ID so the cap test's fixture count is not polluted by
// tokens the earlier bearer-resolution tests already minted for OWNER_ID.
const MINT_OWNER_ID = "verify_agent_token_mint_owner";
const PROJECT_ID = "verify-agent-token-project";
const TOMBSTONE_PROJECT_ID = "verify-agent-token-tombstone";

function bearerRequest(token: string): Request {
  return new Request("http://localhost/api/projects", {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function cleanup(): Promise<void> {
  await prisma.agentToken.deleteMany({
    where: { ownerId: { in: [OWNER_ID, OTHER_OWNER_ID, MINT_OWNER_ID] } },
  });
  await prisma.project.deleteMany({
    where: { id: { in: [PROJECT_ID, TOMBSTONE_PROJECT_ID] } },
  });
}

/** Pure helpers — no DB, no network. */
function checkTokenFormatHelpers(): void {
  const token = mintAgentToken();

  assert.ok(token.startsWith("trs_agent_"), "minted token carries the prefix");
  assert.ok(isAgentTokenFormat(token), "a freshly minted token matches its own format check");

  assert.equal(hashAgentToken(token), hashAgentToken(token), "hashing is deterministic");
  assert.match(hashAgentToken(token), /^[0-9a-f]{64}$/, "the hash is a sha256 hex digest");
  assert.notEqual(hashAgentToken(token), hashAgentToken(mintAgentToken()), "distinct tokens hash distinctly");

  for (const bad of [
    "trs_agent_tooshort",
    "wrong_prefix_" + "a".repeat(43),
    token.slice(0, -1), // one character short
    token + "x", // one character long
    "",
    42,
    null,
    undefined,
  ]) {
    assert.equal(isAgentTokenFormat(bad), false, `rejects ${JSON.stringify(bad)}`);
  }

  const hashA = hashAgentToken(mintAgentToken());
  const hashB = hashAgentToken(mintAgentToken());

  assert.equal(agentTokenHashesEqual(hashA, hashA), true, "a hash equals itself");
  assert.equal(agentTokenHashesEqual(hashA, hashB), false, "distinct hashes are unequal");
  assert.equal(agentTokenHashesEqual(hashA, "00"), false, "a length mismatch is unequal, not a throw");
}

/** A valid bearer token resolves to its owner without ever needing a Clerk cookie. */
async function checkBearerResolutionReturnsOwnerIdentity(): Promise<void> {
  const token = mintAgentToken();
  await prisma.agentToken.create({
    data: { ownerId: OWNER_ID, tokenHash: hashAgentToken(token), label: "CI" },
  });

  const identity = await resolveIdentity(bearerRequest(token));

  assert.ok(identity, "a valid bearer token resolves to an identity");
  assert.equal(identity?.userId, OWNER_ID);
  assert.ok(
    identity?.email === null || typeof identity?.email === "string",
    "email is either resolved or gracefully null, never a thrown error",
  );

  // Best-effort lastUsedAt stamping actually lands on the success path.
  const stamped = await prisma.agentToken.findUnique({
    where: { tokenHash: hashAgentToken(token) },
    select: { lastUsedAt: true },
  });
  assert.ok(stamped?.lastUsedAt, "a successful resolution stamps lastUsedAt");
}

/** Unknown, malformed, and revoked tokens all resolve to no identity — never a fallback to a cookie. */
async function checkUnknownMalformedAndRevokedTokensResolveToNothing(): Promise<void> {
  const unknown = mintAgentToken(); // well-formed, never stored
  assert.equal(await resolveIdentitySource(bearerRequest(unknown)), null, "unknown token");

  assert.equal(
    await resolveIdentitySource(bearerRequest("not-even-the-right-shape")),
    null,
    "malformed token",
  );

  const revoked = mintAgentToken();
  await prisma.agentToken.create({
    data: { ownerId: OWNER_ID, tokenHash: hashAgentToken(revoked), label: "revoke-me" },
  });
  await prisma.agentToken.deleteMany({ where: { tokenHash: hashAgentToken(revoked) } });

  assert.equal(await resolveIdentitySource(bearerRequest(revoked)), null, "revoked token");
}

/** `authorizeProject` answers 401 for a request an unknown bearer token cannot resolve. */
async function checkAuthorizeProjectAnswers401ForAnUnknownToken(): Promise<void> {
  const response = await authorizeProject(bearerRequest(mintAgentToken()), PROJECT_ID, {
    requireOwner: false,
  });

  assert.equal(response.ok, false);
  assert.equal(!response.ok && response.response.status, 401);
}

/**
 * `authorizeProject`'s 401 → 404 → 403 ordering, deletion-tombstone rule, and
 * owner-path laziness, all driven by a real bearer identity against the live
 * database. Nothing in this ordering logic branches on identity source, so
 * this is the same code path a Clerk session takes.
 */
async function checkAuthorizeProjectOrderingUnderBearerIdentity(): Promise<void> {
  const ownerToken = mintAgentToken();
  await prisma.agentToken.create({
    data: { ownerId: OWNER_ID, tokenHash: hashAgentToken(ownerToken), label: "owner" },
  });

  const strangerToken = mintAgentToken();
  await prisma.agentToken.create({
    data: { ownerId: OTHER_OWNER_ID, tokenHash: hashAgentToken(strangerToken), label: "stranger" },
  });

  await prisma.project.create({
    data: { id: PROJECT_ID, ownerId: OWNER_ID, name: "Agent Token Fixture" },
  });

  // Unknown project: 404, before any role is considered.
  const missing = await authorizeProject(bearerRequest(ownerToken), "no-such-project", {
    requireOwner: false,
  });
  assert.equal(!missing.ok && missing.response.status, 404, "unknown project is 404");

  // Owner match: ok, and this path never needed a Clerk email lookup to succeed.
  const owner = await authorizeProject(bearerRequest(ownerToken), PROJECT_ID, {
    requireOwner: true,
  });
  assert.ok(owner.ok && owner.role === "owner" && owner.userId === OWNER_ID);

  // Non-owner + requireOwner: 403, before any collaborator lookup.
  const forbiddenOwnerOnly = await authorizeProject(bearerRequest(strangerToken), PROJECT_ID, {
    requireOwner: true,
  });
  assert.equal(!forbiddenOwnerOnly.ok && forbiddenOwnerOnly.response.status, 403);

  // Non-owner, collaborator allowed: still 403, because this token's owner has
  // no real Clerk account to resolve an email for — the collaborator check
  // must deny safely rather than throw when email resolution comes back empty.
  const forbiddenCollaborator = await authorizeProject(bearerRequest(strangerToken), PROJECT_ID, {
    requireOwner: false,
  });
  assert.equal(!forbiddenCollaborator.ok && forbiddenCollaborator.response.status, 403);

  // Deletion tombstone: 404 for everyone by default, retryable for the owner.
  await prisma.project.create({
    data: {
      id: TOMBSTONE_PROJECT_ID,
      ownerId: OWNER_ID,
      name: "Tombstoned",
      status: "DELETING",
    },
  });

  const tombstoneDefault = await authorizeProject(bearerRequest(ownerToken), TOMBSTONE_PROJECT_ID, {
    requireOwner: true,
  });
  assert.equal(!tombstoneDefault.ok && tombstoneDefault.response.status, 404);

  const tombstoneRetry = await authorizeProject(bearerRequest(ownerToken), TOMBSTONE_PROJECT_ID, {
    requireOwner: true,
    allowDeletionStates: true,
  });
  assert.ok(tombstoneRetry.ok, "the owner may retry cleanup on a tombstoned project");
}

/** The mint route never accepts a bearer token — a token must not mint another. */
async function checkBearerRejectedAtTheMintRoute(): Promise<void> {
  const response = await mintTokenRoute(
    new Request("http://localhost/api/agent/tokens", {
      method: "POST",
      headers: { authorization: "Bearer trs_agent_" + "a".repeat(43) },
    }),
  );

  assert.equal(response.status, 401, "a bearer-authenticated caller cannot mint a token");
}

function mintDependencies(): AgentTokenMintDependencies {
  return {
    countTokens: (ownerId) => prisma.agentToken.count({ where: { ownerId } }),
    createToken: async ({ ownerId, tokenHash, label }) => {
      await prisma.agentToken.create({ data: { ownerId, tokenHash, label } });
    },
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The 10-live-token cap, and the label validation around it. */
async function checkTenTokenCapAndLabelValidation(): Promise<void> {
  const response400 = await handleAgentTokenMintPost(
    jsonRequest({ label: "x".repeat(81) }),
    MINT_OWNER_ID,
    mintDependencies(),
  );
  assert.equal(response400.status, 400, "an over-long label is rejected");

  const defaulted = await handleAgentTokenMintPost(jsonRequest({}), MINT_OWNER_ID, mintDependencies());
  assert.equal(defaulted.status, 201);
  const defaultedBody = (await defaulted.json()) as { token: string; label: string };
  assert.equal(defaultedBody.label, "Truss agent", "an absent label falls back to the default");
  assert.ok(isAgentTokenFormat(defaultedBody.token));

  // Fill up to the cap with the one token already minted above plus fakes.
  await prisma.agentToken.createMany({
    data: Array.from({ length: MAX_LIVE_AGENT_TOKENS - 1 }, (_, index) => ({
      ownerId: MINT_OWNER_ID,
      tokenHash: hashAgentToken(`filler-${index}-${mintAgentToken()}`),
      label: `filler ${index}`,
    })),
  });

  const atCap = await prisma.agentToken.count({ where: { ownerId: MINT_OWNER_ID } });
  assert.equal(atCap, MAX_LIVE_AGENT_TOKENS, "the fixture sits exactly at the cap");

  const rejected = await handleAgentTokenMintPost(
    jsonRequest({ label: "one too many" }),
    MINT_OWNER_ID,
    mintDependencies(),
  );
  assert.equal(rejected.status, 409, "an 11th token is refused");

  const countAfterRejection = await prisma.agentToken.count({ where: { ownerId: MINT_OWNER_ID } });
  assert.equal(countAfterRejection, MAX_LIVE_AGENT_TOKENS, "a 409 creates nothing");
}

/** A failed lastUsedAt stamp must not fail the resolution it authorized. */
async function checkStampFailureDoesNotFailResolution(): Promise<void> {
  const token = mintAgentToken();
  await prisma.agentToken.create({
    data: { ownerId: OWNER_ID, tokenHash: hashAgentToken(token), label: "stamp-failure" },
  });

  const originalUpdate = prisma.agentToken.update.bind(prisma.agentToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only monkeypatch of a singleton client method
  (prisma.agentToken as any).update = async () => {
    throw new Error("simulated stamp failure");
  };

  try {
    const identity = await resolveIdentity(bearerRequest(token));
    assert.ok(identity, "resolution still succeeds when the stamp write fails");
    assert.equal(identity?.userId, OWNER_ID);
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- restoring the monkeypatch above
    (prisma.agentToken as any).update = originalUpdate;
  }
}

async function main(): Promise<void> {
  await cleanup();

  try {
    checkTokenFormatHelpers();
    await checkBearerResolutionReturnsOwnerIdentity();
    await checkUnknownMalformedAndRevokedTokensResolveToNothing();
    await checkAuthorizeProjectAnswers401ForAnUnknownToken();
    await checkAuthorizeProjectOrderingUnderBearerIdentity();
    await checkBearerRejectedAtTheMintRoute();
    await checkTenTokenCapAndLabelValidation();
    await checkStampFailureDoesNotFailResolution();
  } finally {
    await cleanup();
  }

  console.log("verify-agent-token: ok");
}

main()
  .catch((error) => {
    console.error("verify-agent-token: FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
