import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";

import { AiInput } from "../components/chat/ai-input";
import {
  AI_DESIGN_MODELS,
  AI_THINKING_LEVELS,
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  MAX_CHAT_CONTENT_LENGTH,
} from "../types/tasks";

/**
 * The composer is the one control that locks, so its states have to be
 * legible without colour and without motion: an empty field is not sendable,
 * a run in flight is not interruptible, and both have to say so in words a
 * screen reader reaches.
 */
function composer(props: {
  value: string;
  status: "ready" | "working";
  isDisabled: boolean;
}): string {
  return renderToStaticMarkup(
    <AiInput.Root
      value={props.value}
      status={props.status}
      isDisabled={props.isDisabled}
      onValueChange={() => {}}
      onSubmit={() => {}}
    >
      <AiInput.Field
        placeholder="Ask about the system…"
        aria-label="Ask about the system"
      />
      <AiInput.Toolbar>
        <AiInput.Pill label="Gemini 3.6 Flash" detail="High effort" onClick={() => {}} />
        <AiInput.Spacer />
        <AiInput.Submit />
      </AiInput.Toolbar>
    </AiInput.Root>,
  );
}

function checkAnEmptyFieldCannotSend() {
  const html = composer({ value: "", status: "ready", isDisabled: false });

  assert.match(html, /<button[^>]*disabled/, "submit is disabled with no text");
  assert.ok(html.includes("Send message"), "the control still names itself");
}

function checkTextMakesItSendable() {
  const html = composer({
    value: "Should the gateway own retries?",
    status: "ready",
    isDisabled: false,
  });

  assert.doesNotMatch(
    html,
    /aria-label="Send message"[^>]*disabled/,
    "submit is live once there is text",
  );
}

/**
 * The third state the source doc describes is a stop button, and this app has
 * no cancel route to honour it. A working indicator that looked pressable
 * would be a promise the backend cannot keep.
 */
function checkAWorkingRunShowsANonInteractiveIndicator() {
  const html = composer({ value: "text", status: "working", isDisabled: true });

  assert.match(html, /<button[^>]*disabled/, "the control does not invite a press");
  assert.ok(html.includes('aria-busy="true"'), "the busy state is announced");
  assert.ok(html.includes("Agent is working"), "the state reads as words");
  assert.ok(!html.includes("Stop"), "no stop affordance this app cannot honour");
}

/** The field is bounded by the same limit the feed enforces. */
function checkTheFieldCarriesTheContentLimit() {
  const html = composer({ value: "", status: "ready", isDisabled: false });

  assert.match(
    html,
    new RegExp(`maxlength="${MAX_CHAT_CONTENT_LENGTH}"`, "i"),
    "the field cannot outgrow what the feed accepts",
  );
}

/** One pill, both settings — no second bordered control inside the composer. */
function checkTheToolbarCarriesOnePill() {
  const html = composer({ value: "", status: "ready", isDisabled: false });
  const pills = html.match(/data-composer-pill/g) ?? [];

  assert.equal(pills.length, 1, "exactly one settings pill");
  assert.ok(html.includes("Gemini 3.6 Flash"), "the model is the pill's label");
  assert.ok(html.includes("High effort"), "the effort is the pill's detail");
}

/** Both settings still reach the composer, so neither picker was lost. */
function checkBothSettingsAreStillOffered() {
  const source = readFileSync(
    new URL("../components/chat/ai-input-settings.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /AI_DESIGN_MODELS/, "models are offered");
  assert.match(source, /AI_THINKING_LEVELS/, "thinking levels are offered");
  assert.ok(AI_DESIGN_MODELS.length > 0 && AI_THINKING_LEVELS.length > 0);
  assert.ok(DEFAULT_AI_DESIGN_MODEL_ID.length > 0);
  assert.ok(DEFAULT_AI_THINKING_LEVEL.length > 0);
}

/**
 * The field grows to five rows and then scrolls. Past that it must hold its
 * height, or a long prompt pushes the send control out of the panel.
 */
function checkTheFieldStopsGrowingAtFiveRows() {
  const source = readFileSync(
    new URL("../components/chat/ai-input.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /MAX_FIELD_ROWS = 5/, "the ceiling is five rows");
  assert.match(source, /overflowY/, "the field scrolls its own content past it");
}

checkAnEmptyFieldCannotSend();
checkTextMakesItSendable();
checkAWorkingRunShowsANonInteractiveIndicator();
checkTheFieldCarriesTheContentLimit();
checkTheToolbarCarriesOnePill();
checkBothSettingsAreStillOffered();
checkTheFieldStopsGrowingAtFiveRows();
console.log("✅ chat composer checks passed");
