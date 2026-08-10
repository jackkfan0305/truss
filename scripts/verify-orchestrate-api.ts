import assert from "node:assert/strict";

import { startVerifiedAgentRun } from "../lib/agent-run-server";
import { handleOrchestratePost } from "../lib/orchestrate-route-handler";
import {
  parseOrchestrateRequest,
  parseRunId,
} from "../lib/orchestrate-requests";
import {
  AI_CHAT_FEED_ID,
  AI_DESIGN_MODELS,
  AI_USER_ID,
  AI_USER_NAME,
  AI_THINKING_LEVELS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  type AiChatMessage,
} from "../types/tasks";

const valid = {
  prompt: "Design a checkout flow",
  promptMessageId: "chat-00000000-0000-4000-8000-000000000000",
  projectId: "checkout-flow-a1b2",
  roomId: "checkout-flow-a1b2",
};

/** What a body without run settings must parse to: the request plus defaults. */
const parsedValid = {
  ...valid,
  modelId: DEFAULT_AI_DESIGN_MODEL_ID,
  thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
};

function checkOrchestrateRequestParsing() {
  assert.deepEqual(parseOrchestrateRequest(valid), parsedValid, "valid request");

  assert.deepEqual(
    parseOrchestrateRequest({
      ...valid,
      prompt: "  Design a checkout flow  ",
      promptMessageId: "  chat-00000000-0000-4000-8000-000000000000  ",
    }),
    parsedValid,
    "trims every field",
  );

  // The mismatch guard. A room ID that is not the project ID would aim
  // generation at a room this request was never authorized for.
  assert.equal(
    parseOrchestrateRequest({ ...valid, roomId: "someone-elses-room" }),
    null,
    "roomId must equal projectId",
  );

  const rejected: unknown[] = [
    null,
    undefined,
    "a string body",
    [valid],
    {},
    { ...valid, prompt: "" },
    { ...valid, prompt: "   " },
    { ...valid, prompt: 42 },
    { ...valid, prompt: null },
    { ...valid, prompt: "x".repeat(2001) },
    { prompt: valid.prompt, projectId: valid.projectId, roomId: valid.roomId },
    { ...valid, promptMessageId: "" },
    { ...valid, promptMessageId: "   " },
    { ...valid, promptMessageId: 42 },
    { ...valid, promptMessageId: "x".repeat(257) },
    { ...valid, projectId: "" },
    { ...valid, projectId: 7, roomId: 7 },
    { prompt: valid.prompt, projectId: valid.projectId },
    { prompt: valid.prompt, roomId: valid.roomId },
    // A model the picker does not offer. Forwarding it would spend a run on a
    // model nobody chose, so the request is refused rather than defaulted.
    { ...valid, modelId: "gemini-2.5-flash" },
    { ...valid, modelId: "" },
    { ...valid, modelId: 42 },
    // Same rule for thinking effort. `minimal` is the trap: Gemini accepts it on
    // Flash and Flash-Lite but not on Pro, so it is not offered and not allowed.
    { ...valid, thinkingLevel: "minimal" },
    { ...valid, thinkingLevel: "highest" },
    { ...valid, thinkingLevel: "" },
    { ...valid, thinkingLevel: 42 },
  ];

  for (const body of rejected) {
    assert.equal(
      parseOrchestrateRequest(body),
      null,
      `rejected: ${JSON.stringify(body)}`,
    );
  }

  // Every model the composer can offer must survive the round trip, or the
  // picker would show an option that 400s on send.
  for (const model of AI_DESIGN_MODELS) {
    assert.deepEqual(
      parseOrchestrateRequest({ ...valid, modelId: model.id }),
      { ...parsedValid, modelId: model.id },
      `accepts offered model: ${model.id}`,
    );
  }

  // And every effort level, against every model — the two pickers are
  // independent, so any pair the composer can produce has to be accepted.
  for (const level of AI_THINKING_LEVELS) {
    assert.deepEqual(
      parseOrchestrateRequest({ ...valid, thinkingLevel: level.id }),
      { ...parsedValid, thinkingLevel: level.id },
      `accepts offered effort: ${level.id}`,
    );

    for (const model of AI_DESIGN_MODELS) {
      assert.deepEqual(
        parseOrchestrateRequest({
          ...valid,
          modelId: model.id,
          thinkingLevel: level.id,
        }),
        { ...parsedValid, modelId: model.id, thinkingLevel: level.id },
        `accepts ${model.id} at ${level.id}`,
      );
    }
  }

  // The ceiling is inclusive — the boundary is the value most likely to drift.
  assert.ok(
    parseOrchestrateRequest({ ...valid, prompt: "x".repeat(2000) }),
    "prompt at the limit",
  );
  assert.ok(
    parseOrchestrateRequest({ ...valid, promptMessageId: "x".repeat(256) }),
    "prompt message ID at the limit",
  );
}

