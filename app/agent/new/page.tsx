import type { Metadata } from "next";

import { AgentLaunchPage } from "@/components/agent/agent-launch-page";
import { isAgentLaunchId } from "@/lib/agent-launch";

interface AgentNewPageProps {
  searchParams: Promise<{ launch?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Preparing your diagram | Truss",
  description: "Truss is preparing an agent-requested system design workspace.",
};

export default async function AgentNewPage({
  searchParams,
}: AgentNewPageProps): Promise<React.ReactNode> {
  const rawLaunchId = (await searchParams).launch;
  const resumeLaunchId = isAgentLaunchId(rawLaunchId) ? rawLaunchId : null;

  return <AgentLaunchPage resumeLaunchId={resumeLaunchId} />;
}
