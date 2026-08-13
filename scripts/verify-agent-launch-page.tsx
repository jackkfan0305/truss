import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

import { JSDOM, VirtualConsole } from "jsdom";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentLaunchStatus,
} from "../components/agent/agent-launch-page";
import { AgentLaunchHydrationGate } from "../components/app/clerk-provider-gate";
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
import {
  AGENT_LAUNCH_PENDING_FRAGMENT_KEY,
  agentLaunchBootstrapScript,
} from "../lib/agent-launch-bootstrap";
import {
  agentLaunchResumePath,
  consumePendingAgentLaunch,
  hasPendingAgentLaunchFragment,
} from "../lib/agent-launch-bootstrap-client";

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
  assert.equal(
    captured && agentLaunchResumePath(captured),
    `/agent/new?launch=${launchId}`,
    "a valid pending capture reloads only the canonical opaque resume route",
  );
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

function checkBootstrapScriptKeepsPayloadOutOfTheURL(): void {
  const script = agentLaunchBootstrapScript();
  const layoutSource = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(script, new RegExp(AGENT_LAUNCH_PENDING_FRAGMENT_KEY));
  assert.match(script, /sessionStorage\.setItem/);
  assert.match(script, /history\.replaceState/);
  assert.doesNotMatch(script, /console\./);
  assert.doesNotMatch(script, /description/);
  assert.doesNotMatch(script, /launchId/);
  assert.doesNotMatch(script, /TextDecoder/);
  assert.match(layoutSource, /dangerouslySetInnerHTML=\{\{ __html: agentLaunchBootstrapScript\(\) \}\}/);
  assert.doesNotMatch(layoutSource, /from "next\/script"/);
}

function checkBootstrapPendingCapture(): void {
  const events: string[] = [];
  const storage = createStorage(events);
  storage.setItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY, fragment);

  assert.equal(hasPendingAgentLaunchFragment("/agent/new", storage), true);
  const captured = consumePendingAgentLaunch(storage, () => {
    events.push("scrub");
  });

  assert.deepEqual(captured, createAgentLaunchRecord(payload));
  assert.equal(
    getStoredAgentLaunch(launchId, storage)?.launchId,
    launchId,
    "a valid pending fragment creates exactly one canonical launch record",
  );
  assert.equal(
    storage.getItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY),
    null,
    "a valid capture consumes the raw pending fragment",
  );
  assert.equal(
    hasPendingAgentLaunchFragment("/agent/new", storage),
    false,
    "the gate can mount Clerk after handling the pending fragment",
  );
  assert.equal(
    hasPendingAgentLaunchFragment("/agent/new/extra", storage),
    false,
    "nested paths cannot enter the launch capture gate",
  );
  assert.equal(
    events.filter((event) => event === `set:${agentLaunchStorageKey(launchId)}`).length,
    1,
    "pending capture writes one canonical record",
  );

  const invalidStorage = createStorage();
  invalidStorage.setItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY, "#not-a-canonical-launch");
  assert.equal(hasPendingAgentLaunchFragment("/agent/new", invalidStorage), true);
  assert.equal(consumePendingAgentLaunch(invalidStorage, () => undefined), null);
  assert.equal(
    hasPendingAgentLaunchFragment("/agent/new", invalidStorage),
    false,
    "canonical rejection clears the pending fragment so Clerk mounts normally",
  );

  const noFragmentStorage = createStorage();
  assert.equal(
    hasPendingAgentLaunchFragment("/agent/new", noFragmentStorage),
    false,
    "without a pending fragment the gate mounts Clerk immediately",
  );
}

function checkBootstrapScrubsWhenStorageFails(): void {
  let scrubCalls = 0;
  const context = {
    location: { pathname: "/agent/new", search: "", hash: "#abc" },
    sessionStorage: {
      setItem() {
        throw new DOMException("blocked", "SecurityError");
      },
    },
    history: {
      state: null,
      replaceState() {
        scrubCalls += 1;
      },
    },
  };

  vm.runInNewContext(agentLaunchBootstrapScript(), context);
  assert.equal(scrubCalls, 1, "bootstrap scrubs even when session storage rejects writes");
}

function createThrowingStorage(
  operation: "get" | "set" | "remove",
  pendingFragment: string | null = null,
): AgentLaunchStorage {
  const values = new Map<string, string>();
  if (pendingFragment !== null) {
    values.set(AGENT_LAUNCH_PENDING_FRAGMENT_KEY, pendingFragment);
  }

  return {
    getItem(key) {
      if (operation === "get") {
        throw new DOMException("blocked", "SecurityError");
      }

      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (operation === "set") {
        throw new DOMException("blocked", "SecurityError");
      }

      values.set(key, value);
    },
    removeItem(key) {
      if (operation === "remove") {
        throw new DOMException("blocked", "SecurityError");
      }

      values.delete(key);
    },
  };
}

