import type { AiActivityPart, AiActivityTerminalPart } from "@/types/tasks";

/**
 * The run's live activity, fanned out to the durable chat row and to the
 * response stream the initiating browser reads.
 *
 * Shared by the orchestrator and the design agent (35-orchestrator-backend).
 * Only the client that started the run reads `write`'s output; the shared,
 * durable work log is the Liveblocks chat row, which is why nothing here is
 * allowed to fail a run. A tab that closes mid-run turns `write` into a throw,
 * and the run carries on for everyone else.
 */
export function openActivityStream(
  onActivity: (part: AiActivityPart) => void,
  write: (part: AiActivityPart | AiActivityTerminalPart) => void
) {
  let isWritable = true;

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
        write(part);
      } catch (error: unknown) {
        isWritable = false;
        console.warn("AI activity stream transport failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/** `openActivityStream`'s emitter, as much of it as a phase needs. */
export type ActivityEmitter = {
  emit: (part: AiActivityPart | AiActivityTerminalPart) => void;
};
