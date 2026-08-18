import { currentUser } from "@clerk/nextjs/server";

import {
  parseAiChatRequest,
} from "@/lib/ai-chat-requests";
import { writeAuthenticatedAiChatMessage } from "@/lib/agent-launch-server";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";

export {
  createAuthenticatedAiChatMessage,
  writeAuthenticatedAiChatMessage,
  type AuthenticatedAiChatUser,
  type AiChatWriteDependencies,
} from "@/lib/agent-launch-server";

/** Authenticated, server-authored user chat prevents feed identity spoofing. */
export async function POST(request: Request): Promise<Response> {
  const chatRequest = parseAiChatRequest(await readJsonBody(request));

  if (!chatRequest) {
    return jsonError("A projectId and message are required", 400);
  }

  const access = await authorizeProject(request, chatRequest.projectId, {
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
    const result = await writeAuthenticatedAiChatMessage(
      chatRequest,
      access.userId,
      user,
    );

    return Response.json(
      { id: result.id },
      { status: result.isIdempotent ? 200 : 201 },
    );
  } catch (error: unknown) {
    console.error(`AI chat write failed for ${chatRequest.projectId}`, error);
    return jsonError("Message not sent", 502);
  }
}
