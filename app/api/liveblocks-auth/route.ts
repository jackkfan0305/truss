import { currentUser } from "@clerk/nextjs/server";

import { getCursorColor, getLiveblocks } from "@/lib/liveblocks";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";

/**
 * Liveblocks room token endpoint (10-liveblocks-setup).
 *
 * The Liveblocks client POSTs `{ room }` here whenever it joins a room. A
 * project ID *is* its room ID (see `lib/room-id.ts`), so the room name the
 * client asks for is exactly the project whose membership must be checked.
 *
 * Access tokens rather than ID tokens: membership here is dynamic — a
 * collaborator is a `ProjectCollaborator` row matched on email — so permission
 * is computed per request from the database instead of mirrored into the room's
 * `usersAccesses` on every invite and removal.
 */

/** The room name the Liveblocks client sends, or `null` if the body is junk. */
function parseRoomId(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const room = (body as { room?: unknown }).room;

  return typeof room === "string" && room.length > 0 ? room : null;
}

export async function POST(request: Request): Promise<Response> {
  const roomId = parseRoomId(await readJsonBody(request));

  if (!roomId) {
    return jsonError("A room is required", 400);
  }

  // 401 / 404 / 403 before anything else — an outsider must not be able to
  // create a room or spend a Clerk lookup.
  const authorization = await authorizeProject(roomId, { requireOwner: false });

  if (!authorization.ok) {
    return authorization.response;
  }

  const user = await currentUser();

  if (!user) {
    // authorizeProject already saw a session, so this is a race with sign-out.
    return jsonError("Unauthorized", 401);
  }

  const liveblocks = getLiveblocks();

  try {
    // Private by default: the access token below is the only way in, so room
    // permissions must not grant anything on their own.
    await liveblocks.getOrCreateRoom(roomId, { defaultAccesses: [] });
  } catch (error) {
    console.error(`Liveblocks room setup failed for ${roomId}`, error);
    return jsonError("Could not open the room", 502);
  }

  const session = liveblocks.prepareSession(user.id, {
    userInfo: {
      name:
        user.fullName?.trim() ||
        user.username?.trim() ||
        user.primaryEmailAddress?.emailAddress ||
        "Anonymous",
      avatar: user.imageUrl,
      color: getCursorColor(user.id),
    },
  });

  // This room only. Owner and collaborator both edit; read-only sharing is not
  // part of the access model in architecture-context.md.
  session.allow(roomId, session.FULL_ACCESS);

  const { status, body } = await session.authorize();

  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
