import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { AiChatComposer } from "../components/chat/ai-chat-composer";
import {
  DEFAULT_AI_DESIGN_MODEL_ID,
  DEFAULT_AI_THINKING_LEVEL,
  MAX_CHAT_CONTENT_LENGTH,
} from "../types/tasks";

function composer(draft: string, isWorking = false, isDisabled = isWorking): string {
  return renderToStaticMarkup(
    <AiChatComposer
      draft={draft}
      isDisabled={isDisabled}
      isWorking={isWorking}
      modelId={DEFAULT_AI_DESIGN_MODEL_ID}
      thinkingLevel={DEFAULT_AI_THINKING_LEVEL}
      onDraftChange={() => {}}
      onModelChange={() => {}}
      onThinkingLevelChange={() => {}}
      onSubmit={async () => {}}
    />,
  );
}

function submitTag(html: string, label: string): string {
  const tag = (html.match(/<button[^>]*>/g) ?? []).find((candidate) =>
    candidate.includes(`aria-label="${label}"`),
  );
  assert.ok(tag, `${label} button exists`);
  return tag;
}

const ready = composer("Build a queue");
const working = composer("Build a queue", true);
const empty = composer("");
const connecting = composer("", false, true);

assert.doesNotMatch(ready, /data-beam=/, "idle composer has no outer beam container");
assert.match(working, /data-beam=/, "working composer retains the border beam");
assert.match(ready, /aria-label="Send message"/);
assert.match(working, /aria-label="Agent is working"/);
assert.doesNotMatch(working, /aria-label="Stop"/);
assert.match(working, /aria-busy="true"/);
assert.match(submitTag(working, "Agent is working"), /disabled=""/);
assert.match(submitTag(empty, "Send message"), /disabled=""/);
assert.match(ready, new RegExp(`maxLength="${MAX_CHAT_CONTENT_LENGTH}"`, "i"));
assert.match(ready, /data-slot="input-group"/);
assert.match(connecting, /Connecting to the room/);
assert.match(ready, /aria-label="Choose model"/);
assert.match(ready, /aria-label="Choose thinking effort"/);
assert.equal((ready.match(/data-slot="select-trigger"/g) ?? []).length, 2,
  "model and effort use compact dropdown triggers");
assert.match(ready, /placeholder="Build anything…"/);
assert.match(ready, /data-slot="composer-plus"[^>]*aria-hidden="true"/);
assert.doesNotMatch(ready, /aria-label="Add attachment"/);
assert.match(submitTag(ready, "Send message"), /type="submit"/);
assert.match(ready, /lucide-arrow-up/);

console.log("AI Elements composer checks passed");
