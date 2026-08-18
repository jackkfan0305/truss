"use client";

import { useCallback, useReducer, useRef, useState } from "react";

import {
  reduceAiRunTurns,
  type AiRunTurn,
} from "@/lib/ai-run-turns";
import type { AiTimelinePart } from "@/lib/ai-timeline";
import type { AiDesignModelId, AiThinkingLevel } from "@/types/tasks";

/**
 * Starting an agent turn and following it to the end
 * (26-ai-chat-functional, 35-orchestrator-backend).
 *
 * This controller starts Trigger.dev runs; the keyed observer component owns
 * their realtime subscription. Neither touches the canvas: the agent writes
 * nodes and edges into the same
 * Liveblocks Storage the canvas already renders from, so the diagram updates on
 * its own — here and in every other client in the room. Manually applying the
 * result would be a second, racing copy of that path.
 *
 * Which agent runs is not this hook's business. It posts the prompt to the
 * orchestrator, which reads the message and decides whether to answer, edit the
 * canvas, or write a spec.
 */

/** A run plus the token that may read it. Both come from the API, never the client. */
export interface RunSubscription {
  runId: string;
  token: string;
}

export interface AgentRunSettlement {
  runId: string;
  phase: "complete" | "error";
  activity: AiTimelinePart[];
}

/** The composer's per-prompt run settings. */
export interface AgentRunOptions {
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
}

export interface AgentRun {
  /** Triggers a turn for `prompt`. Resolves once it is *started*, not finished. */
  start: (
    prompt: string,
    promptMessageId: string,
    options: AgentRunOptions
  ) => Promise<RunSubscription>;
  /** True from the request leaving the client until the run settles. */
  isRunning: boolean;
  /**
   * Prompt-anchored run history for this mounted session. The active observer
   * supplies its live activity; settled turns store their final work log here.
   */
  turns: AiRunTurn[];
  /** The one active run; a keyed observer owns its realtime hook lifecycle. */
  subscription: RunSubscription | null;
  /** Stores the observer's final activity and publishes its short room summary. */
  settle: (settlement: AgentRunSettlement) => void;
}

/**
 * @param roomId The room to design into — also the project ID (lib/room-id.ts).
 * @param onSettled Called once per run with the line to put on the chat feed.
 */
export function useAgentRun(roomId: string): AgentRun {
  const [subscription, setSubscription] = useState<RunSubscription | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [storedTurns, dispatchTurn] = useReducer(reduceAiRunTurns, []);
  const startLock = useRef(false);

  // A Set protects the shared room feed from duplicate completion lines if a
  // realtime transport reconnects around the terminal event.
  const reported = useRef(new Set<string>());

  const settle = useCallback((result: AgentRunSettlement) => {
    if (reported.current.has(result.runId)) {
      return;
    }

    reported.current.add(result.runId);
    startLock.current = false;
    dispatchTurn({
      type: "settle",
      runId: result.runId,
      phase: result.phase,
      activity: result.activity,
      completedAt: Date.now(),
    });
    setSubscription((current) =>
      current?.runId === result.runId ? null : current
    );
  }, []);

  const start = useCallback(
    async (
      prompt: string,
      promptMessageId: string,
      options: AgentRunOptions
    ): Promise<RunSubscription> => {
      if (startLock.current) {
        throw new Error("An agent run is already active");
      }

      startLock.current = true;
      setIsStarting(true);
      dispatchTurn({ type: "start", promptMessageId, startedAt: Date.now() });

      try {
        const nextSubscription = await triggerAgent(
          prompt,
          promptMessageId,
          roomId,
          options
        );

        dispatchTurn({
          type: "subscribe",
          promptMessageId,
          runId: nextSubscription.runId,
        });
        setSubscription(nextSubscription);
        return nextSubscription;
      } catch (error: unknown) {
        startLock.current = false;
        console.error("Design run failed to start", error);
        dispatchTurn({
          type: "start-error",
          promptMessageId,
          activity: [
            {
              id: "start-error",
              type: "step",
              text: "Could not start generation",
            },
          ],
          completedAt: Date.now(),
        });
        throw error;
      } finally {
        setIsStarting(false);
      }
    },
    [roomId]
  );

  return {
    start,
    // Covers the gap the run subscription cannot: the request is in flight
    // before there is a run ID to follow.
    isRunning: isStarting || subscription !== null,
    turns: storedTurns,
    subscription,
    settle,
  };
}

/**
 * Two calls, because the token is issued separately: `/api/ai/orchestrate`
 * answers with a run ID, and `/api/ai/orchestrate/token` trades that ID for a
 * token scoped to that one run. Splitting them is what keeps the token route's
 * ownership check meaningful, so it is not worth collapsing into one response.
 */
async function triggerAgent(
  prompt: string,
  promptMessageId: string,
  roomId: string,
  options: AgentRunOptions
): Promise<RunSubscription> {
  // `projectId` and `roomId` are the same value; the route rejects the request
  // unless both are present and agree, so both are sent.
  const { runId } = await postJson<{ runId: string }>("/api/ai/orchestrate", {
    prompt,
    promptMessageId,
    roomId,
    projectId: roomId,
    modelId: options.modelId,
    thinkingLevel: options.thinkingLevel,
  });

  const { token } = await postJson<{ token: string }>("/api/ai/orchestrate/token", {
    runId,
  });

  return { runId, token };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Every route failure answers `{ error }`, but a proxy or crash can still
    // return non-JSON — hence the fallback.
    const payload: unknown = await response.json().catch(() => null);

    throw new Error(readErrorMessage(payload) ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

function readErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { error } = payload as Record<string, unknown>;

  return typeof error === "string" && error.length > 0 ? error : null;
}
