import { createHash } from "node:crypto";

import type { AiChatRequest } from "@/lib/ai-chat-requests";
import {
  createServerAiChatMessage,
  upsertServerAiChatMessage,
} from "@/lib/ai-chat-server";
import type { AiChatMessage } from "@/types/tasks";

export interface AuthenticatedAiChatUser {
  fullName: string | null;
  username: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  imageUrl: string;
}

export interface AiChatWriteDependencies {
  create: typeof createServerAiChatMessage;
  upsert: typeof upsertServerAiChatMessage;
}

/**
 * Produces the server-authored prompt row for one authenticated agent launch.
 * The launch ID alone is insufficient, so rows cannot cross users or projects.
 */
export function createAgentLaunchPromptMessageId(input: {
  launchId: string;
  projectId: string;
  userId: string;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([input.userId, input.projectId, input.launchId]))
    .digest("hex");

  return `chat-launch-${digest}`;
}

/** Builds the user message exclusively from the authenticated Clerk identity. */
export function createAuthenticatedAiChatMessage(
  chatRequest: AiChatRequest,
  senderId: string,
  user: AuthenticatedAiChatUser,
  sentAt = Date.now(),
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

/** Writes manual prompts once and agent-launch prompts to their stable feed row. */
export async function writeAuthenticatedAiChatMessage(
  request: AiChatRequest,
  senderId: string,
  user: AuthenticatedAiChatUser,
  dependencies: AiChatWriteDependencies = {
    create: createServerAiChatMessage,
    upsert: upsertServerAiChatMessage,
  },
): Promise<{ id: string; isIdempotent: boolean }> {
  const message = createAuthenticatedAiChatMessage(request, senderId, user);

  if (request.launchId) {
    const id = createAgentLaunchPromptMessageId({
      launchId: request.launchId,
      projectId: request.projectId,
      userId: senderId,
    });

    await dependencies.upsert(request.projectId, id, message);
    return { id, isIdempotent: true };
  }

  const id = await dependencies.create(request.projectId, message);
  return { id, isIdempotent: false };
}
