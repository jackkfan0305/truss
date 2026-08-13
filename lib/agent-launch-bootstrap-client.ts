import {
  AGENT_LAUNCH_PATH,
  AGENT_LAUNCH_QUERY_KEY,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import {
  captureAgentLaunch,
  type AgentLaunchStorage,
} from "@/lib/agent-launch-browser";
import { AGENT_LAUNCH_PENDING_FRAGMENT_KEY } from "@/lib/agent-launch-bootstrap";

export function hasPendingAgentLaunchFragment(
  pathname: string,
  storage: AgentLaunchStorage,
): boolean {
  return (
    pathname === AGENT_LAUNCH_PATH &&
    storage.getItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY) !== null
  );
}

/**
 * The bootstrap retains only an opaque, bounded fragment. Canonical decoding
 * and validation stay in captureAgentLaunch so this handoff cannot drift from
 * the persisted launch contract.
 */
export function consumePendingAgentLaunch(
  storage: AgentLaunchStorage,
  scrubFragment: () => void,
): AgentLaunchRecord | null {
  const fragment = storage.getItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY);

  if (fragment === null) {
    return null;
  }

  try {
    return captureAgentLaunch(fragment, null, storage, scrubFragment);
  } finally {
    storage.removeItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY);
  }
}

export function agentLaunchResumePath(record: AgentLaunchRecord): string {
  return `${AGENT_LAUNCH_PATH}?${AGENT_LAUNCH_QUERY_KEY}=${record.launchId}`;
}
