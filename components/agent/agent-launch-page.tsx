"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import {
  AGENT_LAUNCH_PATH,
  AGENT_LAUNCH_QUERY_KEY,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import {
  captureAgentLaunch,
  createAgentLaunchProject,
  startAgentLaunchProjectOnce,
} from "@/lib/agent-launch-browser";
import { createRoomIdSuffix } from "@/lib/room-id";

interface AgentLaunchPageProps {
  resumeLaunchId: string | null;
}

interface AgentLaunchStatusProps {
  record: AgentLaunchRecord | null;
  onRetry: () => void;
}

function openAgentLaunchProject(
  router: Pick<ReturnType<typeof useRouter>, "replace">,
  record: AgentLaunchRecord,
): void {
  if (record.projectId) {
    router.replace(`/editor/${record.projectId}?launch=${record.launchId}`);
  }
}

function statusMessage(record: AgentLaunchRecord): string {
  switch (record.stage) {
    case "captured":
      return "Preparing your diagram request.";
    case "creating-project":
      return "Creating your project.";
    case "project-created":
      return "Opening your project.";
    default:
      return "Preparing your diagram request.";
  }
}

export function AgentLaunchStatus({
  record,
  onRetry,
}: AgentLaunchStatusProps): React.ReactNode {
  if (!record) {
    return (
      <section className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6" role="alert">
        <p className="text-sm text-copy-secondary">
          We couldn&apos;t find that diagram request. Start again from the agent.
        </p>
      </section>
    );
  }

  if (record.stage === "failed") {
    return (
      <section className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6" role="alert">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-copy-muted">
          Diagram request
        </p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-copy-primary">
          {record.title}
        </h1>
        <p className="mt-3 text-sm text-copy-secondary">
          {record.error ?? "We couldn&apos;t continue this diagram request."}
        </p>
        <button
          className="mt-5 rounded-xl border border-surface-border bg-elevated px-3 py-2 text-sm font-medium text-copy-primary transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          onClick={onRetry}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="w-full max-w-md rounded-2xl border border-surface-border bg-surface p-6" role="status">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-copy-muted">
        Diagram request
      </p>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-copy-primary">
        {record.title}
      </h1>
      <p className="mt-3 text-sm text-copy-secondary">{statusMessage(record)}</p>
    </section>
  );
}

export function AgentLaunchPage({ resumeLaunchId }: AgentLaunchPageProps): React.ReactNode {
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const router = useRouter();
  const [record, setRecord] = useState<AgentLaunchRecord | null>(null);
  const isRedirecting = useRef(false);

  useEffect(() => {
    const captured = captureAgentLaunch(
      window.location.hash,
      resumeLaunchId,
      window.sessionStorage,
      () => {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      },
    );

    if (captured) {
      queueMicrotask(() => {
        setRecord(captured);
      });
    }
  }, [resumeLaunchId]);

  const createProject = useCallback((launch: AgentLaunchRecord): void => {
    startAgentLaunchProjectOnce(launch.launchId, () =>
      createAgentLaunchProject(launch, {
        fetch: window.fetch.bind(window),
        createSuffix: createRoomIdSuffix,
        storage: window.sessionStorage,
      }),
    ).then((result) => {
      setRecord(result);
      if (result.stage === "project-created") {
        openAgentLaunchProject(router, result);
      }
    });
  }, [router]);

  useEffect(() => {
    if (!record || !isLoaded) {
      return;
    }

    if (!isSignedIn) {
      if (!isRedirecting.current) {
        isRedirecting.current = true;
        void clerk.redirectToSignIn({
          redirectUrl: `${AGENT_LAUNCH_PATH}?${AGENT_LAUNCH_QUERY_KEY}=${record.launchId}`,
        });
      }
      return;
    }

    if (record.stage === "project-created" && record.projectId) {
      // The persisted session record arrives asynchronously and is invisible to
      // the server, so this resume path has no user event or server redirect.
      openAgentLaunchProject(router, record);
      return;
    }

    if (record.stage === "captured" || record.stage === "creating-project") {
      createProject(record);
    }
  }, [clerk, createProject, isLoaded, isSignedIn, record, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-6 py-12">
      <AgentLaunchStatus
        record={record}
        onRetry={() => {
          if (record?.stage === "failed") {
            createProject(record);
          }
        }}
      />
    </main>
  );
}
