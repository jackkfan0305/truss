import assert from "node:assert/strict";

import type { AssistantEvent } from "../lib/assistant-chat";
import {
  applyAssistantEvent,
  ASSISTANT_LEAD_TASK_TITLE,
  selectAssistantTaskGroups,
  settleAssistantTurn,
  startAssistantTurn,
  type AssistantTurn,
} from "../lib/assistant-turn";

function fold(events: AssistantEvent[], turn: AssistantTurn = startAssistantTurn()): AssistantTurn {
  return events.reduce(applyAssistantEvent, turn);
}

// Reasoning deltas join one part; text deltas join the reply.
{
  const turn = fold([
    { type: "reasoning", text: "Three " },
    { type: "reasoning", text: "services." },
    { type: "text", text: "The " },
    { type: "text", text: "gateway." },
  ]);
  assert.equal(turn.parts.length, 1);
  assert.deepEqual(turn.parts[0], { type: "reasoning", id: "reasoning-0", text: "Three services." });
  assert.equal(turn.text, "The gateway.");
  const groups = selectAssistantTaskGroups(turn);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, ASSISTANT_LEAD_TASK_TITLE);
  assert.equal(groups[0].status, "running", "lead task runs while no tool has been called");
}

// Each tool call opens a task; reasoning after it joins that task.
{
  const turn = fold([
    { type: "text", text: "Let me look." },
    { type: "tool-start", id: "c1", label: "Reading diagram" },
    { type: "reasoning", text: "No queue yet." },
    { type: "tool-end", id: "c1", ok: true },
    { type: "tool-start", id: "c2", label: "Creating diagram" },
    { type: "tool-end", id: "c2", ok: true, label: "Created Checkout", href: "/editor/checkout-abc123" },
    { type: "text", text: "Done." },
  ]);
  assert.equal(turn.text, "Let me look.\n\nDone.", "text after a tool starts a new paragraph");
  const groups = selectAssistantTaskGroups(turn);
  assert.deepEqual(
    groups.map((group) => [group.title, group.status, group.href, group.reasoning.length]),
    [
      ["Reading diagram", "complete", undefined, 1],
      ["Created Checkout", "complete", "/editor/checkout-abc123", 0],
    ],
  );
}

// A failed tool result marks its task; settling resolves tools still running.
{
  const running = fold([
    { type: "tool-start", id: "c1", label: "Editing diagram" },
    { type: "tool-end", id: "c1", ok: false },
    { type: "tool-start", id: "c2", label: "Editing diagram" },
  ]);
  assert.equal(selectAssistantTaskGroups(running)[0].status, "error");
  assert.equal(selectAssistantTaskGroups(running)[1].status, "running");

  const stopped = settleAssistantTurn(running, { error: null, aborted: true });
  assert.equal(stopped.phase, "incomplete");
  assert.equal(selectAssistantTaskGroups(stopped)[1].status, "error");

  const failed = settleAssistantTurn(running, { error: "Stopped after 8 steps.", aborted: false });
  assert.equal(failed.phase, "error");
  assert.equal(failed.notice, "Stopped after 8 steps.");

  const done = settleAssistantTurn(fold([{ type: "reasoning", text: "x" }]), { error: null, aborted: false });
  assert.equal(done.phase, "complete");
  assert.equal(selectAssistantTaskGroups(done)[0].status, "complete", "the lead task settles with the turn");
}

console.log("verify-assistant-turn: ok");
