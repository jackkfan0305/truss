"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import {
  captureAgentPick,
  deleteAgentPickProject,
  redirectToSignInOnce,
  runAgentPickOperation,
  startAgentPickDeleteOnce,
  startAgentPickOperationOnce,
  type AgentPickResult,
  type PickStorage,
  type RedirectGuard,
} from "@/lib/agent-pick-browser";
import type { AgentPickPayloadV1 } from "@/lib/agent-pick";

interface AgentPickPageProps {
  resumePickId: string | null;
}

type PickOperationState =
  | { kind: "working" }
  | { kind: "awaiting-agent" }
  | {
      kind: "confirm-delete";
      projectName: string;
      onCancel: () => void;
      onDelete: () => void;
    }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string; onRetry: () => void };

export type AgentPickViewState = PickOperationState | { kind: "not-found" };

const cardClassName =
  "w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6";
const labelClassName = "font-mono text-xs uppercase tracking-[0.18em] text-copy-muted";
const secondaryButtonClassName =
  "rounded-xl border border-surface-border bg-elevated px-3 py-2 text-sm font-medium text-copy-primary transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const destructiveButtonClassName =
  "rounded-xl border border-transparent bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function AgentPickStatus({ state }: { state: AgentPickViewState }): React.ReactNode {
  if (state.kind === "not-found") {
    return (
      <section className={cardClassName} role="alert">
        <p className="text-sm text-copy-secondary">
          We couldn&apos;t find that request. Start again from the agent.
        </p>
      </section>
    );
  }

  if (state.kind === "failed") {
    return (
      <section className={cardClassName} role="alert">
        <p className={labelClassName}>Diagram request</p>
        <p className="mt-3 text-sm text-copy-secondary">{state.message}</p>
        <button className={`mt-5 ${secondaryButtonClassName}`} onClick={state.onRetry} type="button">
          Retry
        </button>
      </section>
    );
  }

  if (state.kind === "confirm-delete") {
    return (
      <section className={cardClassName} role="alert">
        <p className={labelClassName}>Delete diagram</p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-copy-primary">
          {state.projectName}
        </h1>
        <p className="mt-3 text-sm text-copy-secondary">
          Your agent asked to delete this diagram. This can&apos;t be undone.
        </p>
        <div className="mt-5 flex gap-3">
          <button className={secondaryButtonClassName} onClick={state.onCancel} type="button">
            Cancel
          </button>
          <button className={destructiveButtonClassName} onClick={state.onDelete} type="button">
            Delete
          </button>
        </div>
      </section>
    );
  }

  if (state.kind === "done") {
    return (
      <section className={cardClassName} role="status">
        <p className="text-sm text-copy-secondary">{state.message}</p>
      </section>
    );
  }

  return (
    <section className={cardClassName} role="status">
      <p className={labelClassName}>Diagram request</p>
      <p className="mt-3 text-sm text-copy-secondary">
        {state.kind === "awaiting-agent" ? "Waiting for your agent…" : "Preparing your request."}
      </p>
    </section>
  );
}

export function AgentPickPage({ resumePickId }: AgentPickPageProps): React.ReactNode {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const router = useRouter();
  const [payload, setPayload] = useState<AgentPickPayloadV1 | null>(null);
  const [state, setState] = useState<PickOperationState>({ kind: "working" });
  const isRedirecting = useRef<RedirectGuard>({ current: false });
  const hasStartedPickId = useRef<string | null>(null);
  // `handleDelete`'s own retry closure calls back into `handleDelete` before
  // that declaration has a stable identity for the closure created inside
  // it, and `runOperation`'s retry closure calls back into `runOperation`
  // for the same reason — both are genuinely self-referential. A ref
  // indirection breaks that ordering cycle without losing the latest
  // closure — updated every render, read only from event handlers that run
  // after render completes.
  const handleDeleteRef = useRef<(projectId: string) => void>(() => undefined);
  const runOperationRef = useRef<(current: AgentPickPayloadV1) => void>(() => undefined);

  useEffect(() => {
    let storage: PickStorage | null = null;

    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }

    const captured = storage
      ? captureAgentPick(window.location.hash, resumePickId, storage, () => {
          window.history.replaceState(
            window.history.state,
            "",
            `${window.location.pathname}${window.location.search}`,
          );
        })
      : null;

    if (captured) {
      queueMicrotask(() => setPayload(captured));
    }
  }, [resumePickId]);

  const handleDelete = useCallback((projectId: string): void => {
    setState({ kind: "working" });
    void startAgentPickDeleteOnce(projectId, () =>
      deleteAgentPickProject(projectId, { fetch: window.fetch.bind(window) }),
    ).then((outcome) => {
      setState(
        outcome === "done"
          ? { kind: "done", message: "Diagram deleted. You can close this tab." }
          : {
              kind: "failed",
              message: "We couldn't delete that diagram. Please try again.",
              onRetry: () => handleDeleteRef.current(projectId),
            },
      );
    });
  }, []);

  const applyResult = useCallback(
    (result: AgentPickResult, retry: () => void): void => {
      if (result.kind === "redirect") {
        router.replace(`/editor/${result.projectId}`);
        return;
      }

      if (result.kind === "confirm-delete") {
        setState({
          kind: "confirm-delete",
          projectName: result.projectName,
          onCancel: () =>
            setState({ kind: "done", message: "Cancelled. You can close this tab." }),
          onDelete: () => handleDelete(result.projectId),
        });
        return;
      }

      setState({ kind: "failed", message: result.message, onRetry: retry });
    },
    [handleDelete, router],
  );

  const runOperation = useCallback(
    (current: AgentPickPayloadV1): void => {
      setState({ kind: "working" });
      startAgentPickOperationOnce(current.pickId, () =>
        runAgentPickOperation(current, {
          fetch: window.fetch.bind(window),
          onWaitingForAgent: () => setState({ kind: "awaiting-agent" }),
        }),
      ).then((result) => applyResult(result, () => runOperationRef.current(current)));
    },
    [applyResult],
  );

  useEffect(() => {
    handleDeleteRef.current = handleDelete;
    runOperationRef.current = runOperation;
  }, [handleDelete, runOperation]);

  useEffect(() => {
    if (!payload || !isLoaded) {
      return;
    }

    if (!isSignedIn) {
      redirectToSignInOnce(isRedirecting.current, payload.pickId, (options) =>
        clerk.redirectToSignIn(options),
      );
      return;
    }

    // Guards the *automatic* start only — Retry calls `runOperation`
    // directly, and re-running that is the point of Retry.
    if (hasStartedPickId.current === payload.pickId) {
      return;
    }
    hasStartedPickId.current = payload.pickId;
    runOperation(payload);
  }, [clerk, isLoaded, isSignedIn, payload, runOperation]);

  const viewState: AgentPickViewState = payload === null ? { kind: "not-found" } : state;

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6 py-12">
      <AgentPickStatus state={viewState} />
    </main>
  );
}
