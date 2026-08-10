import { mutateFlow } from "@liveblocks/react-flow/node";
import { logger } from "@trigger.dev/sdk";

import { selectAiChatMessages, type ChatMessage } from "@/lib/ai-chat";
import { selectDesignChatHistory } from "@/lib/canvas-context";
import type { DesignContext } from "@/lib/design-plan";
import { getLiveblocks } from "@/lib/liveblocks";
import { AI_CHAT_FEED_ID } from "@/types/tasks";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * The two reads every AI task starts with (35-orchestrator-backend).
 *
 * Node-only — it holds the Liveblocks secret and the Trigger logger — so the
 * pure prompt modules stay importable by the verify scripts. Shared because the
 * orchestrator, the design agent and the spec writer all open a turn the same
 * way, and a per-task copy is three places to forget the failure rule.
 */

/**
 * Reads the diagram without changing it. `mutateFlow` is the read path as well
 * as the write path: it is the only thing that knows how `@liveblocks/react-flow`
 * lays nodes and edges out in Storage, and a callback that mutates nothing
 * flushes nothing.
 */
export async function readCanvas(roomId: string): Promise<DesignContext> {
  let context: DesignContext = { nodes: [], edges: [] };

  await mutateFlow<CanvasNode, CanvasEdge>(
    { client: getLiveblocks(), roomId },
    (flow) => {
      context = flow.toJSON();
    }
  );

  return context;
}

/**
 * The room's chat transcript, so a run can see the turns before it.
 *
 * Read from the shared feed rather than taken from the request payload: the feed
 * is the authoritative record every client already renders, it includes what
 * *other* collaborators asked for, and it cannot be forged by whoever posted the
 * prompt. `selectAiChatMessages` is the same validator the sidebar reads it with.
 *
 * Never throws. A run that cannot fetch history is a run with less context, not
 * a failed one — the work it was asked for is still the work.
 *
 * `chatRunId` is the run that owns the turn's assistant row, which under the
 * orchestrator is the parent rather than the reader's own run.
 */
export async function readChatHistory(
  roomId: string,
  promptMessageId: string,
  chatRunId: string,
): Promise<ChatMessage[]> {
  try {
    const { data } = await getLiveblocks().getFeedMessages({
      roomId,
      feedId: AI_CHAT_FEED_ID,
    });

    return selectDesignChatHistory(
      selectAiChatMessages(data),
      promptMessageId,
      chatRunId,
    );
  } catch (error: unknown) {
    logger.warn("Chat history unavailable; continuing without it", {
      roomId,
      error: error instanceof Error ? error.message : String(error),
    });

    return [];
  }
}
