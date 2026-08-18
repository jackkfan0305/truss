import type { Metadata } from "next";

import { AgentLinkPage } from "@/components/agent/agent-link-page";
import { isAgentLinkId } from "@/lib/agent-link";

interface AgentLinkRouteProps {
  searchParams: Promise<{ link?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Linking your agent | Truss",
  description: "Truss is linking your CLI agent to your account.",
};

export default async function AgentLinkRoute({
  searchParams,
}: AgentLinkRouteProps): Promise<React.ReactNode> {
  const rawLinkId = (await searchParams).link;
  const resumeLinkId = isAgentLinkId(rawLinkId) ? rawLinkId : null;

  return <AgentLinkPage resumeLinkId={resumeLinkId} />;
}
