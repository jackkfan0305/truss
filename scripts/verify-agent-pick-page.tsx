import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";

import { AgentPickStatus } from "../components/agent/agent-pick-page";
import {
  agentPickResumePath,
  captureAgentPick,
  deleteAgentPickProject,
  getStoredAgentPick,
  redirectToSignInOnce,
  runAgentPickOperation,
  startAgentPickDeleteOnce,
  startAgentPickOperationOnce,
  type AgentPickResult,
  type RedirectGuard,
} from "../lib/agent-pick-browser";
import {
  AGENT_PICK_PATH,
  AGENT_PICK_QUERY_KEY,
  agentPickStorageKey,
} from "../lib/agent-pick";

const pickId = "00000000-0000-4a00-8000-000000000010";
const nonce = "00000000-0000-4a00-8000-000000000011";
const editPayload = {
  version: 1 as const,
  pickId,
  op: "edit" as const,
  port: 51234,
  nonce,
};
const deletePayload = { ...editPayload, op: "delete" as const };

// Realistic extra fields a real /api/projects row carries beyond {id, name}.
// A minimal fixture can't catch a regression in the id/name-only filter
// because there is nothing extra to leak; deepEqual passes either way.
const enrichedProjectFields = {
  ownerId: "user_9f2a",
  description: "Payments checkout flow",
  createdAt: "2024-01-01T00:00:00.000Z",
  canvasJsonPath: "blob://checkout-canvas.json",
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

function checkCaptureWritesToStorageAndScrubsUrl(): void {
  const fragment = encodeFragment(editPayload);
  const events: string[] = [];
  const storage = createStorage(events);
  let scrubCalls = 0;

  const captured = captureAgentPick(fragment, null, storage, () => {
    scrubCalls += 1;
  });

  assert.deepEqual(captured, editPayload);
  assert.equal(scrubCalls, 1, "a valid fragment scrubs the URL exactly once");
  assert.deepEqual(events, [`set:${agentPickStorageKey(pickId)}`]);

  const resumed = getStoredAgentPick(pickId, storage);
  assert.deepEqual(resumed, editPayload, "resume re-decodes the same stored fragment");

  const mismatchedResume = getStoredAgentPick(
    "00000000-0000-4a00-8000-000000000099",
    storage,
  );
  assert.equal(mismatchedResume, null, "a resume id must match the stored payload's pickId");
}

// FIX 4: a quota/privacy-mode throw from storage.setItem must not escape
// captureAgentPick into the caller's React effect.
function checkCaptureSurvivesStorageWriteFailure(): void {
  const fragment = encodeFragment(editPayload);
  const throwingStorage: FakeStorage = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  };
  let scrubCalls = 0;

  const captured = captureAgentPick(fragment, null, throwingStorage, () => {
    scrubCalls += 1;
  });

  assert.deepEqual(
    captured,
    editPayload,
    "a storage write failure must not stop the decoded payload from being returned",
  );
  assert.equal(
    scrubCalls,
    1,
    "the URL is still scrubbed even when the resume copy can't be persisted",
  );
}

function checkMissingOrMalformedFragmentRendersNotFound(): void {
  const events: string[] = [];
  const storage = createStorage(events);

  assert.equal(
    captureAgentPick("", null, storage, () => undefined),
    null,
    "no fragment and no resume id is not found",
  );
  assert.equal(
    captureAgentPick("#not-a-valid-pick-payload", null, storage, () => undefined),
    null,
    "a malformed fragment is not found",
  );
  assert.deepEqual(events, [], "a rejected fragment is neither scrubbed nor stored");

  const markup = renderToStaticMarkup(<AgentPickStatus state={{ kind: "not-found" }} />);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /couldn&#x27;t find that request/);
}

