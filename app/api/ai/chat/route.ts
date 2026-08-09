import { currentUser } from "@clerk/nextjs/server";

import { parseAiChatRequest } from "@/lib/ai-chat-requests";
import { createServerAiChatMessage } from "@/lib/ai-chat-server";
import { authorizeProject } from "@/lib/project-access";
import { jsonError, readJsonBody } from "@/lib/project-requests";

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
    const senderName = (
      user.fullName?.trim() ||
      user.username?.trim() ||
      user.primaryEmailAddress?.emailAddress ||
      "Anonymous"
    ).slice(0, 120);
    const id = await createServerAiChatMessage(chatRequest.projectId, {
      role: "user",
      senderId: access.userId,
      senderName,
      // Snapshotted, not looked up at render time: the transcript should show
      // who wrote a line, not who that account is today. Browsers never supply
      // this — `parseAiChatRequest` carries no identity fields at all.
      senderAvatar: user.imageUrl,
      content: chatRequest.content,
      sentAt: Date.now(),
    });

    return Response.json({ id }, { status: 201 });
  } catch (error: unknown) {
    console.error(`AI chat write failed for ${chatRequest.projectId}`, error);
    return jsonError("Message not sent", 502);
  }
}
