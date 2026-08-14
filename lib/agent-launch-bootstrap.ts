import {
  AGENT_LAUNCH_PATH,
  MAX_AGENT_LAUNCH_FRAGMENT_LENGTH,
} from "@/lib/agent-launch";
import { AGENT_PICK_PATH, MAX_AGENT_PICK_FRAGMENT_LENGTH } from "@/lib/agent-pick";

export const AGENT_LAUNCH_PENDING_FRAGMENT_KEY = "truss.agent-launch.pending-fragment";
export const AGENT_PICK_PENDING_FRAGMENT_KEY = "truss.agent-pick.pending-fragment";

/**
 * Each agent entry path and the bounded fragment it may retain.
 *
 * The keys are per path, not shared. A launch fragment and a pick fragment are
 * different payload types with different schemas, and a single key would let a
 * stale one be consumed as the other — resuming a create as an edit, or worse.
 * Separate keys make that impossible rather than merely unlikely.
 */
const AGENT_ENTRY_BOOTSTRAPS = [
  {
    path: AGENT_LAUNCH_PATH,
    key: AGENT_LAUNCH_PENDING_FRAGMENT_KEY,
    max: MAX_AGENT_LAUNCH_FRAGMENT_LENGTH,
  },
  {
    path: AGENT_PICK_PATH,
    key: AGENT_PICK_PENDING_FRAGMENT_KEY,
    max: MAX_AGENT_PICK_FRAGMENT_LENGTH,
  },
] as const;

export function agentEntryPendingFragmentKey(pathname: string): string | null {
  return (
    AGENT_ENTRY_BOOTSTRAPS.find((entry) => entry.path === pathname)?.key ?? null
  );
}

/**
 * Runs before Clerk's client bundle. A URL fragment never reaches the server,
 * so the browser must retain a validated copy before any auth redirect can
 * replace the document URL.
 *
 * Covers both entry paths. `/agent/pick` needs this exactly as much as
 * `/agent/new` does: its callers are usually signed out, which is precisely the
 * case where Clerk redirects the document and takes the fragment with it.
 */
export function agentLaunchBootstrapScript(): string {
  const entries = JSON.stringify(
    Object.fromEntries(
      AGENT_ENTRY_BOOTSTRAPS.map((entry) => [entry.path, [entry.key, entry.max]]),
    ),
  );

  return `(()=>{const m=${entries},h=location.hash,e=m[location.pathname];if(!e||h.length<2)return;const f=h.slice(1);if(f.length>e[1]||!/^[A-Za-z0-9_-]+$/.test(f))return;try{try{sessionStorage.setItem(e[0],h)}finally{history.replaceState(history.state,"",location.pathname+location.search)}}catch{}})();`;
}
