import { MAX_CHAT_CONTENT_LENGTH } from "@/types/tasks";

export interface AiChatRequest {
  projectId: string;
  content: string;
}

/** Pure parser for the authenticated chat write route. */
export function parseAiChatRequest(body: unknown): AiChatRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const { projectId: rawProjectId, content: rawContent } = body as Record<
    string,
    unknown
  >;
  const projectId =
    typeof rawProjectId === "string" ? rawProjectId.trim() : "";
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!projectId || !content || content.length > MAX_CHAT_CONTENT_LENGTH) {
    return null;
  }

  return { projectId, content };
}
