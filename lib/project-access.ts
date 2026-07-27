import { auth, currentUser } from "@clerk/nextjs/server";

export interface Identity {
  userId: string;
  /** Primary Clerk email. `null` when the user has none — collaboration is keyed on it. */
  email: string | null;
}

/**
 * Clerk identity for the current request, or `null` when signed out.
 *
 * Two calls, not one: `auth()` reads the session token for the user ID, but the
 * default token carries no email claim, and `ProjectCollaborator` is keyed on
 * email — so `currentUser()` is needed for the shared-project lookup.
 *
 * 08-editor-workspace-shell adds the per-project access check to this module.
 */
export async function getCurrentIdentity(): Promise<Identity | null> {
  const { userId } = await auth();

  if (!userId) {
    return null;
  }

  const user = await currentUser();

  return { userId, email: user?.primaryEmailAddress?.emailAddress ?? null };
}
