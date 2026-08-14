import type { Metadata } from "next";

import { AgentPickPage } from "@/components/agent/agent-pick-page";
import { isAgentPickId } from "@/lib/agent-pick";

interface AgentPickRouteProps {
  searchParams: Promise<{ pick?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Working with your agent | Truss",
  description: "Truss is running an agent-requested diagram edit or delete.",
};

export default async function AgentPickRoute({
  searchParams,
}: AgentPickRouteProps): Promise<React.ReactNode> {
  const rawPickId = (await searchParams).pick;
  const resumePickId = isAgentPickId(rawPickId) ? rawPickId : null;

  return <AgentPickPage resumePickId={resumePickId} />;
}
