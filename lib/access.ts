import { resolveIdentity } from "@/lib/agent-identity";

/**
 * The identity and authorization primitives every access check is built from.
 *
 * Kept apart from `lib/diagram-access.ts` so a type-only importer (the
 * `*-server.ts` handlers) pulls in nothing that touches Prisma at module load.
 */

export interface Identity {
  userId: string;
}

/**
 * Identity for the current request, or `null` when signed out and no valid
 * bearer token is present. `request` is optional because page loads have no
 * bearer channel and fall straight to the Clerk cookie.
 */
export async function getCurrentIdentity(request?: Request): Promise<Identity | null> {
  return resolveIdentity(request);
}

/** Every diagram is owner-only (ADR 0005), so success carries only the owner. */
export type Authorization =
  | { ok: true; userId: string }
  | { ok: false; response: Response };
