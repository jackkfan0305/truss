import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { AiChatComposer } from "../components/chat/ai-chat-composer";
import { DEFAULT_ASSISTANT_MODEL_ID } from "../lib/assistant-models";

function composer(draft: string, isWorking = false): string {
  return renderToStaticMarkup(
    <AiChatComposer
      draft={draft}
      isWorking={isWorking}
      modelId={DEFAULT_ASSISTANT_MODEL_ID}
      onDraftChange={() => {}}
      onModelChange={() => {}}
      onSubmit={() => {}}
      onStop={() => {}}
    />,
  );
}

function buttonTag(html: string, label: string): string {
  const tag = (html.match(/<button[^>]*>/g) ?? []).find((candidate) =>
    candidate.includes(`aria-label="${label}"`),
  );
  assert.ok(tag, `${label} button exists`);
  return tag;
}

const ready = composer("Build a queue");
const working = composer("Build a queue", true);
const empty = composer("");

// The beam wrapper is always mounted so the Metal FX ring is never remounted.
assert.match(ready, /data-beam=/);
assert.match(working, /data-beam=/);
assert.match(ready, /aria-label="Send message"/);
assert.match(working, /aria-busy="true"/);
// While a turn runs, the send button becomes an enabled Stop button.
assert.doesNotMatch(buttonTag(working, "Stop"), /disabled=""/);
assert.match(buttonTag(working, "Stop"), /type="button"/);
assert.match(working, /lucide-square/);
assert.match(buttonTag(empty, "Send message"), /disabled=""/);
assert.match(ready, /maxLength="2000"/i);
assert.match(ready, /data-slot="input-group"/);
assert.match(working, /placeholder="Working on it…"/);
assert.match(ready, /aria-label="Choose model"/);
assert.doesNotMatch(ready, /aria-label="Choose thinking effort"/);
assert.equal((ready.match(/data-slot="select-trigger"/g) ?? []).length, 1);
assert.match(ready, /Claude Sonnet 5\.5/, "the pill names the picked model");
assert.match(ready, /data-slot="composer-plus"[^>]*aria-hidden="true"/);
assert.match(buttonTag(ready, "Send message"), /type="submit"/);
assert.match(ready, /lucide-arrow-up/);

console.log("AI Elements composer checks passed");
