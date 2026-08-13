import {
  AGENT_LAUNCH_PATH,
  MAX_AGENT_LAUNCH_FRAGMENT_LENGTH,
} from "@/lib/agent-launch";

export const AGENT_LAUNCH_PENDING_FRAGMENT_KEY = "truss.agent-launch.pending-fragment";

/**
 * Runs before Clerk's client bundle. A URL fragment never reaches the server,
 * so the browser must retain a validated copy before any auth redirect can
 * replace the document URL.
 */
export function agentLaunchBootstrapScript(): string {
  return `(()=>{const p=${JSON.stringify(AGENT_LAUNCH_PATH)},k=${JSON.stringify(AGENT_LAUNCH_PENDING_FRAGMENT_KEY)},h=location.hash;if(location.pathname!==p||h.length<2)return;const f=h.slice(1);if(f.length>${MAX_AGENT_LAUNCH_FRAGMENT_LENGTH}||!/^[A-Za-z0-9_-]+$/.test(f))return;try{sessionStorage.setItem(k,h);history.replaceState(history.state,"",location.pathname+location.search)}catch{}})();`;
}
