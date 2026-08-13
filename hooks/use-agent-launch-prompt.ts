"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AGENT_LAUNCH_QUERY_KEY,
  agentLaunchStorageKey,
  parseAgentLaunchRecord,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import { runAgentLaunchPrompt, startAgentLaunchPromptOnce } from "@/lib/agent-launch-runner";
import type { AiPromptSubmit } from "@/hooks/use-ai-prompt-submission";

export interface UseAgentLaunchPromptInput {
  launchId?: string;
  roomId: string;
  canStart: boolean;
  submit: AiPromptSubmit;
}

export interface AgentLaunchPromptState {
  error: string | null;
  retry: () => void;
}

const UNKNOWN_LAUNCH_FAILURE = "We couldn't start diagram generation. Please try again.";

function readLaunch(launchId: string): AgentLaunchRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  return parseAgentLaunchRecord(
    window.sessionStorage.getItem(agentLaunchStorageKey(launchId)),
  );
}

function initialLaunchError(launchId: string | undefined, roomId: string): string | null {
  if (!launchId) {
    return null;
  }

  const record = readLaunch(launchId);
  return record?.projectId === roomId && record.stage === "failed"
    ? record.error ?? UNKNOWN_LAUNCH_FAILURE
    : null;
}

function scrubLaunchQuery(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(AGENT_LAUNCH_QUERY_KEY);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Starts a captured launch only after the mounted Liveblocks room reports that
 * chat can send. Failed records remain visible for an explicit retry.
 */
export function useAgentLaunchPrompt({
  launchId,
  roomId,
  canStart,
  submit,
}: UseAgentLaunchPromptInput): AgentLaunchPromptState {
  const [error, setError] = useState(() => initialLaunchError(launchId, roomId));

  const operation = useCallback(async () => {
    if (!launchId || !canStart) {
      return { status: "ignored" as const };
    }

    return runAgentLaunchPrompt({
      launchId,
      roomId,
      dependencies: {
        load: () => readLaunch(launchId),
        save: (record) => {
          window.sessionStorage.setItem(
            agentLaunchStorageKey(record.launchId),
            JSON.stringify(record),
          );
        },
        remove: () => window.sessionStorage.removeItem(agentLaunchStorageKey(launchId)),
        submit,
        scrubQuery: scrubLaunchQuery,
      },
    });
  }, [canStart, launchId, roomId, submit]);

  const settle = useCallback((result: Awaited<ReturnType<typeof operation>>) => {
    setError(result.status === "failed" ? result.message : null);
  }, []);

  useEffect(() => {
    if (!launchId || !canStart || readLaunch(launchId)?.stage === "failed") {
      return;
    }

    let cancelled = false;
    void startAgentLaunchPromptOnce(launchId, operation)
      .then((result) => {
        if (!cancelled) {
          settle(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(UNKNOWN_LAUNCH_FAILURE);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canStart, launchId, operation, settle]);

  const retry = useCallback(() => {
    if (!launchId || !canStart) {
      return;
    }

    setError(null);
    void startAgentLaunchPromptOnce(launchId, operation)
      .then(settle)
      .catch(() => setError(UNKNOWN_LAUNCH_FAILURE));
  }, [canStart, launchId, operation, settle]);

  return { error, retry };
}
