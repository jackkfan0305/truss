import assert from "node:assert/strict";

import { APICallError, RetryError } from "ai";

import { buildAssistantInstructions, describeAssistantError } from "../lib/assistant-chat";
import { AssistantStopError } from "../lib/assistant-tools";

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `status ${statusCode}`,
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
  });
}

// Review focus 2: a revoked key clears the stored key.
assert.deepEqual(describeAssistantError(apiError(401)), {
  message: "OpenRouter disconnected, connect again.",
  clearKey: true,
});
assert.deepEqual(describeAssistantError(apiError(402)), {
  message: "Your OpenRouter account is out of credits.",
  clearKey: false,
});
assert.deepEqual(describeAssistantError(apiError(429)), {
  message: "Rate limited by OpenRouter. Free models have tight limits, try again or pick a paid model.",
  clearKey: false,
});
// The SDK wraps retried failures in RetryError.
assert.deepEqual(
  describeAssistantError(
    new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [apiError(429)] }),
  ),
  {
    message: "Rate limited by OpenRouter. Free models have tight limits, try again or pick a paid model.",
    clearKey: false,
  },
);
assert.deepEqual(describeAssistantError(new AssistantStopError("Sign in again to edit this diagram.")), {
  message: "Sign in again to edit this diagram.",
  clearKey: false,
});
assert.equal(describeAssistantError(new DOMException("aborted", "AbortError")), null);
assert.equal(describeAssistantError(apiError(500))?.clearKey, false);

// The open diagram's graph grounds the prompt; a failed read still yields a prompt.
{
  const withGraph = buildAssistantInstructions("checkout-abc123", {
    graph: { version: 1, nodes: [{ id: "web" }], edges: [] },
    fingerprint: "f1",
  });
  assert.match(withGraph, /checkout-abc123/);
  assert.match(withGraph, /"id":"web"/);
  assert.match(withGraph, /f1/);
  const withoutGraph = buildAssistantInstructions("checkout-abc123", { error: "x" });
  assert.match(withoutGraph, /could not be read/);
}

console.log("verify-assistant-chat: ok");
