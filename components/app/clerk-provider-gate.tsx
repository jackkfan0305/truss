"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/ui/themes";
import { useLayoutEffect, useSyncExternalStore } from "react";

import {
  AGENT_LAUNCH_PATH,
  AGENT_LAUNCH_QUERY_KEY,
} from "@/lib/agent-launch";
import { captureAgentLaunch } from "@/lib/agent-launch-browser";
import { AGENT_LAUNCH_PENDING_FRAGMENT_KEY } from "@/lib/agent-launch-bootstrap";

interface ClerkProviderGateProps {
  children: React.ReactNode;
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

function subscribeToBootstrapRecord(): () => void {
  return () => undefined;
}

function hasPendingAgentLaunchRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    window.location.pathname === AGENT_LAUNCH_PATH &&
    window.sessionStorage.getItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY) !== null
  );
}

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

/**
 * Clerk initializes before route children and can redirect a document request.
 * Capture a valid launch fragment before mounting it, then reload at the
 * fixed opaque resume route where Clerk can safely take over.
 */
export function ClerkProviderGate({ children }: ClerkProviderGateProps): React.ReactNode {
  const isCapturingLaunch = useSyncExternalStore(
    subscribeToBootstrapRecord,
    hasPendingAgentLaunchRecord,
    () => false,
  );

  useLayoutEffect(() => {
    if (!isCapturingLaunch) {
      return;
    }

    const pendingFragment = window.sessionStorage.getItem(
      AGENT_LAUNCH_PENDING_FRAGMENT_KEY,
    );
    const fragment = window.location.hash || pendingFragment || "";

    const captured = captureAgentLaunch(
      fragment,
      null,
      window.sessionStorage,
      () => {
        window.history.replaceState(window.history.state, "", AGENT_LAUNCH_PATH);
      },
    );
    window.sessionStorage.removeItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY);

    if (captured) {
      window.location.replace(
        `${AGENT_LAUNCH_PATH}?${AGENT_LAUNCH_QUERY_KEY}=${captured.launchId}`,
      );
    }
  }, [isCapturingLaunch]);

  if (isCapturingLaunch) {
    return <AgentLaunchCaptureStatus />;
  }

  return <ClerkProvider appearance={clerkAppearance}>{children}</ClerkProvider>;
}
