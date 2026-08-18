/**
 * Pure agent-token helpers — no Prisma import here on purpose. `lib/agent-identity.ts`
 * (the chokepoint) and `scripts/verify-agent-token.ts` both need these without
 * pulling in `lib/prisma.ts`, whose client construction throws without
 * `DATABASE_URL`. See the same reasoning in `lib/agent-graph-read-server.ts`.
 *
 * Token shape: `trs_agent_` + base64url(32 random bytes), per the shared
 * agent-auth contract. Only the SHA-256 hex digest of the *full* string
 * (prefix included) is ever stored — the plaintext is minted, returned once,
 * and never persisted or logged.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const AGENT_TOKEN_PREFIX = "trs_agent_";

// 32 random bytes, base64url-encoded without padding, is always 43 characters
// (256 bits / 6 bits-per-char, rounded up) — fixed, so the format check can be
// exact rather than a loose minimum.
const TOKEN_SECRET_LENGTH = 43;
const TOKEN_PATTERN = new RegExp(
  `^${AGENT_TOKEN_PREFIX}[A-Za-z0-9_-]{${TOKEN_SECRET_LENGTH}}$`,
);

const SHA256_HEX_LENGTH = 64;

/** A fresh plaintext agent token. Mint, return once, then discard — never store this. */
export function mintAgentToken(): string {
  return AGENT_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest of the full plaintext (prefix included). This is what gets stored. */
export function hashAgentToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Shape check only — not a validity check. A real token still has to hash to a stored row. */
export function isAgentTokenFormat(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * Constant-time hex-digest equality. A plain `===` leaks timing information
 * proportional to the matching prefix length; `timingSafeEqual` does not.
 * Length is checked first because `timingSafeEqual` throws on a mismatch
 * instead of returning `false`.
 */
export function agentTokenHashesEqual(a: string, b: string): boolean {
  if (a.length !== SHA256_HEX_LENGTH || b.length !== SHA256_HEX_LENGTH) {
    return false;
  }

  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
