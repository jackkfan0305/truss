import { clerkClient } from "@clerk/nextjs/server";
import type { User } from "@clerk/nextjs/server";

/**
 * Clerk profile lookups. There is no local user table (09-share-dialog), so the
 * share dialog reads names and avatars from Clerk at render time — by email for
 * collaborators, by user ID for the owner.
 */

export interface UserProfile {
  name: string;
  imageUrl: string;
}

/** The owner is stored as a Clerk user ID, so even their email comes from Clerk. */
export interface OwnerProfile {
  email: string | null;
  name: string | null;
  imageUrl: string | null;
}

/** Clerk's list filter accepts at most 100 addresses per call. */
const EMAIL_BATCH_SIZE = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

/**
 * Indexes Clerk users by every email they own, lowercased.
 *
 * Keyed on the user's own addresses rather than on the queried email on
 * purpose: Clerk's filter is not guaranteed to be an exact match, so pairing
 * request order with response order could attach the wrong avatar to an
 * address. A user with several addresses is indexed under all of them.
 */
export function indexUsersByEmail(
  users: readonly User[],
): Map<string, UserProfile> {
  const profiles = new Map<string, UserProfile>();

  for (const user of users) {
    const name = user.fullName?.trim() || user.username?.trim();

    if (!name) {
      // No display name means nothing to add over the email itself.
      continue;
    }

    for (const address of user.emailAddresses) {
      profiles.set(address.emailAddress.toLowerCase(), {
        name,
        imageUrl: user.imageUrl,
      });
    }
  }

  return profiles;
}

/**
 * Profiles for the given emails, keyed lowercased. Missing entries are the
 * normal case — an invite can precede the invitee ever signing up — and callers
 * fall back to showing the email alone.
 *
 * A Clerk outage degrades to that same email-only rendering rather than failing
 * the whole collaborator list, since the list is still correct without it.
 */
export async function getUserProfiles(
  emails: readonly string[],
): Promise<Map<string, UserProfile>> {
  if (emails.length === 0) {
    return new Map();
  }

  try {
    const client = await clerkClient();
    const batches = chunk(emails, EMAIL_BATCH_SIZE);

    const responses = await Promise.all(
      batches.map((batch) =>
        client.users.getUserList({
          emailAddress: [...batch],
          limit: batch.length,
        }),
      ),
    );

    return indexUsersByEmail(responses.flatMap((response) => response.data));
  } catch (error) {
    console.error("Clerk profile lookup failed; falling back to emails", error);
    return new Map();
  }
}

/**
 * Profile for a project owner, looked up by Clerk user ID.
 *
 * Returns all-null rather than throwing when Clerk is unreachable or the user
 * has been deleted: the owner still holds the project, so the share dialog
 * shows the row without a name — the same degradation collaborators get.
 */
export async function getOwnerProfile(userId: string): Promise<OwnerProfile> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);

    return {
      email: user.primaryEmailAddress?.emailAddress ?? null,
      name: user.fullName?.trim() || user.username?.trim() || null,
      imageUrl: user.imageUrl || null,
    };
  } catch (error) {
    console.error(`Clerk lookup failed for owner ${userId}`, error);
    return { email: null, name: null, imageUrl: null };
  }
}
