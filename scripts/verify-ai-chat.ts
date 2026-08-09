import assert from "node:assert/strict";

import {
  createAiChatMessageId,
  selectAiChatMessages,
  type ChatFeedEntry,
} from "../lib/ai-chat";
import { parseAiChatRequest } from "../lib/ai-chat-requests";
import { renderChatMarkdown } from "../lib/markdown";
import {
  MAX_CHAT_CONTENT_LENGTH,
  parseAiChatMessage,
  type AiChatMessage,
} from "../types/tasks";

/**
 * The chat feed's two pieces of real logic (25-sidebar-chat-feed), both on the
 * same trust boundary: every message on `ai-chat` is written by another client.
 *
 * Each check here is a way the transcript breaks *silently* — a blank bubble
 * from a partial write, a status message rendered as chat because the two feeds
 * were crossed, or a conversation that reads out of order because it was sorted
 * on the sender's clock instead of the server's.
 */

const VALID: AiChatMessage = {
  role: "user",
  senderId: "user_abc",
  senderName: "Ada Lovelace",
  content: "Should the gateway own retries?",
  sentAt: 1_700_000_000_000,
};

function entry(
  id: string,
  createdAt: number,
  data: unknown = VALID
): ChatFeedEntry {
  return { id, createdAt, data };
}

function checkChatMessagesAreValidated() {
  assert.deepEqual(parseAiChatMessage(VALID), VALID, "a valid message survives");

  const rejected: [string, unknown][] = [
    ["null", null],
    ["an array", [VALID]],
    ["a string", JSON.stringify(VALID)],
    ["a number", 7],
    ["an empty object", {}],
    ["an unknown role", { ...VALID, role: "system" }],
    ["a missing role", { ...VALID, role: undefined }],
    ["an empty senderId", { ...VALID, senderId: "" }],
    ["a non-string senderId", { ...VALID, senderId: 12 }],
    ["an empty senderName", { ...VALID, senderName: "" }],
    ["empty content", { ...VALID, content: "" }],
    ["whitespace-only content", { ...VALID, content: "   \n\t " }],
    ["a non-string content", { ...VALID, content: { text: "hi" } }],
    ["a missing sentAt", { ...VALID, sentAt: undefined }],
    ["a string sentAt", { ...VALID, sentAt: "1700000000000" }],
    ["a NaN sentAt", { ...VALID, sentAt: Number.NaN }],
    ["an infinite sentAt", { ...VALID, sentAt: Number.POSITIVE_INFINITY }],
    ["an out-of-range sentAt", { ...VALID, sentAt: 1e100 }],
    ["an oversized senderId", { ...VALID, senderId: "x".repeat(257) }],
    ["an oversized senderName", { ...VALID, senderName: "x".repeat(121) }],
    // The two feeds must never be readable as each other, whichever way a
    // message ends up on the wrong one.
    [
      "an ai-status message",
      { kind: "design", status: "processing", runId: "run_1" },
    ],
  ];

  for (const [what, data] of rejected) {
    assert.equal(parseAiChatMessage(data), null, `${what} is rejected`);
  }

  const long = { ...VALID, content: "x".repeat(MAX_CHAT_CONTENT_LENGTH + 500) };

  assert.equal(
    parseAiChatMessage(long)?.content.length,
    MAX_CHAT_CONTENT_LENGTH,
    "over-long content is clamped rather than rejected"
  );

  console.log("✅ chat messages are validated");
}

function checkChatRequestsAreValidated() {
  assert.deepEqual(
    parseAiChatRequest({ projectId: "project-1", content: "  hello  " }),
    { projectId: "project-1", content: "hello" }
  );
  assert.equal(parseAiChatRequest(null), null);
  assert.equal(parseAiChatRequest({ projectId: "", content: "hello" }), null);
  assert.equal(parseAiChatRequest({ projectId: "project-1", content: "  " }), null);
  assert.equal(
    parseAiChatRequest({
      projectId: "project-1",
      content: "x".repeat(MAX_CHAT_CONTENT_LENGTH + 1),
    }),
    null
  );
}

