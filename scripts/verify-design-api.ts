import assert from "node:assert/strict";

import { parseDesignRequest, parseRunId } from "../lib/design-requests";
import {
  AI_DESIGN_MODELS,
  AI_THINKING_LEVELS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
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

function checkDesignRequestParsing() {
  assert.deepEqual(parseDesignRequest(valid), parsedValid, "valid request");

  assert.deepEqual(
    parseDesignRequest({
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
    parseDesignRequest({ ...valid, roomId: "someone-elses-room" }),
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
      parseDesignRequest(body),
      null,
      `rejected: ${JSON.stringify(body)}`,
    );
  }

  // Every model the composer can offer must survive the round trip, or the
  // picker would show an option that 400s on send.
  for (const model of AI_DESIGN_MODELS) {
    assert.deepEqual(
      parseDesignRequest({ ...valid, modelId: model.id }),
      { ...parsedValid, modelId: model.id },
      `accepts offered model: ${model.id}`,
    );
  }

  // And every effort level, against every model — the two pickers are
  // independent, so any pair the composer can produce has to be accepted.
  for (const level of AI_THINKING_LEVELS) {
    assert.deepEqual(
      parseDesignRequest({ ...valid, thinkingLevel: level.id }),
      { ...parsedValid, thinkingLevel: level.id },
      `accepts offered effort: ${level.id}`,
    );

    for (const model of AI_DESIGN_MODELS) {
      assert.deepEqual(
        parseDesignRequest({
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
    parseDesignRequest({ ...valid, prompt: "x".repeat(2000) }),
    "prompt at the limit",
  );
  assert.ok(
    parseDesignRequest({ ...valid, promptMessageId: "x".repeat(256) }),
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

checkDesignRequestParsing();
checkRunIdParsing();

console.log("✅ Design API request parsing verified");
