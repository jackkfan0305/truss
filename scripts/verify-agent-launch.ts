import assert from "node:assert/strict";

import {
  AGENT_LAUNCH_VERSION,
  agentLaunchStorageKey,
  createAgentLaunchRecord,
  isAgentLaunchId,
  parseAgentLaunchFragment,
  parseAgentLaunchRecord,
  withAgentLaunchStage,
} from "../lib/agent-launch";

const launchId = "00000000-0000-4a00-8000-000000000001";
const payload = {
  version: AGENT_LAUNCH_VERSION,
  launchId,
  title: "Global Checkout Platform",
  description: "Show regional gateways, orders, payments, and failure queues.",
};
const fragment = Buffer.from(JSON.stringify(payload)).toString("base64url");

assert.deepEqual(parseAgentLaunchFragment(`#${fragment}`), payload);
assert.equal(agentLaunchStorageKey(launchId), `truss:agent-launch:v1:${launchId}`);
assert.equal(isAgentLaunchId(launchId), true);
assert.equal(isAgentLaunchId(launchId.toUpperCase()), false);
assert.equal(parseAgentLaunchFragment("#not-base64url"), null);
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
    `#${Buffer.from(JSON.stringify({ ...payload, description: "x".repeat(2_001) })).toString("base64url")}`,
  ),
  null,
);
assert.deepEqual(
  parseAgentLaunchFragment(
    `#${Buffer.from(JSON.stringify({
      ...payload,
      title: "x".repeat(120),
      description: "x".repeat(2_000),
    })).toString("base64url")}`,
  ),
  { ...payload, title: "x".repeat(120), description: "x".repeat(2_000) },
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
assert.throws(() => withAgentLaunchStage(captured, "run-started"));
assert.throws(() =>
  withAgentLaunchStage(
    withAgentLaunchStage(creating, "project-created"),
    "captured",
  ),
);

console.info("Agent launch contract checks passed");
