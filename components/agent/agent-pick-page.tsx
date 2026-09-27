"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import {
  captureAgentPick,
  deleteAgentPickDiagram,
  redirectToSignInOnce,
  runAgentPickOperation,
  startAgentPickDeleteOnce,
  startAgentPickOperationOnce,
  type AgentPickResult,
  type PickStorage,
  type RedirectGuard,
} from "@/lib/agent-pick-browser";
import type { AgentPickPayloadV1 } from "@/lib/agent-pick";
import {
  AgentDoneStatus,
  agentCardClassName as cardClassName,
  agentDestructiveButtonClassName as destructiveButtonClassName,
  agentLabelClassName as labelClassName,
  agentSecondaryButtonClassName as secondaryButtonClassName,
} from "@/components/agent/agent-status";
import { TrussLoader } from "@/components/ui/truss-loader";

interface AgentPickPageProps {
  resumePickId: string | null;
}

type PickOperationState =
  | { kind: "working" }
  | { kind: "awaiting-agent" }
  | {
      kind: "confirm-delete";
      diagramName: string;
      onCancel: () => void;
      onDelete: () => void;
    }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string; onRetry: () => void };

export type AgentPickViewState = PickOperationState | { kind: "not-found" };


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
          {state.diagramName}
        </h1>
        <p className="mt-3 text-sm text-copy-secondary">
          Your agent asked to delete this diagram. This can&apos;t be undone.
        </p>
        <div className="mt-6 flex justify-end gap-2">
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
    return <AgentDoneStatus message={state.message} />;
  }

  return (
    <TrussLoader
      label={state.kind === "awaiting-agent" ? "Waiting for your agent" : "Preparing your request"}
    />
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
  const handleDeleteRef = useRef<(diagramId: string) => void>(() => undefined);
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

  const handleDelete = useCallback((diagramId: string): void => {
    setState({ kind: "working" });
    void startAgentPickDeleteOnce(diagramId, () =>
      deleteAgentPickDiagram(diagramId, { fetch: window.fetch.bind(window) }),
    ).then((outcome) => {
      setState(
        outcome === "done"
          ? { kind: "done", message: "Diagram deleted. You can close this tab." }
          : {
              kind: "failed",
              message: "We couldn't delete that diagram. Please try again.",
              onRetry: () => handleDeleteRef.current(diagramId),
            },
      );
    });
  }, []);

  const applyResult = useCallback(
    (result: AgentPickResult, retry: () => void): void => {
      if (result.kind === "redirect") {
        router.replace(`/editor/${result.diagramId}`);
        return;
      }

      if (result.kind === "confirm-delete") {
        setState({
          kind: "confirm-delete",
          diagramName: result.diagramName,
          onCancel: () =>
            setState({ kind: "done", message: "Cancelled. You can close this tab." }),
          onDelete: () => handleDelete(result.diagramId),
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