function checkRedirectToSignInFiresExactlyOnce(): void {
  const guard: RedirectGuard = { current: false };
  const calls: Array<{ redirectUrl: string }> = [];

  redirectToSignInOnce(guard, pickId, (options) => {
    calls.push(options);
  });
  redirectToSignInOnce(guard, pickId, (options) => {
    calls.push(options);
  });

  assert.equal(calls.length, 1, "redirectToSignIn is called exactly once");
  assert.deepEqual(calls[0], {
    redirectUrl: `${AGENT_PICK_PATH}?${AGENT_PICK_QUERY_KEY}=${pickId}`,
  });
  assert.equal(calls[0].redirectUrl, agentPickResumePath(pickId));
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

async function checkEditFlowAppliesOnFirstFingerprintMatch(): Promise<void> {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls, (input) => {
    if (input === "/api/projects") {
      return Response.json({
        projects: [{ id: "p1", name: "Checkout", ...enrichedProjectFields }],
      });
    }
    if (input.startsWith("http://127.0.0.1:")) {
      const body: { projectId?: string } = JSON.parse(
        (calls.at(-1) as Call).body ?? "{}",
      );
      return body.projectId
        ? Response.json({ desiredGraph: { version: 1, nodes: [], edges: [] } })
        : Response.json({ projectId: "p1" });
    }
    if (input === "/api/projects/p1/agent-graph") {
      return Response.json({
        graph: { version: 1, nodes: [], edges: [] },
        opaqueNodeIds: [],
        opaqueEdgeIds: [],
        fingerprint: "f".repeat(64),
      });
    }
    if (input === "/api/projects/p1/agent-graph-edit") {
      return Response.json({ applied: true }, { status: 200 });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const result = await runAgentPickOperation(editPayload, { fetch: fetchImpl });
  assert.deepEqual(result, { kind: "redirect", projectId: "p1" });

  assert.deepEqual(
    calls.map((call) => call.input),
    [
      "/api/projects",
      "http://127.0.0.1:51234/",
      "/api/projects/p1/agent-graph",
      "http://127.0.0.1:51234/",
      "/api/projects/p1/agent-graph-edit",
    ],
  );

  const firstCallbackBody = JSON.parse(calls[1].body ?? "{}");
  assert.deepEqual(Object.keys(firstCallbackBody).sort(), ["nonce", "op", "projects"]);
  assert.deepEqual(
    firstCallbackBody.projects,
    [{ id: "p1", name: "Checkout" }],
    "the fixture carries owner/description/timestamps but only id and name may reach the loopback",
  );
  for (const project of firstCallbackBody.projects as Record<string, unknown>[]) {
    assert.deepEqual(
      Object.keys(project).sort(),
      ["id", "name"],
      "no field beyond id and name may reach the loopback",
    );
  }
}

async function checkEditFlowRetriesOnceOnStaleFingerprintThenFails(): Promise<void> {
  const calls: Call[] = [];
  let editAttempts = 0;
  const fetchImpl = fakeFetch(calls, (input) => {
    if (input === "/api/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Checkout" }] });
    }
    if (input.startsWith("http://127.0.0.1:")) {
      const lastBody: { projectId?: string } = JSON.parse(
        (calls.at(-1) as Call).body ?? "{}",
      );
      return lastBody.projectId
        ? Response.json({ desiredGraph: { version: 1, nodes: [], edges: [] } })
        : Response.json({ projectId: "p1" });
    }
    if (input === "/api/projects/p1/agent-graph") {
      return Response.json({
        graph: { version: 1, nodes: [], edges: [] },
        opaqueNodeIds: [],
        opaqueEdgeIds: [],
        fingerprint: "f".repeat(64),
      });
    }
    if (input === "/api/projects/p1/agent-graph-edit") {
      editAttempts += 1;
      return new Response(null, { status: 409 });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const result = await runAgentPickOperation(editPayload, { fetch: fetchImpl });
  assert.equal(editAttempts, 2, "a stale fingerprint is retried exactly once");
  assert.equal(result.kind, "failed");
  assert.match((result as { message: string }).message, /actively edited/);
}

// FIX 3: the agent must not be able to make up a projectId. A response that
// names an id outside the listed projects must fail closed rather than flow
// into the edit read/apply loop or (worse) a delete confirmation dialog with
// a blank name next to a live Delete button.
async function checkUnrecognizedProjectIdIsRejected(): Promise<void> {
  const editCalls: Call[] = [];
  const editFetch = fakeFetch(editCalls, (input) => {
    if (input === "/api/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Checkout" }] });
    }
    if (input.startsWith("http://127.0.0.1:")) {
      return Response.json({ projectId: "not-in-the-list" });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const editResult = await runAgentPickOperation(editPayload, { fetch: editFetch });
  assert.equal(editResult.kind, "failed", "an unrecognized projectId fails the edit op");
  assert.equal(
    editCalls.some((call) => call.input.includes("/agent-graph")),
    false,
    "an unrecognized projectId must never reach the graph read/apply endpoints",
  );

  const deleteCalls: Call[] = [];
  const deleteFetch = fakeFetch(deleteCalls, (input) => {
    if (input === "/api/projects") {
      return Response.json({
        projects: [
          { id: "p1", name: "Checkout" },
          { id: "p2", name: "Billing" },
        ],
      });
    }
    if (input.startsWith("http://127.0.0.1:")) {
      return Response.json({ projectId: "not-in-the-list" });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const deleteResult = await runAgentPickOperation(deletePayload, { fetch: deleteFetch });
  assert.equal(
    deleteResult.kind,
    "failed",
    "an unrecognized projectId must never reach confirm-delete with a blank name",
  );

  const missingProjectIdCalls: Call[] = [];
  const missingProjectIdFetch = fakeFetch(missingProjectIdCalls, (input) => {
    if (input === "/api/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Checkout" }] });
    }
    if (input.startsWith("http://127.0.0.1:")) {
      return Response.json({});
    }
    throw new Error(`Unexpected request: ${input}`);
  });
  const missingResult = await runAgentPickOperation(editPayload, {
    fetch: missingProjectIdFetch,
  });
  assert.equal(missingResult.kind, "failed", "a response with no projectId fails closed");
}

