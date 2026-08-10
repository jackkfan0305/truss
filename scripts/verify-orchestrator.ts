import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ModelMessage, ToolResultPart } from "ai";

import { createAiRunChatPublisher, resolveAiChatRunId } from "../lib/ai-run-chat";
import {
  FALLBACK_CLOSING,
  createSequentialReadsProvider,
  describeDesignOutcome,
  describeSpecOutcome,
  runOrchestratorLoop,
  specIdForTurn,
  toToolResult,
  type OrchestratorModelTurn,
  type OrchestratorToolCall,
} from "../lib/orchestrator-loop";
import {
  DESIGN_TOOL_NAME,
  MAX_ORCHESTRATOR_STEPS,
  ORCHESTRATOR_SYSTEM_PROMPT,
  SPEC_TOOL_NAME,
  buildOrchestratorPrompt,
} from "../lib/orchestrator-prompt";
import type { AiChatMessage } from "../types/tasks";

/**
 * The orchestrator's two silent failure modes (35-orchestrator-backend).
 *
 * A routing regression is invisible in review: a prompt that stops describing
 * the no-tool case still produces a run, it just edits the canvas when the user
 * asked a question — and a wrong canvas edit is the expensive mistake this
 * design exists to avoid. A loop regression is worse: an unbounded loop is
 * unbounded paid model calls, and a subagent failure that throws instead of
 * becoming a tool result ends the turn with no message at all.
 *
 * Routing *behaviour* is deliberately not asserted here. Whether "is this a
 * bottleneck?" answers in words is a property of the model plus the prompt, and
 * only a real run against a real room can tell you.
 */

function turn(
  text: string,
  toolCalls: OrchestratorToolCall[] = []
): OrchestratorModelTurn {
  return {
    text,
    toolCalls,
    responseMessages: [{ role: "assistant", content: text || "…" }],
  };
}

function call(toolName: string, id = "call-1"): OrchestratorToolCall {
  return { toolCallId: id, toolName, input: {} };
}

const okResult = (call: OrchestratorToolCall): ToolResultPart =>
  toToolResult(call, { ok: true });

function checkThePromptNamesEveryRoute() {
  // Both tools, by the exact names the tool set registers. A prompt that names
  // a tool the loop does not expose produces a hallucinated call the runner
  // answers with "Unknown tool".
  assert.ok(
    ORCHESTRATOR_SYSTEM_PROMPT.includes(DESIGN_TOOL_NAME),
    "the prompt names the design tool",
  );
  assert.ok(
    ORCHESTRATOR_SYSTEM_PROMPT.includes(SPEC_TOOL_NAME),
    "the prompt names the spec tool",
  );

  // The no-tool case, which is the whole point of the orchestrator: before it,
  // every message produced a canvas edit because a canvas edit was the only
  // thing the system could do.
  assert.match(
    ORCHESTRATOR_SYSTEM_PROMPT,
    /Answer yourself, calling no tool/,
    "the prompt describes answering without a tool",
  );
  assert.match(
    ORCHESTRATOR_SYSTEM_PROMPT,
    /Suggesting a change is not making one\./,
    "critique is explicitly not an edit",
  );
  assert.match(
    ORCHESTRATOR_SYSTEM_PROMPT,
    /question that merely mentions a component is not a request to change it\./,
    "the trap case is named",
  );

  // Asking is a normal turn outcome, and it is the guard against a misrouted
  // destructive edit.
  assert.match(
    ORCHESTRATOR_SYSTEM_PROMPT,
    /When you are genuinely unsure which the user meant, ask them\./,
  );

  // One tool per step. Two concurrent design runs read the same pre-state and
  // stack their nodes; a spec written during a design documents a half-drawn
  // diagram.
  assert.match(ORCHESTRATOR_SYSTEM_PROMPT, /Use one tool at a time\./);

  // The design brief is written by the orchestrator, because it is the only
  // component holding both the canvas and the conversation.
  assert.match(
    ORCHESTRATOR_SYSTEM_PROMPT,
    /self-contained design brief that you write/,
  );
  assert.doesNotMatch(
    ORCHESTRATOR_SYSTEM_PROMPT,
    /cannot see (?:this conversation|the canvas)/,
    "the routing prompt must describe the context the inline design runner receives",
  );
}

