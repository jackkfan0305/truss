import assert from "node:assert/strict";

import { createAgentLaunchFragmentBoundaryInput } from "./testing/agent-launch-fragment-fixtures.mjs";

import {
  AGENT_LAUNCH_VERSION,
  MAX_AGENT_LAUNCH_FRAGMENT_LENGTH,
  agentLaunchStorageKey,
  createAgentLaunchRecord,
  isAgentLaunchId,
  parseAgentLaunchFragment,
  parseAgentLaunchRecord,
  withAgentLaunchStage,
  type AgentLaunchPayloadV1,
  type AgentLaunchStage,
} from "../lib/agent-launch";
import { parseAgentPickFragment, type AgentPickPayloadV1 } from "../lib/agent-pick";

// Must precede the `../proxy` import: it stubs the env vars proxy.ts requires
// at module load. See the file's own comment for why it is a module.
import "./testing/clerk-env-stub.mjs";

import { isClerkHandshakeBypassPath, isPublicPath } from "../proxy";

const launchId = "00000000-0000-4a00-8000-000000000001";
const payload = {
  version: AGENT_LAUNCH_VERSION,
  launchId,
  title: "Global Checkout Platform",
  graph: {
    version: 1,
    nodes: [
      {
        id: "gateway",
        label: "Gateway",
        shape: "rectangle",
        color: "blue",
        x: 0,
        y: 0,
      },
    ],
    edges: [],
  },
} satisfies AgentLaunchPayloadV1;
const fragment = Buffer.from(JSON.stringify(payload)).toString("base64url");
const atFragmentCap = createAgentLaunchFragmentBoundaryInput(12_288, launchId);
const atFragmentCapFragment = Buffer.from(
  JSON.stringify({ version: AGENT_LAUNCH_VERSION, launchId, ...atFragmentCap }),
).toString("base64url");
const aboveFragmentCap = createAgentLaunchFragmentBoundaryInput(12_289, launchId);
const aboveFragmentCapFragment = Buffer.from(
  JSON.stringify({ version: AGENT_LAUNCH_VERSION, launchId, ...aboveFragmentCap }),
).toString("base64url");

assert.deepEqual(parseAgentLaunchFragment(`#${fragment}`), payload);
assert.equal(atFragmentCapFragment.length, MAX_AGENT_LAUNCH_FRAGMENT_LENGTH);
assert.deepEqual(
  parseAgentLaunchFragment(`#${atFragmentCapFragment}`),
  { version: AGENT_LAUNCH_VERSION, launchId, ...atFragmentCap },
  "accepts exactly 16,384 encoded characters",
);
assert.equal(aboveFragmentCapFragment.length, MAX_AGENT_LAUNCH_FRAGMENT_LENGTH + 2);
assert.equal(
  parseAgentLaunchFragment(`#${aboveFragmentCapFragment}`),
  null,
  "rejects the smallest constructible valid encoded fragment over the cap",
);
assert.equal(
  agentLaunchStorageKey(launchId),
  `truss.agent-launch.graph.v1:${launchId}`,
);
assert.equal(isAgentLaunchId(launchId), true);
assert.equal(isAgentLaunchId(launchId.toUpperCase()), false);
assert.equal(parseAgentLaunchFragment(""), null, "blank fragment");
assert.equal(parseAgentLaunchFragment("#"), null, "blank hash fragment");
assert.equal(
  parseAgentLaunchFragment(`#${"a".repeat(MAX_AGENT_LAUNCH_FRAGMENT_LENGTH + 1)}`),
  null,
  "oversized fragment",
);
assert.equal(parseAgentLaunchFragment("#not-base64url"), null);
assert.equal(parseAgentLaunchFragment(`#${fragment}=`), null, "padded base64url");

