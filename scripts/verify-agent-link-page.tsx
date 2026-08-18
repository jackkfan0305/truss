import assert from "node:assert/strict";

// proxy.ts throws at import time if these are unset (see its own comment on
// why: an unset value would silently protect every route, sign-in page
// included). Set them before the dynamic `import("../proxy")` below, same as
// scripts/verify-agent-launch-page.tsx does.
process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ??= "/sign-in";
process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ??= "/sign-up";

import { renderToStaticMarkup } from "react-dom/server";

import { AgentLinkStatus } from "../components/agent/agent-link-page";
import {
  agentLinkResumePath,
  captureAgentLink,
  getStoredAgentLink,
  redirectToSignInOnce,
  runAgentLinkOperation,
  startAgentLinkOperationOnce,
  type AgentLinkResult,
  type RedirectGuard,
} from "../lib/agent-link-browser";
import {
  AGENT_LINK_PATH,
  AGENT_LINK_QUERY_KEY,
  MAX_AGENT_LINK_FRAGMENT_LENGTH,
  agentLinkStorageKey,
  parseAgentLinkFragment,
} from "../lib/agent-link";

const linkId = "00000000-0000-4a00-8000-000000000020";
const nonce = "00000000-0000-4a00-8000-000000000021";
const payload = {
  version: 1 as const,
  linkId,
  port: 51235,
  nonce,
};

function encodeFragment(payload: unknown): string {
  return `#${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function createStorage(events: string[] = []): FakeStorage {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      events.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      events.push(`set:${key}`);
      values.set(key, value);
    },
  };
}

// Fragment parse accept/reject: bad version, bad uuid, out-of-range port,
// oversize fragment must all be rejected rather than repaired.
function checkFragmentParseAcceptsAndRejects(): void {
  const valid = encodeFragment(payload);
  assert.deepEqual(parseAgentLinkFragment(valid), payload);

  assert.equal(
    parseAgentLinkFragment(encodeFragment({ ...payload, version: 2 })),
    null,
    "wrong version is rejected",
  );
  assert.equal(
    parseAgentLinkFragment(encodeFragment({ ...payload, linkId: "not-a-uuid" })),
    null,
    "malformed linkId is rejected",
  );
  assert.equal(
    parseAgentLinkFragment(encodeFragment({ ...payload, nonce: "not-a-uuid" })),
    null,
    "malformed nonce is rejected",
  );
  assert.equal(
    parseAgentLinkFragment(encodeFragment({ ...payload, port: 80 })),
    null,
    "a port below 1024 is rejected",
  );
  assert.equal(
    parseAgentLinkFragment(encodeFragment({ ...payload, port: 70_000 })),
    null,
    "a port above 65535 is rejected",
  );
  assert.equal(
    parseAgentLinkFragment(encodeFragment({ ...payload, extra: "field" })),
    null,
    "an unknown key is rejected (strictObject)",
  );

  const oversize = `#${"A".repeat(MAX_AGENT_LINK_FRAGMENT_LENGTH + 1)}`;
  assert.equal(parseAgentLinkFragment(oversize), null, "an oversize fragment is rejected");
}

function checkCaptureWritesToStorageAndScrubsUrl(): void {
  const fragment = encodeFragment(payload);
  const events: string[] = [];
  const storage = createStorage(events);
  let scrubCalls = 0;

  const captured = captureAgentLink(fragment, null, storage, () => {
    scrubCalls += 1;
  });

  assert.deepEqual(captured, payload);
  assert.equal(scrubCalls, 1, "a valid fragment scrubs the URL exactly once");
  assert.deepEqual(events, [`set:${agentLinkStorageKey(linkId)}`]);

  const resumed = getStoredAgentLink(linkId, storage);
  assert.deepEqual(resumed, payload, "resume via ?link= re-decodes the same stored fragment");

  const mismatchedResume = getStoredAgentLink("00000000-0000-4a00-8000-000000000099", storage);
  assert.equal(mismatchedResume, null, "a resume id must match the stored payload's linkId");
}

// A quota/privacy-mode throw from storage.setItem must not escape
// captureAgentLink into the caller's React effect — fail open.
function checkCaptureSurvivesStorageWriteFailure(): void {
  const fragment = encodeFragment(payload);
  const throwingStorage: FakeStorage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  let scrubCalls = 0;

  const captured = captureAgentLink(fragment, null, throwingStorage, () => {
    scrubCalls += 1;
  });

  assert.deepEqual(
    captured,
    payload,
    "a storage write failure must not stop the decoded payload from being returned",
  );
  assert.equal(scrubCalls, 1, "the URL is still scrubbed even when the resume copy can't persist");

  // getItem throwing must also fail open (null), never throw.
  const throwingGet: FakeStorage = {
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => undefined,
  };
  assert.equal(getStoredAgentLink(linkId, throwingGet), null);
}

