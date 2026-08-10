import type { AiTimelinePart } from "@/lib/ai-timeline";

export type AiRunTurnPhase = "starting" | "running" | "complete" | "error";

/** The two signals a live observer can settle a run on, and their arrival. */
export interface AiRunSettleSignals {
  /** The activity stream's terminal marker, once it has arrived. */
  terminalPhase: "complete" | "error" | null;
  /** The run record's outcome, once the realtime run subscription reports it. */
  runOutcome: "complete" | "error" | null;
  /** Whether the missing-marker grace period has elapsed. */
  didGraceElapse: boolean;
}

/**
 * Which signal settles a run, and with what phase. `null` means keep waiting.
 *
 * The stream's terminal marker is both the fast path and the authoritative one:
 * the worker emits it in its `finally` with the outcome already decided, so it
 * lands while the run record is still being finalized. Measured against this
 * project on three consecutive runs of 12s, 56s and 96s, the Trigger.dev run row
 * reached a terminal status a near-constant 27–30s *after* `run()` returned — so
 * requiring it left the composer locked for half a minute after the last node
 * was already on the canvas.
 *
 * The run record stays as the fallback, because a run that is hard-killed never
 * reaches its `finally` and so never emits a marker. That case has nothing else
 * to settle on, and a permanently locked composer is the worse failure.
 */
export function resolveAiRunPhase(
  signals: AiRunSettleSignals
): "complete" | "error" | null {
  if (signals.terminalPhase !== null) {
    return signals.terminalPhase;
  }

  return signals.didGraceElapse ? signals.runOutcome : null;
}

/** A run-scoped activity transcript retained only for this mounted session. */
export interface AiRunTurn {
  promptMessageId: string;
  runId: string | null;
  phase: AiRunTurnPhase;
  activity: AiTimelinePart[];
  startedAt: number;
  completedAt?: number;
}

/**
 * The step verb to show above the composer while a run is live, or `null`.
 *
 * Steps moved out of the work log and up here (38-live-step-status): they are
 * status, and status belongs next to the input it is disabling rather than
 * folded inside a per-turn disclosure that a reader has to open.
 *
 * `findLast` on both, because a turn can only be live if it is the newest one
 * and the current step is the newest step. A live turn with no step yet is
 * still worth announcing — the run exists, it just has not said anything.
 */
export function selectLiveRunStep(turns: readonly AiRunTurn[]): string | null {
  const live = turns.findLast(
    (turn) => turn.phase === "starting" || turn.phase === "running"
  );

  if (!live) {
    return null;
  }

  return live.activity.findLast((part) => part.type === "step")?.text ?? "Starting";
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
