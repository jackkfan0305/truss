"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";

import {
  captureAgentLink,
  redirectToSignInOnce,
  runAgentLinkOperation,
  startAgentLinkOperationOnce,
  type AgentLinkResult,
  type LinkStorage,
  type RedirectGuard,
} from "@/lib/agent-link-browser";
import type { AgentLinkPayloadV1 } from "@/lib/agent-link";

interface AgentLinkPageProps {
  resumeLinkId: string | null;
}

type LinkOperationState =
  | { kind: "working" }
  | { kind: "awaiting-sign-in" }
  | { kind: "linked" }
  | { kind: "failed"; message: string; onRetry: () => void };

export type AgentLinkViewState = LinkOperationState | { kind: "not-found" };

// Same card/label/button strings as components/agent/agent-pick-page.tsx,
// verbatim, so the two one-time agent entry pages read as one visual family.
const cardClassName =
  "w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6";
const labelClassName = "font-mono text-xs uppercase tracking-[0.18em] text-copy-muted";
const secondaryButtonClassName =
  "rounded-xl border border-surface-border bg-elevated px-3 py-2 text-sm font-medium text-copy-primary transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function AgentLinkStatus({ state }: { state: AgentLinkViewState }): React.ReactNode {
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
        <p className={labelClassName}>Link agent</p>
        <p className="mt-3 text-sm text-copy-secondary">{state.message}</p>
        <button className={`mt-5 ${secondaryButtonClassName}`} onClick={state.onRetry} type="button">
          Retry
        </button>
      </section>
    );
  }

  if (state.kind === "linked") {
    return (
      <section className={cardClassName} role="status">
        <p className="text-sm text-copy-secondary">
          Truss is linked — you can close this tab.
        </p>
      </section>
    );
  }

  return (
    <section className={cardClassName} role="status">
      <p className={labelClassName}>Link agent</p>
      <p className="mt-3 text-sm text-copy-secondary">
        {state.kind === "awaiting-sign-in" ? "Redirecting you to sign in…" : "Linking your agent…"}
      </p>
    </section>
  );
}

export function AgentLinkPage({ resumeLinkId }: AgentLinkPageProps): React.ReactNode {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const [payload, setPayload] = useState<AgentLinkPayloadV1 | null>(null);
  const [state, setState] = useState<LinkOperationState>({ kind: "working" });
  const isRedirecting = useRef<RedirectGuard>({ current: false });
  const hasStartedLinkId = useRef<string | null>(null);
  // Retry's closure calls back into `runOperation` before that declaration
  // has a stable identity for the closure created inside it — genuinely
  // self-referential, same as agent-pick-page.tsx's `runOperationRef`. A ref
  // indirection breaks the ordering cycle without losing the latest closure.
  const runOperationRef = useRef<(current: AgentLinkPayloadV1) => void>(() => undefined);

  useEffect(() => {
    let storage: LinkStorage | null = null;

    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }

    const captured = storage
      ? captureAgentLink(window.location.hash, resumeLinkId, storage, () => {
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
  }, [resumeLinkId]);

  const runOperation = useCallback((current: AgentLinkPayloadV1): void => {
    setState({ kind: "working" });
    startAgentLinkOperationOnce(current.linkId, () =>
      runAgentLinkOperation(current, { fetch: window.fetch.bind(window) }),
    ).then((result: AgentLinkResult) => {
      setState(
        result.kind === "linked"
          ? { kind: "linked" }
          : {
              kind: "failed",
              message: result.message,
              onRetry: () => runOperationRef.current(current),
            },
      );
    });
  }, []);

  useEffect(() => {
    runOperationRef.current = runOperation;
  }, [runOperation]);

  useEffect(() => {
    if (!payload || !isLoaded) {
      return;
    }

    if (!isSignedIn) {
      // No setState here: "awaiting-sign-in" is derived in `viewState` below
      // rather than stored, so this effect only performs the one real side
      // effect (the redirect) instead of also scheduling a render.
      redirectToSignInOnce(isRedirecting.current, payload.linkId, (options) =>
        clerk.redirectToSignIn(options),
      );
      return;
    }

    // Guards the *automatic* start only — Retry calls `runOperation`
    // directly, and re-running that is the point of Retry.
    if (hasStartedLinkId.current === payload.linkId) {
      return;
    }
    hasStartedLinkId.current = payload.linkId;
    runOperation(payload);
  }, [clerk, isLoaded, isSignedIn, payload, runOperation]);

  // "awaiting-sign-in" is derived rather than stored: it is exactly the
  // condition "we have a payload, auth has resolved, and it says signed
  // out" — storing it as its own state slice would require a setState call
  // inside the auth effect for a value the render already has everything
  // needed to compute.
  const viewState: AgentLinkViewState =
    payload === null
      ? { kind: "not-found" }
      : isLoaded && !isSignedIn
        ? { kind: "awaiting-sign-in" }
        : state;

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6 py-12">
      <AgentLinkStatus state={viewState} />
    </main>
  );
}