function checkThePromptCarriesTheRoom() {
  const history: AiChatMessage[] = [
    { role: "user", content: "Add a cache", senderId: "u1", senderName: "Ada", sentAt: 0 },
  ];
  const built = buildOrchestratorPrompt({
    context: { nodes: [], edges: [] },
    history,
    prompt: "is that a bottleneck?",
  });

  assert.match(built, /The canvas is empty\./);
  assert.match(built, /Ada: Add a cache/);
  assert.match(built, /The user just said: is that a bottleneck\?/);

  // The request is read last, after everything it might refer to.
  assert.ok(
    built.indexOf("The user just said") > built.indexOf("Ada: Add a cache"),
    "the request is the last thing read",
  );
}

async function checkTheLoopStopsWhenTheModelStops() {
  let calls = 0;
  const messages: ModelMessage[] = [{ role: "user", content: "hello" }];
  const result = await runOrchestratorLoop(messages, {
    callModel: async () => {
      calls += 1;
      return turn("A queue would decouple those two.");
    },
    runTool: async () => {
      throw new Error("no tool should run");
    },
  });

  assert.equal(calls, 1, "a plain answer costs exactly one model call");
  assert.equal(result.steps, 1);
  assert.equal(result.didHitStepCap, false);
  assert.equal(result.text, "A queue would decouple those two.");
}

async function checkTheLoopStopsAtTheStepCap() {
  let calls = 0;
  let tools = 0;
  const messages: ModelMessage[] = [{ role: "user", content: "hello" }];

  // A model that calls a tool forever. Without the cap this never returns, and
  // every iteration is a paid call.
  const result = await runOrchestratorLoop(messages, {
    callModel: async () => {
      calls += 1;
      return turn("", [call(DESIGN_TOOL_NAME, `call-${calls}`)]);
    },
    runTool: async (toolCall) => {
      tools += 1;
      return okResult(toolCall);
    },
  });

  assert.equal(calls, MAX_ORCHESTRATOR_STEPS, "the cap bounds the model calls");
  assert.equal(tools, MAX_ORCHESTRATOR_STEPS, "and the work behind them");
  assert.equal(result.steps, MAX_ORCHESTRATOR_STEPS);
  assert.equal(result.didHitStepCap, true, "the cap is reported, not hidden");

  // A terminal state, not an error: the tools already ran, and an empty bubble
  // would be dropped by `parseAiChatMessage` entirely.
  assert.equal(result.text, FALLBACK_CLOSING);

  // An explicit cap overrides, so the constant is a default and not a wall.
  const shorter = await runOrchestratorLoop([{ role: "user", content: "x" }], {
    callModel: async () => turn("", [call(DESIGN_TOOL_NAME)]),
    runTool: async (toolCall) => okResult(toolCall),
    maxSteps: 2,
  });

  assert.equal(shorter.steps, 2);
}

async function checkAnAnswerSurvivesALaterSilentStep() {
  let calls = 0;
  const result = await runOrchestratorLoop([{ role: "user", content: "x" }], {
    callModel: async () => {
      calls += 1;
      return calls === 1
        ? turn("Added the cache.", [call(DESIGN_TOOL_NAME)])
        : turn("");
    },
    runTool: async (toolCall) => okResult(toolCall),
  });

  assert.equal(
    result.text,
    "Added the cache.",
    "a later empty turn does not erase the answer the user is waiting on",
  );
}

