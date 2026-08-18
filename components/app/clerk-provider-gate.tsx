"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import { useLayoutEffect, useReducer, useSyncExternalStore } from "react";

import {
  consumePendingAgentEntry,
  getAgentLaunchSessionStorage,
  hasPendingAgentLaunchFragment,
} from "@/lib/agent-launch-bootstrap-client";

interface ClerkProviderGateProps {
  children: React.ReactNode;
}

interface AgentLaunchHydrationGateProps {
  children: React.ReactNode;
  renderClerk: (children: React.ReactNode) => React.ReactNode;
}

const clerkAppearance = {
  theme: dark,
  variables: {
    colorBackground: "var(--bg-elevated)",
    colorForeground: "var(--text-primary)",
    colorMuted: "var(--bg-subtle)",
    colorMutedForeground: "var(--text-secondary)",
    colorNeutral: "var(--text-primary)",
    colorPrimary: "var(--accent-primary)",
    colorPrimaryForeground: "var(--bg-base)",
    colorInput: "var(--bg-subtle)",
    colorInputForeground: "var(--text-primary)",
    colorBorder: "var(--border-default)",
    colorRing: "var(--accent-primary)",
    colorDanger: "var(--state-error)",
    colorSuccess: "var(--state-success)",
    colorWarning: "var(--state-warning)",
    fontFamily: "var(--font-geist-sans)",
    fontFamilyMono: "var(--font-geist-mono)",
  },
};

function AgentLaunchCaptureStatus(): React.ReactNode {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6 py-12">
      <section
        className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6"
        role="status"
      >
        <p className="text-sm text-copy-secondary">Preparing your diagram request.</p>
      </section>
    </main>
  );
}

function AppBootstrapStatus(): React.ReactNode {
  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6 py-12">
      <section
        className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6"
        role="status"
      >
        <p className="text-sm text-copy-secondary">Loading Truss.</p>
      </section>
    </main>
  );
}

function subscribeAfterHydration(listener: () => void): () => void {
  queueMicrotask(listener);
  return () => undefined;
}

interface AgentLaunchGateSnapshot {
  hasHydrated: boolean;
  hasPendingLaunch: boolean;
}

const SERVER_GATE_SNAPSHOT: AgentLaunchGateSnapshot = {
  hasHydrated: false,
  hasPendingLaunch: false,
};
const READY_GATE_SNAPSHOT: AgentLaunchGateSnapshot = {
  hasHydrated: true,
  hasPendingLaunch: false,
};
const PENDING_GATE_SNAPSHOT: AgentLaunchGateSnapshot = {
  hasHydrated: true,
  hasPendingLaunch: true,
};

function getAgentLaunchGateSnapshot(): AgentLaunchGateSnapshot {
  if (typeof window === "undefined") {
    return READY_GATE_SNAPSHOT;
  }

  const storage = getAgentLaunchSessionStorage(
    window.location.pathname,
    () => window.sessionStorage,
  );

  return storage && hasPendingAgentLaunchFragment(window.location.pathname, storage)
    ? PENDING_GATE_SNAPSHOT
    : READY_GATE_SNAPSHOT;
}

/**
 * Clerk initializes before route children and can redirect a document request.
 * Capture the bounded launch fragment before mounting it, then reload at the
 * fixed opaque resume route where Clerk can safely take over.
 */
export function AgentLaunchHydrationGate({
  children,
  renderClerk,
}: AgentLaunchHydrationGateProps): React.ReactNode {
  const snapshot = useSyncExternalStore(
    subscribeAfterHydration,
    getAgentLaunchGateSnapshot,
    () => SERVER_GATE_SNAPSHOT,
  );
  const [hasFinishedCapture, finishCapture] = useReducer(
    () => true,
    undefined,
    () => false,
  );
  const shouldCaptureLaunch =
    snapshot.hasHydrated && snapshot.hasPendingLaunch && !hasFinishedCapture;

  useLayoutEffect(() => {
    if (!shouldCaptureLaunch) {
      return;
    }

    const storage = getAgentLaunchSessionStorage(
      window.location.pathname,
      () => window.sessionStorage,
    );
    if (storage === null) {
      finishCapture();
      return;
    }

    // Scrub back to the current entry path, whichever one this is — hard-coding
    // the launch path here would rewrite a pick capture onto /agent/new.
    const resumePath = consumePendingAgentEntry(
      window.location.pathname,
      storage,
      () => {
        window.history.replaceState(
          window.history.state,
          "",
          window.location.pathname,
        );
      },
    );

    if (resumePath) {
      window.location.replace(resumePath);
      return;
    }

    finishCapture();
  }, [shouldCaptureLaunch]);

  if (!snapshot.hasHydrated) {
    return <AppBootstrapStatus />;
  }

  if (shouldCaptureLaunch) {
    return <AgentLaunchCaptureStatus />;
  }

  return renderClerk(children);
}

export function ClerkProviderGate({ children }: ClerkProviderGateProps): React.ReactNode {
  return (
    <AgentLaunchHydrationGate
      renderClerk={(content) => (
        <ClerkProvider appearance={clerkAppearance}>{content}</ClerkProvider>
      )}
    >
      {children}
    </AgentLaunchHydrationGate>
  );
}
