"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AGENT_LAUNCH_QUERY_KEY,
  agentLaunchStorageKey,
  parseAgentLaunchRecord,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import {
  runAgentLaunchImport,
  startAgentLaunchImportOnce,
  type AgentLaunchImportResult,
} from "@/lib/agent-launch-import-runner";

const UNKNOWN_IMPORT_FAILURE =
  "We couldn't import your diagram. Please try again.";

export interface UseAgentLaunchImportInput {
  launchId?: string;
  roomId: string;
  canStart: boolean;
}

export interface AgentLaunchImportState {
  error: string | null;
  isImporting: boolean;
  retry: () => void;
}

function readLaunch(launchId: string): AgentLaunchRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  // Accessing sessionStorage itself can throw in privacy-restricted contexts;
  // callers deliberately catch this and render only a generic retry state.
  return parseAgentLaunchRecord(
    window.sessionStorage.getItem(agentLaunchStorageKey(launchId)),
  );
}

function scrubLaunchQuery(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(AGENT_LAUNCH_QUERY_KEY);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function isImportable(record: AgentLaunchRecord | null, roomId: string): boolean {
  return Boolean(
    record?.projectId === roomId &&
      (record.stage === "project-created" || record.stage === "importing-graph"),
  );
}

/** Starts owner-only graph import after the authorized room is mounted. */
export function useAgentLaunchImport({
  launchId,
  roomId,
  canStart,
}: UseAgentLaunchImportInput): AgentLaunchImportState {
  const [error, setError] = useState<string | null>(() => {
    if (!launchId || !canStart) {
      return null;
    }

    try {
      const record = readLaunch(launchId);
      return record?.launchId === launchId &&
        record.projectId === roomId &&
        record.stage === "failed"
        ? UNKNOWN_IMPORT_FAILURE
        : null;
    } catch {
      return UNKNOWN_IMPORT_FAILURE;
    }
  });
  const [isImporting, setIsImporting] = useState(false);

  const operation = useCallback(async (): Promise<AgentLaunchImportResult> => {
    if (!launchId || !canStart) {
      return { status: "ignored" };
    }

    return runAgentLaunchImport({
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
        remove: () => {
          window.sessionStorage.removeItem(agentLaunchStorageKey(launchId));
        },
        importGraph: (projectId, record) =>
          window.fetch(`/api/projects/${projectId}/agent-launch-import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(record),
          }),
        scrubQuery: scrubLaunchQuery,
      },
    });
  }, [canStart, launchId, roomId]);

  const settle = useCallback((result: AgentLaunchImportResult) => {
    setIsImporting(false);
    setError(result.status === "failed" ? result.message : null);
  }, []);

  useEffect(() => {
    if (!launchId || !canStart) {
      return;
    }

    let storedRecord: AgentLaunchRecord | null;
    try {
      storedRecord = readLaunch(launchId);
    } catch {
      queueMicrotask(() => setError(UNKNOWN_IMPORT_FAILURE));
      return;
    }

    if (
      !storedRecord ||
      storedRecord.launchId !== launchId ||
      storedRecord.projectId !== roomId
    ) {
      return;
    }

    if (storedRecord.stage === "failed") {
      queueMicrotask(() => setError(UNKNOWN_IMPORT_FAILURE));
      return;
    }

    if (!isImportable(storedRecord, roomId)) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setIsImporting(true);
      }
    });
    void startAgentLaunchImportOnce(launchId, operation)
      .then((result) => {
        if (!cancelled) {
          settle(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsImporting(false);
          setError(UNKNOWN_IMPORT_FAILURE);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canStart, launchId, operation, roomId, settle]);

  const retry = useCallback(() => {
    if (!launchId || !canStart) {
      return;
    }

    setError(null);
    setIsImporting(true);
    void startAgentLaunchImportOnce(launchId, operation)
      .then(settle)
      .catch(() => {
        setIsImporting(false);
        setError(UNKNOWN_IMPORT_FAILURE);
      });
  }, [canStart, launchId, operation, settle]);

  return { error, isImporting, retry };
}
