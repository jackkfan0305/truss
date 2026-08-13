import { isAgentLaunchId } from "@/lib/agent-launch";
import { MAX_CHAT_CONTENT_LENGTH } from "@/types/tasks";

export interface AiChatRequest {
  projectId: string;
  content: string;
  launchId: string | null;
}

/** Pure parser for the authenticated chat write route. */
export function parseAiChatRequest(body: unknown): AiChatRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const {
    projectId: rawProjectId,
    content: rawContent,
    launchId: rawLaunchId,
  } = body as Record<string, unknown>;
  const hasLaunchId = Object.prototype.hasOwnProperty.call(body, "launchId");
  const projectId =
    typeof rawProjectId === "string" ? rawProjectId.trim() : "";
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!projectId || !content || content.length > MAX_CHAT_CONTENT_LENGTH) {
    return null;
  }

  if (!hasLaunchId) {
    return { projectId, content, launchId: null };
  }

  if (!isAgentLaunchId(rawLaunchId)) {
    return null;
  }

  return { projectId, content, launchId: rawLaunchId };
}