function checkMissingOrMalformedFragmentRendersNotFound(): void {
  const events: string[] = [];
  const storage = createStorage(events);

  assert.equal(
    captureAgentLink("", null, storage, () => undefined),
    null,
    "no fragment and no resume id is not found",
  );
  assert.equal(
    captureAgentLink("#not-a-valid-link-payload", null, storage, () => undefined),
    null,
    "a malformed fragment is not found",
  );
  assert.deepEqual(events, [], "a rejected fragment is neither scrubbed nor stored");

  const markup = renderToStaticMarkup(<AgentLinkStatus state={{ kind: "not-found" }} />);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /couldn&#x27;t find that request/);
}

function checkRedirectToSignInFiresExactlyOnce(): void {
  const guard: RedirectGuard = { current: false };
  const calls: Array<{ redirectUrl: string }> = [];

  // Simulates React Strict Mode's double effect invocation with the same
  // guard instance — must only redirect once.
  redirectToSignInOnce(guard, linkId, (options) => {
    calls.push(options);
  });
  redirectToSignInOnce(guard, linkId, (options) => {
    calls.push(options);
  });

  assert.equal(calls.length, 1, "redirectToSignIn is called exactly once");
  assert.deepEqual(calls[0], {
    redirectUrl: `${AGENT_LINK_PATH}?${AGENT_LINK_QUERY_KEY}=${linkId}`,
  });
  assert.equal(calls[0].redirectUrl, agentLinkResumePath(linkId));
}

interface Call {
  input: string;
  method: string;
  body?: string;
}

function fakeFetch(
  calls: Call[],
  handler: (input: string, init: RequestInit | undefined) => Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      input: String(input),
      method,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return handler(String(input), init);
  }) as typeof fetch;
}