async function checkDeleteFlowConfirmsWithoutCallingDelete(): Promise<void> {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls, (input) => {
    if (input === "/api/projects") {
      return Response.json({
        projects: [
          { id: "p1", name: "Checkout" },
          { id: "p2", name: "Billing" },
        ],
      });
    }
    if (input.startsWith("http://127.0.0.1:")) {
      return Response.json({ projectId: "p2" });
    }
    throw new Error(`Unexpected request: ${input}`);
  });

  const result = await runAgentPickOperation(deletePayload, { fetch: fetchImpl });
  assert.deepEqual(result, { kind: "confirm-delete", projectId: "p2", projectName: "Billing" });
  assert.equal(
    calls.some((call) => call.method === "DELETE"),
    false,
    "DELETE must not be called before the user presses the Delete button",
  );

  const markup = renderToStaticMarkup(
    <AgentPickStatus
      state={{
        kind: "confirm-delete",
        projectName: "Billing",
        onCancel: () => undefined,
        onDelete: () => undefined,
      }}
    />,
  );
  assert.match(markup, /Billing/);
  assert.match(markup, /role="alert"/);
  assert.match(markup, /<button[^>]*type="button"[^>]*>Delete<\/button>/);
}

async function checkDeleteAgentPickProjectCallsDeleteOnlyWhenInvoked(): Promise<void> {
  const calls: Call[] = [];
  const fetchImpl = fakeFetch(calls, () => new Response(null, { status: 204 }));

  const outcome = await deleteAgentPickProject("p2", { fetch: fetchImpl });
  assert.equal(outcome, "done");
  assert.deepEqual(calls, [{ input: "/api/projects/p2", method: "DELETE", body: undefined }]);

  const failingFetch = fakeFetch([], () => new Response(null, { status: 500 }));
  const failed = await deleteAgentPickProject("p2", { fetch: failingFetch });
  assert.equal(failed, "failed");
}

