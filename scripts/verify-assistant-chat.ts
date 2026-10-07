import assert from "node:assert/strict";

import { APICallError, RetryError } from "ai";

import { buildAssistantInstructions, describeAssistantError, isToolOutputOk, runAssistantTurn } from "../lib/assistant-chat";
import { AWS_CATALOG } from "../lib/aws-catalog";
import { AssistantStopError, type AssistantActions } from "../lib/assistant-tools";

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
  // Replies render as sanitized markdown, so the prompt allows it.
  assert.doesNotMatch(withGraph, /no markdown/);
  assert.match(withGraph, /concise markdown/);

  // Every catalog ID comes from the shared catalog; the prompt has no list of its own.
  for (const { id } of AWS_CATALOG) assert.ok(withGraph.includes(id), id);
  assert.match(withGraph, /get_aws_catalog/);
  assert.match(withGraph, /relative to their parent, or the canvas for roots/);
  assert.match(withGraph, /opaque items and their absolute bounds as obstacles/);
  assert.match(withGraph, /read again and revise the edit against the new graph/);
  assert.match(withGraph, /item IDs/);
  assert.doesNotMatch(withGraph, /Omit x and y for new blocks\. Keep x and y unchanged/);
}

// A failed or conflicted tool result marks its task row failed, not done.
assert.equal(isToolOutputOk({ applied: true, url: "/editor/x" }), true);
assert.equal(isToolOutputOk({ diagramId: "x", url: "/editor/x" }), true);
assert.equal(isToolOutputOk({ error: "Truss rejected the request." }), false);
assert.equal(isToolOutputOk({ conflict: "Stale fingerprint. Read the diagram again." }), false);
assert.equal(isToolOutputOk(undefined), true);

async function checkAbortDuringInitialRead() {
  const controller = new AbortController();
  let finishRead!: () => void;
  let readSignal: AbortSignal | undefined;
  let reads = 0;
  const actions: AssistantActions = {
    getDiagram: async ({ signal }) => {
      reads++;
      readSignal = signal;
      await new Promise<void>((resolve) => { finishRead = resolve; });
      return { error: "unavailable" };
    },
    getAwsCatalog: async () => { throw new Error("Stopped turn read the catalog"); },
    listDiagrams: async () => { throw new Error("Stopped turn called a tool"); },
    applyDiagramEdit: async () => { throw new Error("Stopped turn edited a diagram"); },
    createDiagram: async () => { throw new Error("Stopped turn created a diagram"); },
  };
  const options = {
    apiKey: "unused", modelId: "unused", diagramId: "test", history: [],
    userText: "Draw a queue", actions, signal: controller.signal,
    onEvent: () => { throw new Error("Stopped turn started streaming"); },
  };
  const pending = runAssistantTurn(options);
  assert.equal(reads, 1);
  controller.abort();
  assert.equal(readSignal?.aborted, true);
  finishRead();
  assert.deepEqual(await pending, {
    history: [{ role: "user", content: "Draw a queue" }], error: null,
  });
  await runAssistantTurn(options);
  assert.equal(reads, 1, "An already stopped turn must not even read the diagram");
}

checkAbortDuringInitialRead().then(() => console.log("verify-assistant-chat: ok"));