async function checkSuccessfulMintPostsTokenToLoopbackOnly(): Promise<void> {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls, (input) => {
    if (input === "/api/agent/tokens") {
      return Response.json(
        { token: "trs_agent_super-secret-value", label: "Truss agent" },
        { status: 201 },
      );
    }
    if (input === `http://127.0.0.1:${payload.port}/`) {
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const result = await runAgentLinkOperation(payload, { fetch: fetchImpl });
  assert.deepEqual(result, { kind: "linked" });

  assert.deepEqual(calls.map((call) => call.input), [
    "/api/agent/tokens",
    `http://127.0.0.1:${payload.port}/`,
  ]);

  const mintBody = JSON.parse(calls[0].body ?? "{}");
  assert.deepEqual(mintBody, { label: "Truss agent" }, "the mint request never carries a token");

  const loopbackBody = JSON.parse(calls[1].body ?? "{}");
  assert.deepEqual(
    loopbackBody,
    { nonce, token: "trs_agent_super-secret-value" },
    "the loopback body carries exactly nonce and token",
  );
}

// The token must never reach storage: the operation takes no storage
// dependency at all, so a spy on the only storage in scope must observe zero
// writes across a full successful run.
async function checkTokenNeverReachesStorage(): Promise<void> {
  const storageEvents: string[] = [];
  const storage = createStorage(storageEvents);
  const fetchImpl = fakeFetch([], (input) => {
    if (input === "/api/agent/tokens") {
      return Response.json({ token: "trs_agent_do-not-store-me" }, { status: 201 });
    }
    return Response.json({ ok: true });
  });

  await runAgentLinkOperation(payload, { fetch: fetchImpl });

  assert.deepEqual(storageEvents, [], "runAgentLinkOperation must never touch storage");
  assert.equal(storage.getItem("anything"), null);

  // Also never appears in any rendered status markup.
  for (const state of [
    { kind: "working" as const },
    { kind: "awaiting-sign-in" as const },
    { kind: "linked" as const },
    { kind: "failed" as const, message: "x", onRetry: () => undefined },
  ]) {
    const markup = renderToStaticMarkup(<AgentLinkStatus state={state} />);
    assert.doesNotMatch(markup, /trs_agent_/, "the token must never render in status markup");
  }
}

async function checkNonMintSuccessYieldsFailedWithNoLoopbackPost(): Promise<void> {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls, (input) => {
    if (input === "/api/agent/tokens") {
      return new Response(null, { status: 401 });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const result = await runAgentLinkOperation(payload, { fetch: fetchImpl });
  assert.equal(result.kind, "failed");
  assert.equal(
    calls.some((call) => call.input.startsWith("http://127.0.0.1:")),
    false,
    "a non-201 mint response must never reach the loopback callback",
  );

  // A 201 with a missing/non-string token must also fail closed without a
  // loopback POST — the contract guarantees a token field, but a caller must
  // not trust an unvalidated body.
  const malformedCalls: Call[] = [];
  const malformedFetch = fakeFetch(malformedCalls, (input) => {
    if (input === "/api/agent/tokens") {
      return Response.json({ label: "Truss agent" }, { status: 201 });
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  const malformedResult = await runAgentLinkOperation(payload, { fetch: malformedFetch });
  assert.equal(malformedResult.kind, "failed");
  assert.equal(
    malformedCalls.some((call) => call.input.startsWith("http://127.0.0.1:")),
    false,
  );
}

async function checkLoopbackRejectionYieldsFailed(): Promise<void> {
  const fetchImpl = fakeFetch([], (input) => {
    if (input === "/api/agent/tokens") {
      return Response.json({ token: "trs_agent_x" }, { status: 201 });
    }
    return new Response(null, { status: 400 });
  });

  const result = await runAgentLinkOperation(payload, { fetch: fetchImpl });
  assert.equal(result.kind, "failed");
}

async function checkStrictModeDeduplication(): Promise<void> {
  let starts = 0;
  const operation = async (): Promise<AgentLinkResult> => {
    starts += 1;
    return { kind: "linked" };
  };

  const first = startAgentLinkOperationOnce(linkId, operation);
  const second = startAgentLinkOperationOnce(linkId, operation);
  assert.equal(first, second, "Strict Mode's double effect shares one in-flight operation");
  await Promise.all([first, second]);
  assert.equal(starts, 1, "the operation body runs exactly once despite two effect passes");

  const retry = startAgentLinkOperationOnce(linkId, operation);
  assert.notEqual(retry, first, "a settled operation leaves room for a later retry");
  await retry;
  assert.equal(starts, 2);
}

function checkStatusMarkup(): void {
  const working = renderToStaticMarkup(<AgentLinkStatus state={{ kind: "working" }} />);
  assert.match(working, /role="status"/);

  const awaitingSignIn = renderToStaticMarkup(
    <AgentLinkStatus state={{ kind: "awaiting-sign-in" }} />,
  );
  assert.match(awaitingSignIn, /role="status"/);
  assert.match(awaitingSignIn, /sign in/);

  const linked = renderToStaticMarkup(<AgentLinkStatus state={{ kind: "linked" }} />);
  assert.match(linked, /role="status"/);
  assert.match(linked, /linked/);

  const failed = renderToStaticMarkup(
    <AgentLinkStatus
      state={{ kind: "failed", message: "We couldn't reach your agent.", onRetry: () => undefined }}
    />,
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

  // Never render the nonce or the port.
  for (const markup of [working, awaitingSignIn, linked, failed]) {
    assert.doesNotMatch(markup, new RegExp(nonce));
    assert.doesNotMatch(markup, /51235/);
  }
}

async function checkProxyTreatsAgentLinkAsPublicAndHandshakeBypassed(): Promise<void> {
  const { isPublicPath, isClerkHandshakeBypassPath } = await import("../proxy");

  assert.equal(isPublicPath(AGENT_LINK_PATH), true, "/agent/link must be a public path");
  assert.equal(isPublicPath(`${AGENT_LINK_PATH}/extra`), false);
  assert.equal(isPublicPath("/editor"), false);
  assert.equal(isPublicPath("/api/projects"), false);

  assert.equal(
    isClerkHandshakeBypassPath(AGENT_LINK_PATH),
    true,
    "/agent/link must bypass the Clerk dev handshake or its fragment is lost on redirect",
  );
  assert.equal(isClerkHandshakeBypassPath(`${AGENT_LINK_PATH}/extra`), false);
  assert.equal(isClerkHandshakeBypassPath("/editor"), false);
  assert.equal(isClerkHandshakeBypassPath("/api/projects"), false);
}

async function main(): Promise<void> {
  checkFragmentParseAcceptsAndRejects();
  checkCaptureWritesToStorageAndScrubsUrl();
  checkCaptureSurvivesStorageWriteFailure();
  checkMissingOrMalformedFragmentRendersNotFound();
  checkRedirectToSignInFiresExactlyOnce();
  await checkSuccessfulMintPostsTokenToLoopbackOnly();
  await checkTokenNeverReachesStorage();
  await checkNonMintSuccessYieldsFailedWithNoLoopbackPost();
  await checkLoopbackRejectionYieldsFailed();
  await checkStrictModeDeduplication();
  checkStatusMarkup();
  await checkProxyTreatsAgentLinkAsPublicAndHandshakeBypassed();
  console.info("Agent link page checks passed");
}

main().catch((error: unknown) => {
  console.error("Agent link page verification failed");
  console.error(error);
  process.exitCode = 1;
});