function checkStorageFailuresFailOpen(): void {
  const lookupFailure = createThrowingStorage("get");
  assert.equal(
    hasPendingAgentLaunchFragment("/agent/new", lookupFailure),
    false,
    "storage lookup failures must mount Clerk normally",
  );
  assert.equal(consumePendingAgentLaunch(lookupFailure, () => undefined), null);

  const captureWriteFailure = createThrowingStorage("set", fragment);
  assert.equal(
    consumePendingAgentLaunch(captureWriteFailure, () => undefined),
    null,
    "canonical capture write failures must not keep the capture status mounted",
  );

  const cleanupFailure = createThrowingStorage("remove", "#not-a-canonical-launch");
  assert.equal(
    consumePendingAgentLaunch(cleanupFailure, () => undefined),
    null,
    "pending cleanup failures must not crash or block normal Clerk mounting",
  );
}

async function checkHydrationGate(): Promise<void> {
  const globalKeys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previousGlobals = new Map(
    globalKeys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const setDomGlobals = (dom: JSDOM) => {
    Object.defineProperties(globalThis, {
      window: { configurable: true, value: dom.window },
      document: { configurable: true, value: dom.window.document },
      navigator: { configurable: true, value: dom.window.navigator },
      IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    });
  };
  const restoreGlobals = () => {
    for (const key of globalKeys) {
      const descriptor = previousGlobals.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  };
  const serverMarkup = renderToStaticMarkup(
    <AgentLaunchHydrationGate renderClerk={(children) => <div>{children}</div>}>
      <p>Child</p>
    </AgentLaunchHydrationGate>,
  );
  const dom = new JSDOM(`<div id="root">${serverMarkup}</div>`, {
    url: "https://example.test/agent/new",
    virtualConsole: new VirtualConsole(),
  });
  const errors: string[] = [];
  const originalConsoleError = console.error;
  const hydrationEvents: string[] = [];

  setDomGlobals(dom);
  dom.window.sessionStorage.setItem(AGENT_LAUNCH_PENDING_FRAGMENT_KEY, fragment);
  console.error = (...values: unknown[]) => {
    errors.push(values.map(String).join(" "));
  };

  try {
    await act(async () => {
      hydrateRoot(
        dom.window.document.getElementById("root")!,
        <AgentLaunchHydrationGate
          renderClerk={(children) => {
            hydrationEvents.push(
              dom.window.sessionStorage.getItem(agentLaunchStorageKey(launchId)) === null
                ? "clerk-before-capture"
                : "clerk-after-capture",
            );
            return <div data-clerk-mounted="true">{children}</div>;
          }}
        >
          <p>Child</p>
        </AgentLaunchHydrationGate>,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(
      hydrationEvents.includes("clerk-before-capture"),
      false,
      `Clerk must not mount before canonical pending capture (${hydrationEvents.join(",")})`,
    );
    assert.equal(
      dom.window.sessionStorage.getItem(agentLaunchStorageKey(launchId)) !== null,
      true,
      "valid pending hydration stores the canonical launch before attempting its opaque resume",
    );
    assert.equal(
      errors.some((error) => /hydration|did not match/i.test(error)),
      false,
      "valid pending hydration must not report a mismatch",
    );
  } finally {
    console.error = originalConsoleError;
    restoreGlobals();
    dom.window.close();
  }

  const ordinaryDom = new JSDOM(`<div id="root">${serverMarkup}</div>`, {
    url: "https://example.test/editor",
  });
  let ordinaryClerkMounts = 0;
  setDomGlobals(ordinaryDom);

  try {
    await act(async () => {
      hydrateRoot(
        ordinaryDom.window.document.getElementById("root")!,
        <AgentLaunchHydrationGate
          renderClerk={(children) => {
            ordinaryClerkMounts += 1;
            return <div data-clerk-mounted="true">{children}</div>;
          }}
        >
          <p>Child</p>
        </AgentLaunchHydrationGate>,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(ordinaryClerkMounts, 1, "ordinary routes mount Clerk after hydration");
  } finally {
    restoreGlobals();
    ordinaryDom.window.close();
  }
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
  const { isPublicPath, isClerkHandshakeBypassPath } = await import("../proxy");

  assert.equal(isPublicPath("/agent/new"), true);
  assert.equal(isPublicPath("/agent/new/extra"), false);
  assert.equal(isPublicPath("/editor"), false);
  assert.equal(isPublicPath("/api/projects"), false);
  assert.equal(
    isClerkHandshakeBypassPath("/agent/new"),
    true,
    "the launch capture page bypasses Clerk's redirecting server handshake",
  );
  assert.equal(isClerkHandshakeBypassPath("/agent/new/extra"), false);
  assert.equal(isClerkHandshakeBypassPath("/editor"), false);
  assert.equal(isClerkHandshakeBypassPath("/sign-in"), false);
  assert.equal(isClerkHandshakeBypassPath("/api/projects"), false);
}

async function main(): Promise<void> {
  checkCaptureAndResume();
  checkBootstrapScriptKeepsPayloadOutOfTheURL();
  checkBootstrapPendingCapture();
  checkBootstrapScrubsWhenStorageFails();
  checkStorageFailuresFailOpen();
  await checkHydrationGate();
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
