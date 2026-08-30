import { currentUser } from "@clerk/nextjs/server";

import { Prisma } from "@/generated/prisma/client";
import {
  jsonError,
  parseCollaboratorEmail,
  readJsonBody,
} from "@/lib/api-requests";
import { getOwnerProfile, getUserProfiles } from "@/lib/clerk-users";
import { prisma } from "@/lib/prisma";
import { authorizeStoryboard } from "@/lib/storyboard-access";
import type { StoryboardMember } from "@/types/storyboard";

const UNIQUE_VIOLATION = "P2002";

interface RouteParams {
  params: Promise<{ storyboardId: string }>;
}

/**
 * Everyone with access to a storyboard: the owner first, then collaborators in
 * invite order, all enriched with Clerk names and avatars.
 *
 * The owner is included because the share dialog's list is "people with
 * access", and a list that omits the one person who always has it reads as a
 * bug. They have no `StoryboardCollaborator` row, so their identity comes from
 * `Storyboard.ownerId` via Clerk.
 */
async function listMembers(
  storyboardId: string,
  ownerId: string,
): Promise<StoryboardMember[]> {
  const rows = await prisma.storyboardCollaborator.findMany({
    where: { storyboardId },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });

  // Independent lookups: one call by user ID, one batched by email.
  const [owner, profiles] = await Promise.all([
    getOwnerProfile(ownerId),
    getUserProfiles(rows.map((row) => row.email)),
  ]);

  const collaborators: StoryboardMember[] = rows.map((row) => {
    const profile = profiles.get(row.email.toLowerCase());

    return {
      id: row.id,
      email: row.email,
      name: profile?.name ?? null,
      imageUrl: profile?.imageUrl ?? null,
      role: "collaborator",
    };
  });

  return [{ id: ownerId, ...owner, role: "owner" }, ...collaborators];
}

/** Readable by owner and collaborators alike — the share dialog is read-only for the latter. */
export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { storyboardId } = await params;

  const access = await authorizeStoryboard(request, storyboardId, {
    requireOwner: false,
  });

  if (!access.ok) {
    return access.response;
  }

  return Response.json({
    members: await listMembers(storyboardId, access.ownerId),
  });
}

export async function POST(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { storyboardId } = await params;

  const access = await authorizeStoryboard(request, storyboardId, {
    requireOwner: true,
  });

  if (!access.ok) {
    return access.response;
  }

  const email = parseCollaboratorEmail(await readJsonBody(request));

  if (!email) {
    return jsonError("Enter a valid email address", 400);
  }

  // The owner already appears in the list; a self-invite would duplicate them
  // as a collaborator row they cannot act on.
  const owner = await currentUser();
  const ownerEmail = owner?.primaryEmailAddress?.emailAddress;

  if (ownerEmail && ownerEmail.toLowerCase() === email) {
    return jsonError("You already own this storyboard", 400);
  }

  try {
    await prisma.storyboardCollaborator.create({ data: { storyboardId, email } });
  } catch (caught) {
    if (
      caught instanceof Prisma.PrismaClientKnownRequestError &&
      caught.code === UNIQUE_VIOLATION
    ) {
      return jsonError("That person already has access", 409);
    }

    throw caught;
  }

  return Response.json(
    { members: await listMembers(storyboardId, access.ownerId) },
    { status: 201 },
  );
}
