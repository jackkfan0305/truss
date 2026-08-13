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

/**
 * Privacy settings may make even the `sessionStorage` property getter throw.
 * Check the exact capture route first so ordinary routes never access storage.
 */
export function getAgentLaunchSessionStorage(
  pathname: string,
  getStorage: () => AgentLaunchStorage,
): AgentLaunchStorage | null {
  if (pathname !== AGENT_LAUNCH_PATH) {
    return null;
  }

  try {
    return getStorage();
  } catch {
    return null;
  }
}

export function hasPendingAgentLaunchFragment(
  pathname: string,
  storage: AgentLaunchStorage,
): boolean {
  if (pathname !== AGENT_LAUNCH_PATH) {
    return false;
  }

  try {
    return storage.getItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY) !== null;
  } catch {
    return false;
  }
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
  let fragment: string | null;

  try {
    fragment = storage.getItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY);
  } catch {
    return null;
  }

  if (fragment === null) {
    return null;
  }

  try {
    return captureAgentLaunch(fragment, null, storage, scrubFragment);
  } catch {
    return null;
  } finally {
    try {
      storage.removeItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY);
    } catch {
      // Storage can be blocked by privacy settings. The gate must fail open.
    }
  }
}

export function agentLaunchResumePath(record: AgentLaunchRecord): string {
  return `${AGENT_LAUNCH_PATH}?${AGENT_LAUNCH_QUERY_KEY}=${record.launchId}`;
}