async function checkToolResultsAreFedBackToTheModel() {
  const seen: ModelMessage[][] = [];
  let calls = 0;

  await runOrchestratorLoop([{ role: "user", content: "design it" }], {
    callModel: async (messages) => {
      seen.push([...messages]);
      calls += 1;
      return calls === 1 ? turn("", [call(DESIGN_TOOL_NAME)]) : turn("Done it.");
    },
    runTool: async (toolCall) =>
      toToolResult(toolCall, { ok: true, summary: "Added a cache" }),
  });

  assert.equal(seen.length, 2, "the model is asked again after the tool ran");

  const second = seen[1];
  const toolMessage = second.at(-1);

  assert.equal(toolMessage?.role, "tool", "the tool result is the last thing read");
  assert.match(
    JSON.stringify(toolMessage),
    /Added a cache/,
    "and it carries what the subagent reported",
  );
}

/**
 * A failed subagent must reach the model as a value it can explain. `.unwrap()`
 * would throw here, which ends the turn with no assistant message — the user
 * asked for a cache, got neither a cache nor a sentence, and the run shows as
 * an error nobody reads.
 */
async function checkAFailedSubagentBecomesAToolResult() {
  const designed = describeDesignOutcome({ ok: false, error: new Error("boom") });
  const spec = describeSpecOutcome({ ok: false, error: new Error("boom") });

  assert.equal(designed.ok, false);
  assert.match(String(designed.error), /did not complete/);
  // Partial builds are reported, never rolled back: the design agent writes
  // incrementally, so "the canvas is unchanged" is not a claim this can make.
  assert.match(String(designed.error), /may already be on the canvas/);

  assert.equal(spec.ok, false);
  assert.match(String(spec.error), /nothing on the canvas or in the conversation/);

  assert.deepEqual(
    describeDesignOutcome({ ok: true, output: { summary: "Added a cache", applied: 3 } }),
    { ok: true, summary: "Added a cache", changesApplied: 3 },
  );
  assert.deepEqual(
    describeSpecOutcome({
      ok: true,
      output: { specId: "run_abc", fileName: "spec-2026-08-09-14-32.md" },
    }),
    { ok: true, fileName: "spec-2026-08-09-14-32.md" },
  );

  // And the loop keeps going rather than throwing out of the turn.
  let calls = 0;
  const result = await runOrchestratorLoop([{ role: "user", content: "x" }], {
    callModel: async () => {
      calls += 1;
      return calls === 1
        ? turn("", [call(DESIGN_TOOL_NAME)])
        : turn("That did not go through — the canvas may be partly updated.");
    },
    runTool: async (toolCall) =>
      toToolResult(toolCall, describeDesignOutcome({ ok: false })),
  });

  assert.match(result.text, /did not go through/);
  assert.equal(result.didHitStepCap, false);
}

/**
 * One user prompt, one assistant message. A subagent that opened its own row
 * would split a turn in two, and one that resolved an empty parent ID to
 * `chat-` would collide with every other such run in the room.
 */
async function checkChatRunIdSelectsTheParentRow() {
  assert.equal(resolveAiChatRunId("run_parent", "run_own"), "run_parent");
  assert.equal(resolveAiChatRunId(undefined, "run_own"), "run_own");
  assert.equal(resolveAiChatRunId("", "run_own"), "run_own", "empty is not a parent");

  const written: string[] = [];
  const publisher = createAiRunChatPublisher({
    roomId: "room",
    runId: resolveAiChatRunId("run_parent", "run_own"),
    promptMessageId: "chat-prompt",
    write: async (_roomId, messageId) => {
      written.push(messageId);
    },
    schedule: () => undefined,
    cancel: () => {},
    now: () => 0,
  });

  await publisher.start();
  await publisher.finish("complete", "Added a cache.");

  assert.deepEqual(
    new Set(written),
    new Set(["chat-run_parent"]),
    "a delegated run writes into the parent's row and no other",
  );
}

/** Text deltas grow the message; they are not steps in its work log. */
async function checkStreamedTextGrowsTheMessageInPlace() {
  const snapshots: Array<{ content: string; parts: number }> = [];
  const publisher = createAiRunChatPublisher({
    roomId: "room",
    runId: "run_own",
    promptMessageId: "chat-prompt",
    write: async (_roomId, _messageId, message) => {
      snapshots.push({
        content: message.content,
        parts: message.run?.activity.length ?? 0,
      });
    },
    // Synchronous scheduling, so a flush is observable without a timer.
    schedule: (callback) => {
      void callback();
      return undefined;
    },
    cancel: () => {},
    now: () => 0,
  });

  await publisher.start();
  publisher.appendContent("A queue ");
  publisher.appendContent("would help.");
  await publisher.flush();

  const latest = snapshots.at(-1);

  assert.equal(latest?.content, "A queue would help.");
  assert.equal(
    latest?.parts,
    0,
    "the answer is the message, not an activity part — otherwise it prints twice",
  );
}

