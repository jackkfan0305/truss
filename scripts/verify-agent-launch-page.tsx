import assert from "node:assert/strict";

import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentLaunchStatus,
} from "../components/agent/agent-launch-page";
import {
  captureAgentLaunch,
  createAgentLaunchProject,
  getStoredAgentLaunch,
  startAgentLaunchProjectOnce,
  type AgentLaunchStorage,
} from "../lib/agent-launch-browser";
import {
  AGENT_LAUNCH_VERSION,
  agentLaunchStorageKey,
  createAgentLaunchRecord,
} from "../lib/agent-launch";

process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ??= "/sign-in";
process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL ??= "/sign-up";

const launchId = "00000000-0000-4a00-8000-000000000002";
const payload = {
  version: AGENT_LAUNCH_VERSION,
  launchId,
  title: "Global Checkout",
  description: "Show gateways, orders, payments, and failure queues.",
};
const fragment = `#${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

function createStorage(events: string[] = []): AgentLaunchStorage {
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
    removeItem(key) {
      events.push(`remove:${key}`);
      values.delete(key);
    },
  };
}

function checkCaptureAndResume(): void {
  const events: string[] = [];
  const storage = createStorage(events);
  const captured = captureAgentLaunch(fragment, null, storage, () => {
    events.push("scrub");
  });

  assert.deepEqual(captured, createAgentLaunchRecord(payload));
  assert.deepEqual(events.slice(0, 2), ["scrub", `set:${agentLaunchStorageKey(launchId)}`]);

  const invalidEvents: string[] = [];
  assert.equal(
    captureAgentLaunch("#not-a-launch", null, createStorage(invalidEvents), () => {
      invalidEvents.push("scrub");
    }),
    null,
  );
  assert.deepEqual(invalidEvents, [], "invalid fragments are neither scrubbed nor stored");

  const resumed = captureAgentLaunch("", launchId, storage, () => undefined);
  assert.deepEqual(resumed, captured, "the fixed resume query reads its matching session key");

  const unrelatedLaunchId = "00000000-0000-4a00-8000-000000000003";
  storage.setItem(
    agentLaunchStorageKey(unrelatedLaunchId),
    JSON.stringify({ ...captured, launchId: unrelatedLaunchId }),
  );
  assert.equal(
    getStoredAgentLaunch(launchId, {
      ...storage,
      getItem: (key) =>
        key === agentLaunchStorageKey(launchId)
          ? JSON.stringify({ ...captured, launchId: unrelatedLaunchId })
          : storage.getItem(key),
    }),
    null,
    "a resume record must match its opaque query UUID",
  );
}

async function checkStrictModeDeduplication(): Promise<void> {
  let postCount = 0;
  const operation = async () => {
    postCount += 1;
    return { ...createAgentLaunchRecord(payload), stage: "project-created" as const };
  };

  const first = startAgentLaunchProjectOnce(launchId, operation);
  const second = startAgentLaunchProjectOnce(launchId, operation);
  assert.equal(first, second, "Strict Mode remounts share one in-tab operation");
  await Promise.all([first, second]);
  assert.equal(postCount, 1);

  const retry = startAgentLaunchProjectOnce(launchId, operation);
  assert.notEqual(retry, first, "the settled launch leaves room for Retry");
  await retry;
  assert.equal(postCount, 2);
}

async function checkRecovery(): Promise<void> {
  const storage = createStorage();
  const requests: Array<{ input: string; method: string; body?: string }> = [];
  const recovered = await createAgentLaunchProject(createAgentLaunchRecord(payload), {
    storage,
    createSuffix: () => "a1b2c3",
    fetch: async (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (init?.method === "POST") {
        return Response.json({ error: "taken" }, { status: 409 });
      }

      return Response.json({
        project: { id: "global-checkout-a1b2c3", name: "Global Checkout" },
      });
    },
  });

  assert.equal(recovered.stage, "project-created");
  assert.equal(recovered.projectId, "global-checkout-a1b2c3");
  assert.deepEqual(requests, [
    {
      input: "/api/projects",
      method: "POST",
      body: '{"id":"global-checkout-a1b2c3","name":"Global Checkout"}',
    },
    {
      input: "/api/projects/global-checkout-a1b2c3",
      method: "GET",
      body: undefined,
    },
  ]);
}

async function checkPostResponseLossRecovery(): Promise<void> {
  for (const scenario of ["rejected", "unparseable"] as const) {
    const requests: Array<{ input: string; method: string }> = [];
    let suffixCalls = 0;
    const recovered = await createAgentLaunchProject(createAgentLaunchRecord(payload), {
      storage: createStorage(),
      createSuffix: () => {
        suffixCalls += 1;
        return "a1b2c3";
      },
      fetch: async (input, init) => {
        const method = init?.method ?? "GET";
        requests.push({ input: String(input), method });

        if (method === "POST") {
          if (scenario === "rejected") {
            throw new Error("connection closed after project creation");
          }

          return new Response("not json", { status: 201 });
        }

        return Response.json({
          project: { id: "global-checkout-a1b2c3", name: "Global Checkout" },
        });
      },
    });

    assert.equal(recovered.stage, "project-created", `${scenario} POST recovers`);
    assert.equal(suffixCalls, 1, `${scenario} recovery does not create a second project`);
    assert.deepEqual(requests, [
      { input: "/api/projects", method: "POST" },
      { input: "/api/projects/global-checkout-a1b2c3", method: "GET" },
    ]);
  }
}

async function checkFailuresAndSingleCollisionRetry(): Promise<void> {
  const storage = createStorage();
  const unauthorized = await createAgentLaunchProject(createAgentLaunchRecord(payload), {
    storage,
    createSuffix: () => "a1b2c3",
    fetch: async () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  });
  assert.equal(unauthorized.stage, "failed", "a 401 is not retried");

  let suffixCalls = 0;
  let postCalls = 0;
  const collision = await createAgentLaunchProject(
    {
      ...createAgentLaunchRecord(payload),
      stage: "creating-project",
      projectId: "global-checkout-a1b2c3",
    },
    {
      storage: createStorage(),
      createSuffix: () => {
        suffixCalls += 1;
        return "d4e5f6";
      },
      fetch: async (_input, init) => {
        if (init?.method === "POST") {
          postCalls += 1;
          return Response.json({ error: "taken" }, { status: 409 });
        }

        return Response.json({ error: "not found" }, { status: 404 });
      },
    },
  );
  assert.equal(collision.stage, "failed");
  assert.equal(suffixCalls, 1, "an inaccessible collision rotates the suffix exactly once");
  assert.equal(postCalls, 2, "an inaccessible collision gets exactly one replacement POST");
}

function checkStatusMarkup(): void {
  const captured = createAgentLaunchRecord(payload);
  const statusHtml = renderToStaticMarkup(
    <AgentLaunchStatus record={captured} onRetry={() => undefined} />,
  );
  assert.match(statusHtml, /role="status"/);
  assert.match(statusHtml, /Global Checkout/);
  assert.doesNotMatch(statusHtml, /Show gateways/);

  const failedHtml = renderToStaticMarkup(
    <AgentLaunchStatus
      record={{ ...captured, stage: "failed", error: "Could not create project." }}
      onRetry={() => undefined}
    />,
  );
  assert.match(failedHtml, /role="alert"/);
  assert.match(failedHtml, /<button[^>]*type="button"[^>]*>Retry<\/button>/);
}

async function checkPublicPathBoundary(): Promise<void> {
  const { isPublicPath } = await import("../proxy");

  assert.equal(isPublicPath("/agent/new"), true);
  assert.equal(isPublicPath("/agent/new/extra"), false);
  assert.equal(isPublicPath("/editor"), false);
  assert.equal(isPublicPath("/api/projects"), false);
}

async function main(): Promise<void> {
  checkCaptureAndResume();
  await checkStrictModeDeduplication();
  await checkRecovery();
  await checkPostResponseLossRecovery();
  await checkFailuresAndSingleCollisionRetry();
  checkStatusMarkup();
  await checkPublicPathBoundary();
  console.info("Agent launch page checks passed");
}

main().catch((error: unknown) => {
  console.error("Agent launch page verification failed");
  console.error(error);
  process.exitCode = 1;
});
