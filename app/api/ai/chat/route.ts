import { currentUser } from "@clerk/nextjs/server";

import {
  parseAiChatRequest,
  type AiChatRequest,
} from "@/lib/ai-chat-requests";
import { createServerAiChatMessage } from "@/lib/ai-chat-server";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";
import type { AiChatMessage } from "@/types/tasks";

interface AuthenticatedAiChatUser {
  fullName: string | null;
  username: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  imageUrl: string;
}

/** Builds the user message exclusively from the authenticated Clerk identity. */
export function createAuthenticatedAiChatMessage(
  chatRequest: AiChatRequest,
  senderId: string,
  user: AuthenticatedAiChatUser,
  sentAt = Date.now()
): AiChatMessage {
  const senderName = (
    user.fullName?.trim() ||
    user.username?.trim() ||
    user.primaryEmailAddress?.emailAddress ||
    "Anonymous"
  ).slice(0, 120);

  return {
    role: "user",
    senderId,
    senderName,
    senderAvatar: user.imageUrl,
    content: chatRequest.content,
    sentAt,
  };
}

/** Authenticated, server-authored user chat prevents feed identity spoofing. */
export async function POST(request: Request): Promise<Response> {
  const chatRequest = parseAiChatRequest(await readJsonBody(request));

  if (!chatRequest) {
    return jsonError("A projectId and message are required", 400);
  }

  const access = await authorizeProject(chatRequest.projectId, {
    requireOwner: false,
  });

  if (!access.ok) {
    return access.response;
  }

  const user = await currentUser();

  if (!user) {
    return jsonError("Unauthorized", 401);
  }

  try {
    const id = await createServerAiChatMessage(
      chatRequest.projectId,
      createAuthenticatedAiChatMessage(chatRequest, access.userId, user)
    );

    return Response.json({ id }, { status: 201 });
  } catch (error: unknown) {
    console.error(`AI chat write failed for ${chatRequest.projectId}`, error);
    return jsonError("Message not sent", 502);
  }
}