function checkTranscriptIsOrderedAndFiltered() {
  assert.deepEqual(selectAiChatMessages(undefined), [], "no feed reads as empty");
  assert.deepEqual(selectAiChatMessages([]), [], "an empty feed reads as empty");

  // Oldest first, regardless of the order the hook handed them over in.
  const shuffled = [entry("c", 300), entry("a", 100), entry("b", 200)];

  assert.deepEqual(
    selectAiChatMessages(shuffled).map((message) => message.id),
    ["a", "b", "c"],
    "messages are ordered by the server's createdAt"
  );

  const longHistory = Array.from({ length: 25 }, (_, index) =>
    entry(`message-${index}`, 25 - index)
  );

  assert.equal(
    selectAiChatMessages(longHistory).length,
    25,
    "loaded feed pages are not truncated by the selector"
  );

  // The transcript must not reorder itself around a sender whose clock is wrong.
  const skewed = [
    entry("first", 100, { ...VALID, sentAt: 9_000_000_000_000 }),
    entry("second", 200, { ...VALID, sentAt: 1 }),
  ];

  assert.deepEqual(
    selectAiChatMessages(skewed).map((message) => message.id),
    ["first", "second"],
    "a skewed sender clock does not reorder the transcript"
  );

  const mixed = [
    entry("junk", 50, { role: "user" }),
    entry("good", 100),
    entry("status", 150, { kind: "spec", status: "complete", runId: "run_1" }),
  ];

  assert.deepEqual(
    selectAiChatMessages(mixed).map((message) => message.id),
    ["good"],
    "unreadable entries are skipped instead of rendered blank"
  );

  const original = [entry("b", 200), entry("a", 100)];
  selectAiChatMessages(original);

  assert.equal(original[0].id, "b", "the caller's array is not sorted in place");

  console.log("✅ the transcript is ordered and filtered");
}

function checkMessageIdsCanAnchorInlineRuns() {
  assert.equal(
    createAiChatMessageId(() => "00000000-0000-4000-8000-000000000000"),
    "chat-00000000-0000-4000-8000-000000000000"
  );
}

/**
 * The markdown boundary. This output goes straight into
 * `dangerouslySetInnerHTML`, so these are not formatting tests — they are the
 * assertion that a chat message cannot become script. The `html: false` option
 * in `lib/markdown.ts` is the only thing standing between a feed message and
 * the DOM, and it is one keystroke from being switched on by someone who wants
 * an embedded `<br>` to work.
 */
function checkMarkdownCannotInjectHtml() {
  const escaped: [string, string][] = [
    ["<script>alert(1)</script>", "<script"],
    ['<img src=x onerror="alert(1)">', "<img"],
    ["<iframe src='evil'></iframe>", "<iframe"],
    ["<div onclick='steal()'>hi</div>", "<div"],
    ["<style>body{display:none}</style>", "<style"],
  ];

  for (const [content, forbidden] of escaped) {
    const html = renderChatMarkdown(content);

    assert.ok(
      !html.includes(forbidden),
      `raw HTML must be escaped, not emitted: ${content}`
    );
    assert.ok(html.includes("&lt;"), `expected escaped text for: ${content}`);
  }

  // Script-bearing URL schemes are refused by markdown-it's link validator, so
  // the href never reaches the DOM even though the link text still renders.
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    const html = renderChatMarkdown(`[click](${href})`);

    assert.ok(
      !html.includes(`href="${href}"`) && !/href="[^"]*script:/i.test(html),
      `unsafe scheme must not become an href: ${href}`
    );
  }

  // An ordinary link is still a link, and still leaves the tab safely.
  const link = renderChatMarkdown("[docs](https://example.com)");

  assert.ok(link.includes('href="https://example.com"'));
  assert.ok(link.includes('target="_blank"'));
  assert.ok(link.includes("noopener"));
}

/** The formatting the assistant actually uses: prose, lists, code, emphasis. */
function checkMarkdownRendersChatFormatting() {
  assert.ok(renderChatMarkdown("**bold**").includes("<strong>"));
  assert.ok(renderChatMarkdown("_italic_").includes("<em>"));
  assert.ok(renderChatMarkdown("- one\n- two").includes("<li>"));
  assert.ok(renderChatMarkdown("1. one\n2. two").includes("<ol>"));
  assert.ok(renderChatMarkdown("`inline`").includes("<code>"));
  assert.ok(renderChatMarkdown("```\nblock\n```").includes("<pre>"));

  // `breaks: true` — a single newline is where the line visibly broke.
  assert.ok(renderChatMarkdown("line one\nline two").includes("<br>"));

  // `linkify: true` — a pasted URL is a link without any syntax around it.
  assert.ok(renderChatMarkdown("see https://example.com").includes("<a "));
}

  checkChatMessagesAreValidated();
  checkChatRequestsAreValidated();
checkTranscriptIsOrderedAndFiltered();
checkMessageIdsCanAnchorInlineRuns();
checkMarkdownCannotInjectHtml();
checkMarkdownRendersChatFormatting();
console.log("✅ markdown is escaped and rendered");
console.log("✅ ai-chat feed checks passed");