async function checkStrictModeDeduplication(): Promise<void> {
  let starts = 0;
  const operation = async (): Promise<AgentPickResult> => {
    starts += 1;
    return { kind: "redirect", projectId: "p1" };
  };

  const first = startAgentPickOperationOnce(pickId, operation);
  const second = startAgentPickOperationOnce(pickId, operation);
  assert.equal(first, second, "Strict Mode's double effect shares one in-flight operation");
  await Promise.all([first, second]);
  assert.equal(starts, 1, "the operation body runs exactly once despite two effect passes");

  const retry = startAgentPickOperationOnce(pickId, operation);
  assert.notEqual(retry, first, "a settled operation leaves room for a later retry");
  await retry;
  assert.equal(starts, 2);
}

// FIX 5: a double-click on Delete before React commits the "working" state
// must not fire the DELETE request twice, mirroring the edit path's
// `startAgentPickOperationOnce` guard.
async function checkDeleteDeduplication(): Promise<void> {
  let starts = 0;
  const operation = async (): Promise<"done" | "failed"> => {
    starts += 1;
    return "done";
  };

  const first = startAgentPickDeleteOnce("p2", operation);
  const second = startAgentPickDeleteOnce("p2", operation);
  assert.equal(first, second, "a double-click shares one in-flight delete");
  await Promise.all([first, second]);
  assert.equal(starts, 1, "the delete body runs exactly once despite two calls");

  const retry = startAgentPickDeleteOnce("p2", operation);
  assert.notEqual(retry, first, "a settled delete leaves room for a later retry");
  await retry;
  assert.equal(starts, 2);

  // A different project id must not share the other's in-flight promise.
  let otherStarts = 0;
  const otherOperation = async (): Promise<"done" | "failed"> => {
    otherStarts += 1;
    return "done";
  };
  const concurrentOther = startAgentPickDeleteOnce("p3", otherOperation);
  assert.notEqual(concurrentOther, retry, "distinct project ids get distinct in-flight deletes");
  await concurrentOther;
  assert.equal(otherStarts, 1);
}

function checkStatusMarkup(): void {
  const working = renderToStaticMarkup(<AgentPickStatus state={{ kind: "working" }} />);
  assert.match(working, /role="status"/);

  const awaiting = renderToStaticMarkup(
    <AgentPickStatus state={{ kind: "awaiting-agent" }} />,
  );
  assert.match(awaiting, /role="status"/);
  assert.match(awaiting, /Waiting for your agent/);

  const done = renderToStaticMarkup(
    <AgentPickStatus state={{ kind: "done", message: "Diagram deleted. You can close this tab." }} />,
  );
  assert.match(done, /role="status"/);
  assert.match(done, /Diagram deleted/);

  const failed = renderToStaticMarkup(
    <AgentPickStatus
      state={{ kind: "failed", message: "We couldn't reach your agent.", onRetry: () => undefined }}
    />,
  );
  assert.match(failed, /role="alert"/);
  assert.match(failed, /<button[^>]*type="button"[^>]*>Retry<\/button>/);

  // Never render the nonce, the port, or graph contents.
  for (const markup of [working, awaiting, done, failed]) {
    assert.doesNotMatch(markup, new RegExp(nonce));
    assert.doesNotMatch(markup, /51234/);
  }
}

async function main(): Promise<void> {
  checkCaptureWritesToStorageAndScrubsUrl();
  checkCaptureSurvivesStorageWriteFailure();
  checkMissingOrMalformedFragmentRendersNotFound();
  checkRedirectToSignInFiresExactlyOnce();
  await checkEditFlowAppliesOnFirstFingerprintMatch();
  await checkEditFlowRetriesOnceOnStaleFingerprintThenFails();
  await checkUnrecognizedProjectIdIsRejected();
  await checkDeleteFlowConfirmsWithoutCallingDelete();
  await checkDeleteAgentPickProjectCallsDeleteOnlyWhenInvoked();
  await checkStrictModeDeduplication();
  await checkDeleteDeduplication();
  checkStatusMarkup();
  console.info("Agent pick page checks passed");
}

main().catch((error: unknown) => {
  console.error("Agent pick page verification failed");
  console.error(error);
  process.exitCode = 1;
});
