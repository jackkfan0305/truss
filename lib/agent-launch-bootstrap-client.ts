import {
  AGENT_LAUNCH_PATH,
  AGENT_LAUNCH_QUERY_KEY,
  type AgentLaunchRecord,
} from "@/lib/agent-launch";
import {
  captureAgentLaunch,
  type AgentLaunchStorage,
} from "@/lib/agent-launch-browser";
import { agentEntryPendingFragmentKey } from "@/lib/agent-launch-bootstrap";
import { AGENT_PICK_PATH } from "@/lib/agent-pick";
import { agentPickResumePath, captureAgentPick } from "@/lib/agent-pick-browser";

/**
 * Privacy settings may make even the `sessionStorage` property getter throw.
 * Check the exact capture routes first so ordinary routes never access storage.
 */
export function getAgentLaunchSessionStorage(
  pathname: string,
  getStorage: () => AgentLaunchStorage,
): AgentLaunchStorage | null {
  if (agentEntryPendingFragmentKey(pathname) === null) {
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
  const key = agentEntryPendingFragmentKey(pathname);

  if (key === null) {
    return false;
  }

  try {
    return storage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * The bootstrap retains only an opaque, bounded fragment. Canonical decoding and
 * validation stay in the per-path capture functions, so this handoff cannot
 * drift from either persisted contract.
 *
 * Returns the path to reload at, or `null` when there was nothing usable.
 *
 * Dispatching on pathname here rather than in the gate is what keeps the two
 * payload types apart: each path reads only its own storage key and hands the
 * fragment only to its own validator, so a launch fragment can never be decoded
 * as a pick or the reverse.
 */
export function consumePendingAgentEntry(
  pathname: string,
  storage: AgentLaunchStorage,
  scrubFragment: () => void,
): string | null {
  const key = agentEntryPendingFragmentKey(pathname);

  if (key === null) {
    return null;
  }

  let fragment: string | null;

  try {
    fragment = storage.getItem(key);
  } catch {
    return null;
  }

  if (fragment === null) {
    return null;
  }

  try {
    if (pathname === AGENT_LAUNCH_PATH) {
      const captured = captureAgentLaunch(fragment, null, storage, scrubFragment);

      return captured ? agentLaunchResumePath(captured) : null;
    }

    if (pathname === AGENT_PICK_PATH) {
      const captured = captureAgentPick(fragment, null, storage, scrubFragment);

      return captured ? agentPickResumePath(captured.pickId) : null;
    }

    return null;
  } catch {
    return null;
  } finally {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be blocked by privacy settings. The gate must fail open.
    }
  }
}

export function agentLaunchResumePath(record: AgentLaunchRecord): string {
  return `${AGENT_LAUNCH_PATH}?${AGENT_LAUNCH_QUERY_KEY}=${record.launchId}`;
}
