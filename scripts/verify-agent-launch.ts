import assert from "node:assert/strict";

import {
  AGENT_LAUNCH_VERSION,
  MAX_AGENT_LAUNCH_FRAGMENT_LENGTH,
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
assert.equal(agentLaunchStorageKey(launchId), `truss.agent-launch.v1:${launchId}`);
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

const urlSafePayload = { ...payload, description: "x࠾" };
const urlSafeFragment = Buffer.from(JSON.stringify(urlSafePayload)).toString(
  "base64url",
);
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

const projectCreated = withAgentLaunchStage(creating, "project-created");
const promptSent = withAgentLaunchStage(
  withAgentLaunchStage(projectCreated, "sending-prompt"),
  "prompt-sent",
);
const runStarted = withAgentLaunchStage(
  withAgentLaunchStage(promptSent, "starting-run"),
  "run-started",
);
assert.throws(() => withAgentLaunchStage(runStarted, "failed"));

const collided = withAgentLaunchStage(creating, "creating-project", {
  projectId: "global-checkout-d4e5f6",
});
assert.equal(collided.projectId, "global-checkout-d4e5f6");
assert.equal(
  withAgentLaunchStage(withAgentLaunchStage(captured, "failed"), "creating-project")
    .stage,
  "creating-project",
);
assert.equal(
  withAgentLaunchStage(withAgentLaunchStage(projectCreated, "failed"), "sending-prompt")
    .stage,
  "sending-prompt",
);
assert.equal(
  withAgentLaunchStage(withAgentLaunchStage(promptSent, "failed"), "starting-run")
    .stage,
  "starting-run",
);
assert.equal(withAgentLaunchStage(withAgentLaunchStage(captured, "failed"), "failed").stage, "failed");

console.info("Agent launch contract checks passed");
