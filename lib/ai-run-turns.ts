import type { AiTimelinePart } from "@/lib/ai-timeline";

export type AiRunTurnPhase = "starting" | "running" | "complete" | "error";

/** A run-scoped activity transcript retained only for this mounted session. */
export interface AiRunTurn {
  promptMessageId: string;
  runId: string | null;
  phase: AiRunTurnPhase;
  activity: AiTimelinePart[];
  startedAt: number;
  completedAt?: number;
}

export type AiRunTurnEvent =
  | {
      type: "start";
      promptMessageId: string;
      startedAt: number;
    }
  | {
      type: "subscribe";
      promptMessageId: string;
      runId: string;
    }
  | {
      type: "settle";
      runId: string;
      phase: "complete" | "error";
      activity: AiTimelinePart[];
      completedAt: number;
    }
  | {
      type: "start-error";
      promptMessageId: string;
      activity: AiTimelinePart[];
      completedAt: number;
    };

/** Pure state transition used by the realtime hook and its verification. */
export function reduceAiRunTurns(
  turns: readonly AiRunTurn[],
  event: AiRunTurnEvent
): AiRunTurn[] {
  switch (event.type) {
    case "start":
      return [
        ...turns,
        {
          promptMessageId: event.promptMessageId,
          runId: null,
          phase: "starting",
          activity: [],
          startedAt: event.startedAt,
        },
      ];
    case "subscribe":
      return turns.map((turn) =>
        turn.promptMessageId === event.promptMessageId
          ? { ...turn, runId: event.runId, phase: "running" }
          : turn
      );
    case "settle":
      return turns.map((turn) =>
        turn.runId === event.runId
          ? {
              ...turn,
              phase: event.phase,
              activity: event.activity,
              completedAt: event.completedAt,
            }
          : turn
      );
    case "start-error":
      return turns.map((turn) =>
        turn.promptMessageId === event.promptMessageId
          ? {
              ...turn,
              phase: "error",
              activity: event.activity,
              completedAt: event.completedAt,
            }
          : turn
      );
  }
}
