import { logger, streams } from "@trigger.dev/sdk";

import {
  AI_ACTIVITY_STREAM_ID,
  type AiActivityPart,
  type AiActivityTerminalPart,
} from "@/types/tasks";

/**
 * The run's live activity, as a stream the sidebar subscribes to.
 *
 * A `ReadableStream` handed to `streams.pipe` rather than a chain of
 * `streams.append` calls: phases, summaries, and operations can be enqueued
 * synchronously while the pipe batches transport in the background.
 *
 * Shared by the orchestrator and the design agent (35-orchestrator-backend).
 * Only the client that started the run reads it, over its run-scoped token; the
 * shared, durable work log is the Liveblocks chat row, which is why nothing here
 * is allowed to fail a run.
 *
 * A `triggerAndWait` checkpoint can suspend the orchestrator and resume it
 * elsewhere, which this connection does not survive. That is tolerable and not
 * worked around: the browser settles its composer from the run's own completion
 * plus a grace window (`DesignRunObserver`), and the durable row is repaired by
 * the next full snapshot.
 */
export function openActivityStream(onActivity: (part: AiActivityPart) => void) {
  let controller!: ReadableStreamDefaultController<
    AiActivityPart | AiActivityTerminalPart
  >;
  let isWritable = true;
  let didClose = false;
  let didLogTransportError = false;

  const { waitUntilComplete } = streams.pipe(
    AI_ACTIVITY_STREAM_ID,
    new ReadableStream<AiActivityPart | AiActivityTerminalPart>({
      start: (streamController) => {
        controller = streamController;
      },
    })
  );

  return {
    // Never throws: activity is commentary, and a closed stream must not be
    // able to fail the canvas write that is the actual work.
    emit: (part: AiActivityPart | AiActivityTerminalPart): void => {
      if (part.type !== "terminal") {
        onActivity(part);
      }

      if (!isWritable) {
        return;
      }

      try {
        controller.enqueue(part);
      } catch (error: unknown) {
        isWritable = false;
        logActivityTransportError(error);
      }
    },
    close: async (): Promise<void> => {
      if (didClose) {
        return;
      }

      didClose = true;
      isWritable = false;

      try {
        controller.close();
      } catch (error: unknown) {
        logActivityTransportError(error);
      }

      try {
        await waitUntilComplete();
      } catch (error: unknown) {
        logActivityTransportError(error);
      }
    },
  };

  function logActivityTransportError(error: unknown): void {
    if (didLogTransportError) {
      return;
    }

    didLogTransportError = true;
    logger.warn("AI activity stream transport failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** `openActivityStream`'s emitter, as much of it as a phase needs. */
export type ActivityEmitter = {
  emit: (part: AiActivityPart | AiActivityTerminalPart) => void;
};
