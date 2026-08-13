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

console.info("Agent launch contract checks passed");
