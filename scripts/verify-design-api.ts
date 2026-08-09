import assert from "node:assert/strict";

import { parseDesignRequest, parseRunId } from "../lib/design-requests";
import { AI_DESIGN_MODELS, DEFAULT_AI_DESIGN_MODEL_ID } from "../types/tasks";

const valid = {
  prompt: "Design a checkout flow",
  projectId: "checkout-flow-a1b2",
  roomId: "checkout-flow-a1b2",
};

/** What a body without a `modelId` must parse to: the request plus the default. */
const parsedValid = { ...valid, modelId: DEFAULT_AI_DESIGN_MODEL_ID };

function checkDesignRequestParsing() {
  assert.deepEqual(parseDesignRequest(valid), parsedValid, "valid request");

  assert.deepEqual(
    parseDesignRequest({ ...valid, prompt: "  Design a checkout flow  " }),
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
    { ...valid, projectId: "" },
    { ...valid, projectId: 7, roomId: 7 },
    { prompt: valid.prompt, projectId: valid.projectId },
    { prompt: valid.prompt, roomId: valid.roomId },
    // A model the picker does not offer. Forwarding it would spend a run on a
    // model nobody chose, so the request is refused rather than defaulted.
    { ...valid, modelId: "gemini-2.5-flash" },
    { ...valid, modelId: "" },
    { ...valid, modelId: 42 },
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
      { ...valid, modelId: model.id },
      `accepts offered model: ${model.id}`,
    );
  }

  // The ceiling is inclusive — the boundary is the value most likely to drift.
  assert.ok(
    parseDesignRequest({ ...valid, prompt: "x".repeat(2000) }),
    "prompt at the limit",
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
