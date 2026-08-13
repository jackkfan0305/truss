import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AccessDenied } from "@/components/editor/access-denied";
import { EditorShell } from "@/components/editor/editor-shell";
import { isAgentLaunchId } from "@/lib/agent-launch";
import { getAccessibleProject, getCurrentIdentity } from "@/lib/project-access";
import { getOwnedProjects, getSharedProjects } from "@/lib/projects";

export const metadata: Metadata = {
  title: "Truss Editor",
  description: "Collaborative system design workspace.",
};

// `roomId` is the project ID and the future Liveblocks room ID — one identifier
// (see the architecture decisions in context/progress-tracker.md).
interface EditorRoomPageProps {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ launch?: string | string[] }>;
}

export default async function EditorRoomPage({
  params,
  searchParams,
}: EditorRoomPageProps) {
  const [{ roomId }, query, identity] = await Promise.all([
    params,
    searchParams,
    getCurrentIdentity(),
  ]);
  const launchId = isAgentLaunchId(query.launch) ? query.launch : undefined;

  // proxy.ts already gates this route; this is the resource-level backstop Clerk
  // recommends, and it narrows `identity` for the queries below.
  if (!identity) {
    redirect(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL as string);
  }

  // The access check runs alongside the sidebar lists rather than before them:
  // the denied path is the rare one, and serialising would add a round trip to
  // every successful load.
  const [activeProject, ownedProjects, sharedProjects] = await Promise.all([
    getAccessibleProject(roomId, identity),
    getOwnedProjects(identity.userId),
    getSharedProjects(identity),
  ]);

  // Unknown project and inaccessible project are the same answer on purpose.
  if (!activeProject) {
    return <AccessDenied />;
  }

  return (
    <EditorShell
      ownedProjects={ownedProjects}
      sharedProjects={sharedProjects}
      activeProject={activeProject}
      launchId={launchId}
    />
  );
}