/**
 * Two specs in one turn must be two documents.
 *
 * `saveSpec` overwrites its blob and upserts its row on purpose — that is what
 * makes a retried attempt idempotent. It also means a second spec reusing the
 * first's ID destroys it, and the turn would report two written while the
 * project holds one. That could not happen while each call was its own run, so
 * it is new with the inline path and invisible without a check.
 */
function checkEachSpecOfATurnGetsItsOwnId() {
  const runId = "run_abc123";

  assert.equal(
    specIdForTurn(runId, 0),
    runId,
    "the first spec of a turn is stored under the run that produced it",
  );

  const ids = [0, 1, 2].map((written) => specIdForTurn(runId, written));

  assert.equal(
    new Set(ids).size,
    ids.length,
    "a turn that writes three specs must produce three distinct documents",
  );
}

/** The initial room read is reusable once; later tools must observe prior writes. */
async function checkLaterToolsRefreshTheirCanvasRead() {
  let refreshes = 0;
  const getReads = createSequentialReadsProvider(
    { context: { nodes: ["initial"] }, history: ["prompt"] },
    async () => {
      refreshes += 1;
      return {
        context: { nodes: [`fresh-${refreshes}`] },
        history: ["prompt"],
      };
    },
  );

  assert.deepEqual((await getReads()).context.nodes, ["initial"]);
  assert.deepEqual((await getReads()).context.nodes, ["fresh-1"]);
  assert.deepEqual((await getReads()).context.nodes, ["fresh-2"]);
  assert.equal(refreshes, 2, "every tool after the first obtains a new snapshot");
}

/**
 * The whole point of the inline path: nothing in a turn may suspend the run.
 *
 * A `triggerAndWait` reintroduced here costs a child boot plus a restore of this
 * run — about 90 seconds on the measured spec turn — and it is a one-line change
 * that would read as perfectly normal in review.
 */
function checkNothingInATurnSuspendsTheRun() {
  const source = readFileSync(
    new URL("../trigger/orchestrator.ts", import.meta.url),
    "utf8",
  );

  // The call form, not the bare word: the task comment explains at length why
  // `triggerAndWait` is gone, and a check that cannot tell prose from code
  // would fail on its own documentation.
  assert.doesNotMatch(
    source,
    /\btasks\s*\.\s*(?:batch)?[tT]riggerAndWait/,
    "tools run in this process; waiting on a child run checkpoints the turn",
  );
  assert.match(
    source,
    /await runSpec\(/,
    "the spec is written by calling runSpec, not by triggering generate-spec",
  );
  assert.match(source, /await runDesign\(/);
}

async function main() {
  checkThePromptNamesEveryRoute();
  checkThePromptCarriesTheRoom();
  checkEachSpecOfATurnGetsItsOwnId();
  await checkLaterToolsRefreshTheirCanvasRead();
  checkNothingInATurnSuspendsTheRun();
  await checkTheLoopStopsWhenTheModelStops();
  await checkTheLoopStopsAtTheStepCap();
  await checkAnAnswerSurvivesALaterSilentStep();
  await checkToolResultsAreFedBackToTheModel();
  await checkAFailedSubagentBecomesAToolResult();
  await checkChatRunIdSelectsTheParentRow();
  await checkStreamedTextGrowsTheMessageInPlace();

  console.log(
    "✅ Orchestrator routing prompt, loop bounds, subagent failure handling and chat row ownership verified",
  );
}

main().catch((error: unknown) => {
  console.error("❌ Orchestrator verification failed");
  console.error(error);
  process.exitCode = 1;
});