const urlSafePayload = { ...payload, title: "x¾" };
const urlSafeFragment = Buffer.from(JSON.stringify(urlSafePayload)).toString("base64url");
assert.equal(urlSafeFragment.includes("-"), true, "test fixture uses base64url");
assert.equal(
  parseAgentLaunchFragment(`#${urlSafeFragment.replace("-", "+")}`),
  null,
  "standard base64 alphabet",
);
assert.equal(parseAgentLaunchFragment("#a*bc"), null, "invalid base64 character");
assert.equal(
  parseAgentLaunchFragment(`#${Buffer.from([0xff]).toString("base64url")}`),
  null,
  "invalid UTF-8",
);
assert.equal(
  parseAgentLaunchFragment(`#${Buffer.from("{").toString("base64url")}`),
  null,
  "invalid JSON",
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, version: 2 })).toString("base64url")}`,
  ),
  null,
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, title: "x".repeat(121) })).toString("base64url")}`,
  ),
  null,
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, title: " Global Checkout Platform " })).toString("base64url")}`,
  ),
  null,
  "rejects padded titles rather than normalizing them",
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, description: "old payload" })).toString("base64url")}`,
  ),
  null,
  "rejects obsolete description fields",
);
assert.equal(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({ ...payload, graph: { ...payload.graph, nodes: [] } })).toString("base64url")}`,
  ),
  null,
  "rejects an invalid graph as a whole",
);

const captured = createAgentLaunchRecord(payload);
const creating = withAgentLaunchStage(captured, "creating-project", {
  projectId: "global-checkout-a1b2c3",
});
assert.equal(captured.stage, "captured", "the original record is immutable");
assert.equal(creating.stage, "creating-project");
assert.equal(creating.projectId, "global-checkout-a1b2c3");
assert.deepEqual(parseAgentLaunchRecord(JSON.stringify(creating)), creating);
assert.equal(parseAgentLaunchRecord("{}"), null);
assert.equal(
  parseAgentLaunchRecord(JSON.stringify({ ...creating, description: "old payload" })),
  null,
  "rejects obsolete stored records",
);

const allowedTransitions: Record<AgentLaunchStage, readonly AgentLaunchStage[]> = {
  captured: ["creating-project", "failed"],
  "creating-project": ["project-created", "failed"],
  "project-created": ["importing-graph", "failed"],
  "importing-graph": ["graph-imported", "failed"],
  "graph-imported": [],
  failed: ["creating-project", "importing-graph", "failed"],
};

const records: Record<AgentLaunchStage, ReturnType<typeof createAgentLaunchRecord>> = {
  captured,
  "creating-project": creating,
  "project-created": withAgentLaunchStage(creating, "project-created"),
  "importing-graph": withAgentLaunchStage(
    withAgentLaunchStage(creating, "project-created"),
    "importing-graph",
  ),
  "graph-imported": withAgentLaunchStage(
    withAgentLaunchStage(
      withAgentLaunchStage(creating, "project-created"),
      "importing-graph",
    ),
    "graph-imported",
  ),
  failed: withAgentLaunchStage(captured, "failed", { error: "Retry later." }),
};

for (const [from, targets] of Object.entries(allowedTransitions) as [
  AgentLaunchStage,
  readonly AgentLaunchStage[],
][]) {
  for (const to of Object.keys(allowedTransitions) as AgentLaunchStage[]) {
    if (targets.includes(to)) {
      assert.equal(withAgentLaunchStage(records[from], to).stage, to, `${from} -> ${to}`);
    } else {
      assert.throws(() => withAgentLaunchStage(records[from], to), `${from} !-> ${to}`);
    }
  }
}

// Task 6: the agent entry paths are public and bypass the Clerk handshake,
// and nothing that merely looks similar slips through.
assert.equal(isPublicPath("/agent/pick"), true);
assert.equal(isClerkHandshakeBypassPath("/agent/pick"), true);
assert.equal(isPublicPath("/agent/picky"), false);
assert.equal(isPublicPath("/editor/abc"), false);
assert.equal(isPublicPath("/agent/new"), true, "the launch path is still public");
assert.equal(
  isClerkHandshakeBypassPath("/agent/new"),
  true,
  "the launch path still bypasses the handshake",
);

const pickId = "00000000-0000-4a00-8000-000000000002";
const pickNonce = "00000000-0000-4a00-8000-000000000003";
const pickPayload = {
  version: 1,
  pickId,
  op: "edit",
  port: 51200,
  nonce: pickNonce,
} satisfies AgentPickPayloadV1;
const pickFragment = Buffer.from(JSON.stringify(pickPayload)).toString("base64url");

assert.deepEqual(parseAgentPickFragment(`#${pickFragment}`), pickPayload);
assert.equal(parseAgentPickFragment(""), null, "blank fragment");
assert.equal(parseAgentPickFragment("#"), null, "blank hash fragment");
assert.equal(parseAgentPickFragment("#not-base64url!"), null, "non-base64url fragment");
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, extra: 1 })).toString("base64url")}`,
  ),
  null,
  "rejects an unknown key",
);
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, port: 1023 })).toString("base64url")}`,
  ),
  null,
  "rejects a below-range port",
);
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, port: 65536 })).toString("base64url")}`,
  ),
  null,
  "rejects an above-range port",
);
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, port: 1024.5 })).toString("base64url")}`,
  ),
  null,
  "rejects a non-integer port",
);
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, nonce: "not-a-uuid" })).toString("base64url")}`,
  ),
  null,
  "rejects a non-UUID nonce",
);
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, pickId: "not-a-uuid" })).toString("base64url")}`,
  ),
  null,
  "rejects a non-UUID pickId",
);
assert.equal(
  parseAgentPickFragment(
    `#${Buffer.from(JSON.stringify({ ...pickPayload, op: "rename" })).toString("base64url")}`,
  ),
  null,
  "rejects an unknown op",
);

console.info("Agent launch contract checks passed");
