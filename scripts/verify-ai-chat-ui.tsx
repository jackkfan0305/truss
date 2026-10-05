import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";

import { AiRunTasks } from "../components/editor/ai-run-tasks";
import { ChatEntry } from "../components/editor/chat-entry";
import type { AssistantTurn } from "../lib/assistant-turn";

const render = (node: React.ReactNode) => renderToStaticMarkup(node);

const TASK_TURN: AssistantTurn = {
  phase: "running",
  text: "",
  notice: null,
  parts: [
    { type: "tool", id: "c1", label: "Reading diagram", status: "complete" },
    { type: "reasoning", id: "reasoning-1", text: "Three services, no queue." },
    { type: "tool", id: "c2", label: "Editing diagram", status: "running" },
    { type: "reasoning", id: "reasoning-3", text: "Adding the queue." },
  ],
};

/** Each tool call is a task, and the reasoning after it lands under it. */
function checkEachToolCallBecomesATask() {
  const html = render(<AiRunTasks turn={TASK_TURN} />);

  assert.match(html, /data-slot="collapsible"/, "AI Elements Task frames the work log");
  assert.ok(html.includes("Reading diagram"));
  assert.ok(html.includes("Editing diagram"));
  assert.match(html, /lucide-check/, "a finished tool shows a check");
  assert.match(html, /lucide-loader-circle|lucide-loader2/, "a running tool shows a spinner");
}

/** Only the newest part of a live turn may claim to be thinking. */
function checkOnlyTheNewestThoughtIsStillThinking() {
  const html = render(<AiRunTasks turn={TASK_TURN} />);

  assert.equal(html.match(/>Thinking</g)?.length, 1, "exactly one part of a live turn is thinking");
  assert.match(html, /Thought process/, "the settled thought keeps its disclosure label");

  const afterTool = render(
    <AiRunTasks
      turn={{
        ...TASK_TURN,
        parts: [...TASK_TURN.parts, { type: "tool", id: "c3", label: "Reading diagram", status: "running" }],
      }}
    />,
  );
  assert.doesNotMatch(afterTool, />Thinking</, "a thought the model moved on from is not still thinking");
}

/** The running task is the one announcing element. */
function checkExactlyOneElementAnnouncesTheStep() {
  const html = render(<AiRunTasks turn={TASK_TURN} />);
  assert.equal(html.match(/aria-live="polite"/g)?.length, 1);
  const finished = render(<AiRunTasks turn={{ ...TASK_TURN, phase: "complete" }} />);
  assert.doesNotMatch(finished, /aria-live="polite"/, "nothing announces a finished turn");
}

/** A tool row with nothing inside is a row, not a control that opens onto nothing. */
function checkAnEmptyTaskIsARow() {
  const html = render(
    <AiRunTasks
      turn={{
        ...TASK_TURN,
        phase: "complete",
        parts: [{ type: "tool", id: "c1", label: "Created Checkout", href: "/editor/checkout-abc123", status: "complete" }],
      }}
    />,
  );
  assert.doesNotMatch(html, /<button/);
  assert.match(html, /<a [^>]*href="\/editor\/checkout-abc123"[^>]*>Created Checkout<\/a>/);
}

function checkACompletedTurnWithNoToolsRendersNothing() {
  const html = render(<AiRunTasks turn={{ phase: "complete", text: "Hi", notice: null, parts: [] }} />);
  assert.equal(html, "", "no empty disclosure is left behind");
}

/** The waiting state shows the orb and Thinking until the first word arrives. */
function checkTheWaitingStateHasAnOrb() {
  const waiting = render(<AiRunTasks turn={{ phase: "running", text: "", notice: null, parts: [] }} />);
  assert.match(waiting, /role="status"/);
  assert.match(waiting, />Thinking</);
}

/** Errors show verbatim; a stopped turn says it stopped, and keeps its work. */
function checkOutcomes() {
  const failed = render(
    <ol>
      <ChatEntry
        message={{
          id: "a1",
          role: "assistant",
          sentAt: 0,
          turn: { ...TASK_TURN, phase: "error", notice: "Your OpenRouter account is out of credits." },
        }}
      />
    </ol>,
  );
  assert.match(failed, /role="alert"[^>]*>.*Your OpenRouter account is out of credits\./);

  const stopped = render(
    <ol>
      <ChatEntry message={{ id: "a2", role: "assistant", sentAt: 0, turn: { ...TASK_TURN, phase: "incomplete" } }} />
    </ol>,
  );
  assert.match(stopped, /Stopped before finishing\./);
  assert.match(stopped, /Editing diagram/, "a stopped turn's partial work is still shown");
}

/** An assistant answer is markdown, and it renders as elements. */
function checkAssistantContentRendersAsMarkdown() {
  const html = render(
    <ol>
      <ChatEntry
        message={{
          id: "a3",
          role: "assistant",
          sentAt: 0,
          turn: { phase: "complete", text: "The **gateway** owns retries.", notice: null, parts: [] },
        }}
      />
    </ol>,
  );
  assert.ok(html.includes("<strong"), "emphasis is a real element");
  assert.ok(!html.includes("**"), "no literal markdown reaches the reader");
}

/** A user prompt is plain text in its bubble, never markdown or markup. */
function checkUserPromptStaysPlainText() {
  const html = render(
    <ol>
      <ChatEntry message={{ id: "u1", role: "user", sentAt: 0, content: "**hi** <b>x</b>" }} />
    </ol>,
  );
  assert.ok(html.includes("**hi** &lt;b&gt;x&lt;/b&gt;"));
}

/** The streaming flag reaches Response, so the tail repair and reveal engage. */
function checkChatEntryForwardsStreamingState() {
  const source = readFileSync(new URL("../components/editor/chat-entry.tsx", import.meta.url), "utf8");
  assert.match(source, /turn\.phase\s*===\s*"running"/);
  assert.match(source, /<Response[\s\S]*?isStreaming=\{isStreaming\}/);
}

checkEachToolCallBecomesATask();
checkOnlyTheNewestThoughtIsStillThinking();
checkExactlyOneElementAnnouncesTheStep();
checkAnEmptyTaskIsARow();
checkACompletedTurnWithNoToolsRendersNothing();
checkTheWaitingStateHasAnOrb();
checkOutcomes();
checkAssistantContentRendersAsMarkdown();
checkUserPromptStaysPlainText();
checkChatEntryForwardsStreamingState();
console.log("✅ ai-chat transcript markup checks passed");
