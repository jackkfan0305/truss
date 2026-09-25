import assert from "node:assert/strict";

import { agentRunId, startVerifiedAgentRun } from "../lib/agent-run-server";
import { handleOrchestratePost } from "../lib/orchestrate-route-handler";
import { parseOrchestrateRequest } from "../lib/orchestrate-requests";
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

interface PromptAnchorCase {
  name: string;
  messages: Array<{
    id: string;
    createdAt: number;
    updatedAt: number;
    data: unknown;
  }>;
  shouldStart: boolean;
}

/**
 * The prompt ID becomes trusted run metadata, so the route-side helper must
 * prove the exact authenticated human message before spending an orchestrator
 * run, which can spend two more behind it. Every denied fixture also asserts
 * that no quota was consumed.
 */
async function checkPromptAnchorBeforeStarting() {
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
      shouldStart: true,
    },
    {
      name: "an invented message ID",
      messages: [feedEntry("chat-somewhere-else", promptMessage)],
      shouldStart: false,
    },
    {
      name: "a legacy assistant row",
      messages: [feedEntry(valid.promptMessageId, assistantMessage)],
      shouldStart: false,
    },
    {
      name: "an assistant run row",
      messages: [feedEntry(valid.promptMessageId, runMessage)],
      shouldStart: false,
    },
    {
      name: "another collaborator's prompt",
      messages: [
        feedEntry(valid.promptMessageId, {
          ...promptMessage,
          senderId: "user_grace",
        }),
      ],
      shouldStart: false,
    },
    {
      name: "a prompt whose content differs",
      messages: [
        feedEntry(valid.promptMessageId, {
          ...promptMessage,
          content: "Design a different system",
        }),
      ],
      shouldStart: false,
    },
  ];

  const expectedRunId = agentRunId(
    "user_ada",
    valid.roomId,
    valid.promptMessageId,
  );

  for (const testCase of cases) {
    let rateLimitCount = 0;
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
      },
    );

    assert.deepEqual(
      reads,
      [{ roomId: valid.roomId, feedId: AI_CHAT_FEED_ID }],
      `${testCase.name}: reads only the authorized room feed`,
    );
    assert.equal(
      rateLimitCount,
      testCase.shouldStart ? 1 : 0,
      `${testCase.name}: only a verified prompt consumes quota`,
    );
    assert.equal(
      result.status,
      testCase.shouldStart ? "started" : "unverified",
      `${testCase.name}: result`,
    );

    if (result.status === "started") {
      assert.equal(result.runId, expectedRunId);
      assert.deepEqual(result.payload, {
        prompt: parsedValid.prompt,
        promptMessageId: parsedValid.promptMessageId,
        roomId: parsedValid.roomId,
        modelId: parsedValid.modelId,
        thinkingLevel: parsedValid.thinkingLevel,
      });
    }
  }

  const denied = await startVerifiedAgentRun(parsedValid, "user_ada", {
    readFeedMessages: async () => ({
      data: [feedEntry(valid.promptMessageId, promptMessage)],
    }),
    consumeRequestSlot: async () => false,
  });

  assert.deepEqual(denied, { status: "rate_limited" });

  // The run ID is what the TaskRun unique constraint dedupes replays on.
  assert.equal(
    agentRunId("user_ada", valid.roomId, valid.promptMessageId),
    expectedRunId,
    "the same verified prompt always addresses the same run",
  );
  assert.notEqual(
    agentRunId("user_ada", valid.roomId, "chat-another-prompt"),
    expectedRunId,
    "a different prompt gets a different run",
  );
  assert.notEqual(
    agentRunId("user_grace", valid.roomId, valid.promptMessageId),
    expectedRunId,
    "a different user gets a different run",
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
  let streams = 0;
  const payload = {
    prompt: valid.prompt,
    promptMessageId: valid.promptMessageId,
    roomId: valid.roomId,
    modelId: DEFAULT_AI_DESIGN_MODEL_ID,
    thinkingLevel: DEFAULT_AI_THINKING_LEVEL,
  };
  const baseDependencies = {
    authorizeProject: async () => ({ ok: true as const, userId: "user_ada" }),
    startAgentRun: async () => {
      starts += 1;
      return { status: "started" as const, runId: "run_verified", payload };
    },
    recordTaskRun: async () => {
      records += 1;
      return true;
    },
    streamRun: () => {
      streams += 1;
      return new Response("", { headers: { "X-Run-Id": "run_verified" } });
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
  assert.equal(starts, 0, "authorization denial prevents agent work");
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
    const startFailure = await handleOrchestratePost(request(valid), {
      ...baseDependencies,
      startAgentRun: async () => {
        throw new Error("Liveblocks unavailable");
      },
    });
    assert.equal(startFailure.status, 502);
    assert.equal(records, 0, "a failed start has no run to record");

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

  assert.equal(streams, 0, "no failure path runs the orchestrator");

  const replay = await handleOrchestratePost(request(valid), {
    ...baseDependencies,
    recordTaskRun: async () => false,
  });
  assert.equal(replay.status, 409);
  assert.equal(streams, 0, "a replayed prompt is not run twice");

  const success = await handleOrchestratePost(request(valid), baseDependencies);
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("X-Run-Id"), "run_verified");
  assert.equal(records, 1, "one successful run is recorded once");
  assert.equal(streams, 1, "one successful run is streamed once");
}

async function main() {
  checkOrchestrateRequestParsing();
  await checkPromptAnchorBeforeStarting();
  await checkRouteAuthorizationAndFailureBoundaries();

  console.log("✅ Orchestrate API request parsing and prompt anchor verified");
}

void main();
