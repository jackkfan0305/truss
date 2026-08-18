"use client";

import { Button } from "@/components/ui/button";
import { useAgentLaunchImport } from "@/hooks/use-agent-launch-import";

export function AgentLaunchImportController({
  launchId,
  roomId,
}: {
  launchId?: string;
  roomId: string;
}) {
  const { error, isImporting, retry } = useAgentLaunchImport({
    launchId,
    roomId,
    canStart: true,
  });

  return (
    <>
      {isImporting ? <AgentLaunchImportProgress /> : null}
      {error ? <AgentLaunchImportFailure message={error} onRetry={retry} /> : null}
    </>
  );
}

export function AgentLaunchImportProgress() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-surface-border bg-surface/90 px-3 py-1 text-xs text-copy-secondary shadow-lg"
    >
      Importing diagram…
    </div>
  );
}

export function AgentLaunchImportFailure({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="absolute inset-x-4 top-20 z-30 mx-auto flex max-w-md items-center justify-between gap-3 border border-surface-border bg-surface px-3 py-2 text-xs text-copy-primary shadow-lg"
    >
      <span>{message}</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-2 text-xs text-copy-secondary hover:bg-elevated hover:text-copy-primary"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}
