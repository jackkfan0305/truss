import { resolveIdentity } from "@/lib/agent-identity";
import type { StoryboardRole } from "@/types/storyboard";

/**
 * The identity and authorization primitives every access check is built from.
 *
 * Kept separate from `lib/diagram-access.ts` and `lib/storyboard-access.ts` so
 * neither has to depend on the other for the shared `Authorization` shape, and
 * so a type-only importer (the `*-server.ts` handlers) pulls in nothing that
 * touches Prisma at module load.
 */

export interface Identity {
  userId: string;
  /** Primary Clerk email. `null` when the user has none — collaboration is keyed on it. */
  email: string | null;
}

/**
 * Identity for the current request, or `null` when signed out and no valid
 * bearer token is present.
 *
 * A thin wrapper over `resolveIdentity` (`lib/agent-identity.ts`), the shared
 * chokepoint a bearer `trs_agent_...` token and the Clerk session cookie both
 * go through. `request` is optional because page loads (`app/editor/page.tsx`)
 * have no bearer channel to check — a browser navigation never carries a
 * custom Authorization header — and fall straight to the cookie path.
 */
export async function getCurrentIdentity(request?: Request): Promise<Identity | null> {
  return resolveIdentity(request);
}

export type Authorization =
  | { ok: true; role: StoryboardRole; userId: string; ownerId: string }
  | { ok: false; response: Response };
