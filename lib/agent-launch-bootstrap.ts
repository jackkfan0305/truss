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
  return `(()=>{const p=${JSON.stringify(AGENT_LAUNCH_PATH)},k=${JSON.stringify(AGENT_LAUNCH_PENDING_FRAGMENT_KEY)},h=location.hash;if(location.pathname!==p||h.length<2)return;const f=h.slice(1);if(f.length>${MAX_AGENT_LAUNCH_FRAGMENT_LENGTH}||!/^[A-Za-z0-9_-]+$/.test(f))return;try{const n=f.replace(/-/g,"+").replace(/_/g,"/"),b=atob(n.padEnd(Math.ceil(n.length/4)*4,"=")),v=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(b,c=>c.charCodeAt(0))));if(!v||Array.isArray(v)||v.version!==1||typeof v.launchId!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v.launchId)||typeof v.title!=="string"||!v.title.trim()||v.title.trim().length>120||typeof v.description!=="string"||!v.description.trim()||v.description.trim().length>2000)return;sessionStorage.setItem(k,h);history.replaceState(history.state,"",location.pathname+location.search)}catch{}})();`;
}