function checkRunIdParsing() {
  assert.equal(parseRunId({ runId: " run_abc123 " }), "run_abc123", "trimmed");

  const rejected: unknown[] = [
    null,
    "run_abc123",
    ["run_abc123"],
    {},
    { runId: "" },
    { runId: "   " },
    { runId: 42 },
    { runId: null },
    { runId: `run_${"x".repeat(100)}` },
  ];

  for (const body of rejected) {
    assert.equal(parseRunId(body), null, `rejected: ${JSON.stringify(body)}`);
  }
}

interface PromptAnchorCase {
  name: string;
  messages: Array<{
    id: string;
    createdAt: number;
    updatedAt: number;
    data: unknown;
  }>;
  shouldTrigger: boolean;
}

/**
 * The prompt ID becomes trusted worker-authored run metadata, so the route-side
 * helper must prove the exact authenticated human message before spending a
 * Trigger run — an orchestrator run now, which can spend two more behind it. Every denied fixture also asserts that the trigger callback was
 * never reached.
 */
async function checkPromptAnchorBeforeTriggering() {
  const promptMessage: AiChatMessage = {
    role: "user",
    senderId: "user_ada",
    senderName: "Ada Lovelace",
    content: valid.prompt,
    sentAt: 1_700_000_000_000,
  };
  const assistantMessage: AiChatMessage = {
    role: "assistant",
    senderId: AI_USER_ID,
    senderName: AI_USER_NAME,
    content: "I updated the canvas.",
    sentAt: 1_700_000_000_001,
  };
  const runMessage: AiChatMessage = {
    ...assistantMessage,
    content: "",
    run: {
      runId: "run_existing",
      promptMessageId: valid.promptMessageId,
      phase: "running",
      activity: [],
    },
  };
  const feedEntry = (id: string, data: unknown) => ({
    id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    data,
  });
  const cases: PromptAnchorCase[] = [
    {
      name: "the authenticated user's exact normalized prompt",
      messages: [feedEntry(valid.promptMessageId, promptMessage)],
      shouldTrigger: true,
    },
    {
      name: "an invented message ID",
      messages: [feedEntry("chat-somewhere-else", promptMessage)],
      shouldTrigger: false,
    },
    {
      name: "a legacy assistant row",
      messages: [feedEntry(valid.promptMessageId, assistantMessage)],
      shouldTrigger: false,
    },
    {
      name: "an assistant run row",
      messages: [feedEntry(valid.promptMessageId, runMessage)],
      shouldTrigger: false,
    },
    {
      name: "another collaborator's prompt",
      messages: [
        feedEntry(valid.promptMessageId, {
          ...promptMessage,
          senderId: "user_grace",
        }),
      ],
      shouldTrigger: false,
    },
    {
      name: "a prompt whose content differs",
      messages: [
        feedEntry(valid.promptMessageId, {
          ...promptMessage,
          content: "Design a different system",
        }),
      ],
      shouldTrigger: false,
    },
  ];

  for (const testCase of cases) {
    let triggerCount = 0;
    let rateLimitCount = 0;
    const idempotencyKeys: string[] = [];
    const reads: Array<{ roomId: string; feedId: string }> = [];
    const result = await startVerifiedAgentRun(
      parsedValid,
      "user_ada",
      {
        readFeedMessages: async (params) => {
          reads.push(params);
          return { data: testCase.messages };
        },
        consumeRequestSlot: async () => {
          rateLimitCount += 1;
          return true;
        },
        trigger: async (_payload, options) => {
          triggerCount += 1;
          idempotencyKeys.push(String(options.idempotencyKey));
          return { id: "run_verified" };
        },
      },
    );

    assert.deepEqual(
      reads,
      [{ roomId: valid.roomId, feedId: AI_CHAT_FEED_ID }],
      `${testCase.name}: reads only the authorized room feed`,
    );
    assert.equal(
      rateLimitCount,
      testCase.shouldTrigger ? 1 : 0,
      `${testCase.name}: only a verified prompt consumes quota`,
    );
    assert.equal(
      triggerCount,
      testCase.shouldTrigger ? 1 : 0,
      `${testCase.name}: trigger boundary`,
    );
    assert.deepEqual(
      result,
      testCase.shouldTrigger
        ? { status: "started", runId: "run_verified" }
        : { status: "unverified" },
      `${testCase.name}: result`,
    );
    assert.equal(
      idempotencyKeys[0]?.length ?? 0,
      testCase.shouldTrigger ? 64 : 0,
      `${testCase.name}: a global hashed idempotency key reaches Trigger`,
    );
  }

  const denied = await startVerifiedAgentRun(parsedValid, "user_ada", {
    readFeedMessages: async () => ({
      data: [feedEntry(valid.promptMessageId, promptMessage)],
    }),
    consumeRequestSlot: async () => false,
    trigger: async () => {
      throw new Error("rate-limited requests must not trigger");
    },
  });

  assert.deepEqual(denied, { status: "rate_limited" });

  const replayKeys: string[] = [];
  const replayDependencies = {
    readFeedMessages: async () => ({
      data: [feedEntry(valid.promptMessageId, promptMessage)],
    }),
    consumeRequestSlot: async () => true,
    trigger: async (
      _payload: unknown,
      options: { idempotencyKey: unknown },
    ) => {
      replayKeys.push(String(options.idempotencyKey));
      return { id: "run_original" };
    },
  };

  await startVerifiedAgentRun(parsedValid, "user_ada", replayDependencies);
  await startVerifiedAgentRun(parsedValid, "user_ada", replayDependencies);
  assert.equal(
    replayKeys[0],
    replayKeys[1],
    "the same verified prompt always addresses the same global Trigger run",
  );
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/ai/orchestrate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The public route must stop before every paid or persistent boundary on denial. */
async function checkRouteAuthorizationAndFailureBoundaries() {
  let starts = 0;
  let records = 0;
  const baseDependencies = {
    authorizeProject: async () => ({ ok: true as const, userId: "user_ada" }),
    startAgentRun: async () => {
      starts += 1;
      return { status: "started" as const, runId: "run_verified" };
    },
    recordTaskRun: async () => {
      records += 1;
    },
  };

  const denied = await handleOrchestratePost(request(valid), {
    ...baseDependencies,
    authorizeProject: async () => ({
      ok: false as const,
      response: Response.json({ error: "Forbidden" }, { status: 403 }),
    }),
  });
  assert.equal(denied.status, 403);
  assert.equal(starts, 0, "authorization denial prevents Trigger work");
  assert.equal(records, 0, "authorization denial prevents TaskRun writes");

  const unverified = await handleOrchestratePost(request(valid), {
    ...baseDependencies,
    startAgentRun: async () => ({ status: "unverified" as const }),
  });
  assert.equal(unverified.status, 400);
  assert.equal(records, 0, "an unverified prompt is never recorded");

  const rateLimited = await handleOrchestratePost(request(valid), {
    ...baseDependencies,
    startAgentRun: async () => ({ status: "rate_limited" as const }),
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get("retry-after"), "60");
  assert.equal(records, 0, "a rate-limited request is never recorded");

  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    const triggerFailure = await handleOrchestratePost(request(valid), {
      ...baseDependencies,
      startAgentRun: async () => {
        throw new Error("Trigger unavailable");
      },
    });
    assert.equal(triggerFailure.status, 502);
    assert.equal(records, 0, "a failed trigger has no run to record");

    const recordFailure = await handleOrchestratePost(request(valid), {
      ...baseDependencies,
      recordTaskRun: async () => {
        throw new Error("database unavailable");
      },
    });
    assert.equal(recordFailure.status, 502);
  } finally {
    console.error = originalConsoleError;
  }

  const success = await handleOrchestratePost(request(valid), baseDependencies);
  assert.equal(success.status, 202);
  assert.deepEqual(await success.json(), { runId: "run_verified" });
  assert.equal(records, 1, "one successful run is recorded once");
}

async function main() {
  checkOrchestrateRequestParsing();
  checkRunIdParsing();
  await checkPromptAnchorBeforeTriggering();
  await checkRouteAuthorizationAndFailureBoundaries();

  console.log("✅ Orchestrate API request parsing and prompt anchor verified");
}

void main();
