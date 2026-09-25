"use client";

import { useCallback, useReducer, useRef, useState } from "react";

import {
  readAiRunStream,
  reduceAiRunTurns,
  type AiRunTurn,
} from "@/lib/ai-run-turns";
import type { AiDesignModelId, AiThinkingLevel } from "@/types/tasks";

/**
 * Starting an agent turn and following it to the end
 * (26-ai-chat-functional, 35-orchestrator-backend).
 *
 * `/api/ai/orchestrate` runs the turn and streams its activity back in the
 * response; this reads that stream to the end and settles the turn. It never
 * touches the canvas: the agent writes nodes and edges into the same
 * Liveblocks Storage the canvas already renders from, so the diagram updates on
 * its own — here and in every other client in the room. Manually applying the
 * result would be a second, racing copy of that path.
 *
 * Which agent runs is not this hook's business. It posts the prompt to the
 * orchestrator, which reads the message and decides whether to answer, edit the
 * canvas, or write a spec.
 */

/** A started run. The ID comes from the API, never the client. */
export interface RunSubscription {
  runId: string;
}

/** The composer's per-prompt run settings. */
export interface AgentRunOptions {
  modelId: AiDesignModelId;
  thinkingLevel: AiThinkingLevel;
}

export interface AgentRun {
  /** Starts a turn for `prompt`. Resolves once it is *started*, not finished. */
  start: (
    prompt: string,
    promptMessageId: string,
    options: AgentRunOptions
  ) => Promise<RunSubscription>;
  /** True from the request leaving the client until the run settles. */
  isRunning: boolean;
  /**
   * Prompt-anchored run history for this mounted session. Settled turns store
   * their final work log here.
   */
  turns: AiRunTurn[];
}

/**
 * @param roomId The room to design into — also the project ID (lib/room-id.ts).
 */
export function useAgentRun(roomId: string): AgentRun {
  const [isRunning, setIsRunning] = useState(false);
  const [storedTurns, dispatchTurn] = useReducer(reduceAiRunTurns, []);
  const startLock = useRef(false);

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
      setIsRunning(true);
      dispatchTurn({ type: "start", promptMessageId, startedAt: Date.now() });

      let started: { runId: string; body: ReadableStream<Uint8Array> };

      try {
        started = await startAgent(prompt, promptMessageId, roomId, options);
      } catch (error: unknown) {
        startLock.current = false;
        setIsRunning(false);
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
      }

      const { runId, body } = started;

      dispatchTurn({ type: "subscribe", promptMessageId, runId });

      // Not awaited: `start` resolves once the run has started, and the
      // composer stays locked until the stream ends.
      void readAiRunStream(body).then(({ phase, activity }) => {
        startLock.current = false;
        setIsRunning(false);
        dispatchTurn({
          type: "settle",
          runId,
          phase,
          activity,
          completedAt: Date.now(),
        });
      });

      return { runId };
    },
    [roomId]
  );

  return { start, isRunning, turns: storedTurns };
}

async function startAgent(
  prompt: string,
  promptMessageId: string,
  roomId: string,
  options: AgentRunOptions
): Promise<{ runId: string; body: ReadableStream<Uint8Array> }> {
  // `projectId` and `roomId` are the same value; the route rejects the request
  // unless both are present and agree, so both are sent.
  const response = await fetch("/api/ai/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      promptMessageId,
      roomId,
      projectId: roomId,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
    }),
  });

  if (!response.ok) {
    // Every route failure answers `{ error }`, but a proxy or crash can still
    // return non-JSON — hence the fallback.
    const payload: unknown = await response.json().catch(() => null);

    throw new Error(readErrorMessage(payload) ?? `Request failed (${response.status})`);
  }

  const runId = response.headers.get("X-Run-Id");

  if (!runId || !response.body) {
    throw new Error("The agent response had no run stream");
  }

  return { runId, body: response.body };
}

function readErrorMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const { error } = payload as Record<string, unknown>;

  return typeof error === "string" && error.length > 0 ? error : null;
}
