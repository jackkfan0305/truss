import {
  AGENT_LINK_PATH,
  AGENT_LINK_QUERY_KEY,
  agentLinkStorageKey,
  parseAgentLinkFragment,
  type AgentLinkPayloadV1,
} from "@/lib/agent-link";

// Same shape as `PickStorage` in lib/agent-pick-browser.ts — only the two
// members this module calls, so a test can pass a minimal fake.
export type LinkStorage = Pick<Storage, "getItem" | "setItem">;

export interface AgentLinkDependencies {
  fetch: typeof fetch;
}

export type AgentLinkResult = { kind: "linked" } | { kind: "failed"; message: string };

export interface RedirectGuard {
  current: boolean;
}

// Contract default: `POST /api/agent/tokens` label defaults to "Truss agent"
// server-side too, but sending it explicitly keeps the two humans reading
// the flow (browser and server) looking at the same literal.
const DEFAULT_AGENT_LINK_LABEL = "Truss agent";

const inFlightLinkOperations = new Map<string, Promise<AgentLinkResult>>();

// ponytail: mirrors the private `runOnce` in agent-pick-browser.ts, which
// isn't exported. Duplicating this ~10-line generic beats adding a shared
// third module for one helper neither file's owner asked for.
function runOnce<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = operation();
  inFlight.set(key, promise);
  void promise
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      inFlight.delete(key);
    });

  return promise;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function agentLinkResumePath(linkId: string): string {
  return `${AGENT_LINK_PATH}?${AGENT_LINK_QUERY_KEY}=${linkId}`;
}

/**
 * Captures the one-shot link fragment before Clerk's sign-in redirect can
 * discard it, and scrubs it from the URL. Mirrors `captureAgentPick` in
 * lib/agent-pick-browser.ts exactly — resume re-decodes the same raw
 * fragment from session storage rather than persisting a separate record
 * shape, so `parseAgentLinkFragment` stays the single source of truth for
 * what a valid payload looks like, on capture and on resume alike.
 */
export function captureAgentLink(
  hash: string,
  resumeLinkId: string | null,
  storage: LinkStorage,
  scrubFragment: () => void,
): AgentLinkPayloadV1 | null {
  const payload = parseAgentLinkFragment(hash);

  if (payload) {
    scrubFragment();
    try {
      storage.setItem(agentLinkStorageKey(payload.linkId), hash);
    } catch {
      // Storage can be blocked by quota limits or privacy settings. The
      // fragment is already out of the URL and the payload is already
      // decoded in memory for this call, so a failed resume-copy write is
      // non-fatal: the caller proceeds with `payload`, it just won't survive
      // a sign-in redirect round trip.
    }
    return payload;
  }

  return resumeLinkId ? getStoredAgentLink(resumeLinkId, storage) : null;
}

export function getStoredAgentLink(
  linkId: string,
  storage: LinkStorage,
): AgentLinkPayloadV1 | null {
  let raw: string | null;

  try {
    raw = storage.getItem(agentLinkStorageKey(linkId));
  } catch {
    return null;
  }

  if (raw === null) {
    return null;
  }

  const payload = parseAgentLinkFragment(raw);
  return payload && payload.linkId === linkId ? payload : null;
}

/**
 * Redirects to sign-in exactly once per mount. The guard lives in the
 * caller so React Strict Mode's double effect invocation — or any other
 * unrelated re-render — cannot fire a second navigation. Mirrors
 * `redirectToSignInOnce` in lib/agent-pick-browser.ts.
 */
export function redirectToSignInOnce(
  guard: RedirectGuard,
  linkId: string,
  redirectToSignIn: (options: { redirectUrl: string }) => void | Promise<unknown>,
): void {
  if (guard.current) {
    return;
  }

  guard.current = true;
  void redirectToSignIn({ redirectUrl: agentLinkResumePath(linkId) });
}

export function startAgentLinkOperationOnce(
  linkId: string,
  operation: () => Promise<AgentLinkResult>,
): Promise<AgentLinkResult> {
  return runOnce(inFlightLinkOperations, linkId, operation);
}

/**
 * Mints an agent token from the browser's own same-origin session (the
 * request carries the Clerk session cookie automatically — no bearer is
 * ever sent here, matching the contract's "a token must not be able to
 * mint another" rule) and hands it to the CLI's loopback listener.
 *
 * The plaintext token exists only as this function's local `token` binding
 * between the mint response and the loopback POST — it is never written to
 * sessionStorage, the URL, the document, or logged. The mint route returns
 * it exactly once; this is the only place in the browser that ever sees it.
 */
export async function runAgentLinkOperation(
  payload: AgentLinkPayloadV1,
  dependencies: AgentLinkDependencies,
): Promise<AgentLinkResult> {
  try {
    const mintResponse = await dependencies.fetch("/api/agent/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: DEFAULT_AGENT_LINK_LABEL }),
    });

    if (mintResponse.status !== 201) {
      return {
        kind: "failed",
        message: "We couldn't create your agent token. Please try again.",
      };
    }

    const minted: unknown = await mintResponse.json();
    const token = isRecord(minted) && typeof minted.token === "string" ? minted.token : null;

    if (!token) {
      return {
        kind: "failed",
        message: "We couldn't create your agent token. Please try again.",
      };
    }

    const callbackResponse = await dependencies.fetch(`http://127.0.0.1:${payload.port}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce: payload.nonce, token }),
    });

    return callbackResponse.ok
      ? { kind: "linked" }
      : { kind: "failed", message: "We couldn't reach your agent. Please try again." };
  } catch {
    return { kind: "failed", message: "We couldn't reach your agent. Please try again." };
  }
}
