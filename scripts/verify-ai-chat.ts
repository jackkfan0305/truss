import assert from "node:assert/strict";

import {
  arrangeAiChatMessages,
  armAiChatRunStaleTimer,
  createAiChatMessageId,
  MAX_AI_RUN_STALE_TIMER_DELAY_MS,
  resolveAiChatRunPhase,
  selectAiChatMessages,
  shouldShowLocalAiRunActivity,
  shouldShowRemoteRunStatus,
  type ChatFeedEntry,
  type ChatMessage,
} from "../lib/ai-chat";
import { parseAiChatRequest } from "../lib/ai-chat-requests";
import { toPersistedAiActivity } from "../lib/ai-timeline";
import { renderChatMarkdown } from "../lib/markdown";
import {
  AI_USER_ID,
  AI_USER_NAME,
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

const RUN_MESSAGE = {
  role: "assistant",
  senderId: AI_USER_ID,
  senderName: AI_USER_NAME,
  content: "",
  sentAt: 1_700_000_000_000,
  run: {
    runId: "run_123",
    promptMessageId: "chat-prompt",
    phase: "running",
    activity: [
      { type: "reasoning", text: "Inspecting the graph" },
      { type: "action", text: "addNode", detail: "API" },
    ],
  },
} satisfies AiChatMessage;

const ASSISTANT_MESSAGE: AiChatMessage = {
  ...RUN_MESSAGE,
  content: "The graph now includes an API.",
};

const LEGACY_ASSISTANT_MESSAGE: AiChatMessage = {
  role: "assistant",
  senderId: AI_USER_ID,
  senderName: AI_USER_NAME,
  content: "The graph now includes an API.",
  sentAt: 1_700_000_000_000,
};

function entry(
  id: string,
  createdAt: number,
  data: unknown = VALID,
  updatedAt: number = createdAt,
): ChatFeedEntry {
  return { id, createdAt, updatedAt, data };
}

function checkChatMessagesAreValidated() {
  assert.deepEqual(parseAiChatMessage(VALID), VALID, "a valid message survives");
  assert.deepEqual(
    parseAiChatMessage(RUN_MESSAGE),
    RUN_MESSAGE,
    "a running assistant message can use its work log as content",
  );
  assert.equal(
    parseAiChatMessage({ ...VALID, content: "", run: RUN_MESSAGE.run }),
    null,
    "an empty human message is not made valid by run metadata",
  );
  assert.equal(
    parseAiChatMessage({ ...RUN_MESSAGE, content: "  " }),
    null,
    "a whitespace-only running message is still unreadable",
  );
  assert.deepEqual(
    parseAiChatMessage({
      ...VALID,
      senderAvatar: "https://img.clerk.com/user.jpg",
    }),
    { ...VALID, senderAvatar: "https://img.clerk.com/user.jpg" },
    "a Clerk avatar snapshot survives",
  );
  assert.deepEqual(
    parseAiChatMessage({
      ...VALID,
      senderAvatar: "https://example.com/user.jpg",
    }),
    VALID,
    "an untrusted avatar URL is dropped",
  );
  assert.deepEqual(
    parseAiChatMessage({ ...VALID, run: RUN_MESSAGE.run }),
    VALID,
    "run metadata on a human message is dropped",
  );
  assert.deepEqual(
    parseAiChatMessage({
      ...ASSISTANT_MESSAGE,
      senderId: "user_spoof",
      senderName: "Mallory",
    }),
    {
      role: "assistant",
      senderId: "user_spoof",
      senderName: "Mallory",
      content: ASSISTANT_MESSAGE.content,
      sentAt: ASSISTANT_MESSAGE.sentAt,
    },
    "run metadata on an assistant-role message from a human is dropped",
  );

  for (const [what, run] of [
    ["an unknown phase", { ...RUN_MESSAGE.run, phase: "pending" }],
    ["an empty run ID", { ...RUN_MESSAGE.run, runId: "" }],
    ["an empty prompt message ID", { ...RUN_MESSAGE.run, promptMessageId: "" }],
    ["malformed activity", { ...RUN_MESSAGE.run, activity: [{ type: "wat" }] }],
  ] as const) {
    assert.deepEqual(
      parseAiChatMessage({ ...ASSISTANT_MESSAGE, run }),
      LEGACY_ASSISTANT_MESSAGE,
      `${what} is dropped without hiding legacy assistant content`,
    );
  }

  const tooMuchActivity = {
    ...RUN_MESSAGE.run,
    activity: Array.from({ length: 201 }, (_, index) => ({
      type: "step" as const,
      text: `Step ${index}`,
    })),
  };

  assert.equal(
    parseAiChatMessage({ ...RUN_MESSAGE, run: tooMuchActivity })?.run?.activity
      .length,
    200,
    "durable activity is capped at the shared timeline limit",
  );

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
  assert.deepEqual(
    parseAiChatRequest({
      projectId: "project-1",
      content: "  hello  ",
      senderAvatar: "https://img.clerk.com/browser-spoof.jpg",
      senderId: "user_spoof",
      senderName: "Mallory",
    }),
    { projectId: "project-1", content: "hello" },
    "browser-supplied identity is ignored",
  );
}

async function checkAuthenticatedMessagesUseTheClerkAvatar() {
  // The verifier only exercises the route's pure message builder. A valid
  // placeholder lets its Prisma-backed authorization import initialize without
  // asking this boundary check to contact a database.
  process.env.DATABASE_URL ??=
    "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder";
  const aiChatRoute = await import("../app/api/ai/chat/route");

  assert.ok(
    "createAuthenticatedAiChatMessage" in aiChatRoute,
    "the authenticated route exposes its server-authored message builder",
  );

  const createMessage = (
    aiChatRoute as typeof aiChatRoute & {
      createAuthenticatedAiChatMessage: (
        request: { projectId: string; content: string },
        senderId: string,
        user: {
          fullName: string | null;
          username: string | null;
          primaryEmailAddress: { emailAddress: string } | null;
          imageUrl: string;
        },
        sentAt: number,
      ) => AiChatMessage;
    }
  ).createAuthenticatedAiChatMessage;

  assert.deepEqual(
    createMessage(
      { projectId: "project-1", content: "hello" },
      "user_abc",
      {
        fullName: "Ada Lovelace",
        username: null,
        primaryEmailAddress: null,
        imageUrl: "https://img.clerk.com/ada.jpg",
      },
      1_700_000_000_000,
    ),
    {
      role: "user",
      senderId: "user_abc",
      senderName: "Ada Lovelace",
      senderAvatar: "https://img.clerk.com/ada.jpg",
      content: "hello",
      sentAt: 1_700_000_000_000,
    },
    "authenticated user messages carry only the Clerk avatar snapshot",
  );
}

function checkTranscriptIsOrderedAndFiltered() {
  assert.deepEqual(selectAiChatMessages(undefined), [], "no feed reads as empty");
  assert.deepEqual(selectAiChatMessages([]), [], "an empty feed reads as empty");

  // Oldest first, regardless of the order the hook handed them over in.
  const shuffled = [
    entry("c", 300, VALID, 3_003),
    entry("a", 100, VALID, 1_001),
    entry("b", 200, VALID, 2_002),
  ];

  assert.deepEqual(
    selectAiChatMessages(shuffled).map((message) => message.id),
    ["a", "b", "c"],
    "messages are ordered by the server's createdAt",
  );
  assert.deepEqual(
    selectAiChatMessages(shuffled).map(({ id, sentAt, updatedAt }) => ({
      id,
      sentAt,
      updatedAt,
    })),
    [
      { id: "a", sentAt: VALID.sentAt, updatedAt: 1_001 },
      { id: "b", sentAt: VALID.sentAt, updatedAt: 2_002 },
      { id: "c", sentAt: VALID.sentAt, updatedAt: 3_003 },
    ],
    "server timestamps are copied without affecting createdAt ordering",
  );

  const longHistory = Array.from({ length: 25 }, (_, index) =>
    entry(`message-${index}`, 25 - index),
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

/**
 * A shared AI turn belongs immediately after the prompt that caused it, even
 * when the durable feed publishes the run after a later collaborator prompt.
 * This catches a transcript that follows raw feed order rather than the
 * project-worklog order readers need to understand what work answers what.
 */
function checkPromptLinkedRunsAreArrangedAndExpire() {
  const promptA: ChatMessage = {
    ...VALID,
    content: "Map the checkout flow",
    sentAt: 100,
    id: "prompt-a",
    updatedAt: 100,
  };
  const promptB: ChatMessage = {
    ...VALID,
    content: "Add the refund path",
    sentAt: 200,
    id: "prompt-b",
    updatedAt: 200,
  };
  const runA: ChatMessage = {
    ...RUN_MESSAGE,
    id: "run-a",
    updatedAt: 300,
    sentAt: 300,
    run: { ...RUN_MESSAGE.run, promptMessageId: promptA.id },
  };
  const runB: ChatMessage = {
    ...RUN_MESSAGE,
    id: "run-b",
    updatedAt: 400,
    sentAt: 400,
    run: { ...RUN_MESSAGE.run, runId: "run-456", promptMessageId: promptB.id },
  };

  assert.deepEqual(
    arrangeAiChatMessages([promptA, promptB, runA, runB]).map((message) => message.id),
    [promptA.id, runA.id, promptB.id, runB.id],
    "a durable run follows its loaded prompt rather than its feed position",
  );
  assert.equal(
    resolveAiChatRunPhase("running", 1_000, 316_001),
    "incomplete",
    "a run older than the stale deadline stops claiming it is live",
  );
  assert.equal(
    resolveAiChatRunPhase("running", 1_000, 316_000),
    "running",
    "the exact stale deadline remains live until it has passed",
  );

  const legacyAssistant: ChatMessage = {
    ...LEGACY_ASSISTANT_MESSAGE,
    id: "legacy-assistant",
    updatedAt: 500,
  };
  const orphanedRun: ChatMessage = {
    ...runA,
    id: "orphaned-run",
    run: { ...RUN_MESSAGE.run, promptMessageId: "unloaded-prompt" },
  };
  const selfReferentialRun: ChatMessage = {
    ...runA,
    id: "self-referential-run",
    run: { ...RUN_MESSAGE.run, promptMessageId: "self-referential-run" },
  };

  assert.deepEqual(
    arrangeAiChatMessages([legacyAssistant, orphanedRun, selfReferentialRun]).map(
      (message) => message.id,
    ),
    [legacyAssistant.id, orphanedRun.id, selfReferentialRun.id],
    "only a loaded human prompt can claim a run; unlinked feed entries stay ordered",
  );
}

/**
 * The design request can create a durable run and then fail while fetching its
 * scoped token. The initiator needs that local start failure even though the
 * room already has a run snapshot; only local running/completed UI is redundant.
 */
function checkLocalStartFailuresRemainVisibleBesideDurableRuns() {
  assert.equal(
    shouldShowLocalAiRunActivity(
      { phase: "error", runId: null },
      true,
    ),
    true,
    "a token-request start failure remains visible when its durable run exists",
  );
  assert.equal(
    shouldShowLocalAiRunActivity(
      { phase: "running", runId: "run-123" },
      true,
    ),
    false,
    "local running activity stays hidden once durable activity exists",
  );
  assert.equal(
    shouldShowLocalAiRunActivity(
      { phase: "complete", runId: "run-123" },
      true,
    ),
    false,
    "local completed activity stays hidden once durable activity exists",
  );
}

/** A visible current run row already carries richer progress than the coarse status. */
function checkRemoteStatusDoesNotDuplicateVisibleRunProgress() {
  const running: ChatMessage = {
    ...RUN_MESSAGE,
    id: "chat-run_123",
    updatedAt: 1_000,
  };
  const designStatus = {
    kind: "design" as const,
    status: "processing" as const,
    runId: RUN_MESSAGE.run.runId,
    text: "Designing…",
  };
  const input = {
    isRoomActive: true,
    hasLocalActiveTurn: false,
    messages: [running],
    status: designStatus,
    now: 2_000,
  };

  assert.equal(
    shouldShowRemoteRunStatus(input),
    false,
    "matching visible running work suppresses the duplicate collaborator line",
  );
  assert.equal(
    shouldShowRemoteRunStatus({
      ...input,
      status: { ...designStatus, runId: "run-other" },
    }),
    true,
    "an unrelated room run keeps its status visible",
  );
  assert.equal(
    shouldShowRemoteRunStatus({ ...input, now: 316_001 }),
    true,
    "stale running history does not hide current room status",
  );
  assert.equal(
    shouldShowRemoteRunStatus({
      ...input,
      messages: [
        {
          ...running,
          content: "Done.",
          run: { ...RUN_MESSAGE.run, phase: "complete" },
        },
      ],
    }),
    true,
    "terminal history does not hide current room status",
  );
  assert.equal(
    shouldShowRemoteRunStatus({
      ...input,
      status: { ...designStatus, kind: "spec" },
    }),
    true,
    "a design work row cannot hide unrelated spec progress",
  );
}

interface FakeTimer {
  callback: () => void;
  delay: number;
}

function createFakeStaleTimerScheduler(now: number) {
  let currentTime = now;
  let nextId = 0;
  const timers = new Map<number, FakeTimer>();

  return {
    scheduler: {
      now: () => currentTime,
      setTimeout: (callback: () => void, delay: number) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeout: (id: number) => {
        timers.delete(id);
      },
    },
    setNow: (next: number) => {
      currentTime = next;
    },
    fireNext: () => {
      const timer = timers.entries().next().value as
        | [number, FakeTimer]
        | undefined;

      assert.ok(timer, "a stale timer must be armed");
      timers.delete(timer[0]);
      timer[1].callback();
    },
    delays: () => [...timers.values()].map((timer) => timer.delay),
    timerCount: () => timers.size,
  };
}

/**
 * Browsers can fire a timeout early and laptops can move their wall clock
 * backwards. A stale timer must re-check phase and re-arm instead of declaring
 * an active run stopped or letting a future-dated snapshot wait forever.
 */
function checkStaleTimerReevaluatesUntilItSettles() {
  const early = createFakeStaleTimerScheduler(1_000);
  let earlySettles = 0;
  const stopEarly = armAiChatRunStaleTimer(
    1_000,
    early.scheduler,
    () => {
      earlySettles += 1;
    },
  );

  assert.deepEqual(early.delays(), [315_001]);
  early.fireNext();
  assert.equal(earlySettles, 0, "an early timer callback does not settle a live run");
  assert.deepEqual(early.delays(), [315_001], "an early callback re-arms the timer");
  early.setNow(-9_000);
  early.fireNext();
  assert.equal(earlySettles, 0, "a backward clock does not settle a live run");
  assert.deepEqual(
    early.delays(),
    [325_001],
    "a backward clock re-arms from its newly observed time",
  );
  stopEarly();
  assert.equal(early.timerCount(), 0, "cleanup cancels the replacement timer");

  const future = createFakeStaleTimerScheduler(0);
  let futureSettles = 0;
  armAiChatRunStaleTimer(
    MAX_AI_RUN_STALE_TIMER_DELAY_MS * 2,
    future.scheduler,
    () => {
      futureSettles += 1;
    },
  );

  assert.deepEqual(
    future.delays(),
    [MAX_AI_RUN_STALE_TIMER_DELAY_MS],
    "a far-future snapshot is capped to a browser-safe timer delay",
  );
  future.setNow(MAX_AI_RUN_STALE_TIMER_DELAY_MS);
  future.fireNext();
  assert.equal(futureSettles, 0, "a capped future timer re-evaluates instead of stopping");
  assert.deepEqual(
    future.delays(),
    [MAX_AI_RUN_STALE_TIMER_DELAY_MS],
    "a far-future snapshot stays safely re-armed",
  );

  const stale = createFakeStaleTimerScheduler(1_000);
  let staleSettles = 0;
  armAiChatRunStaleTimer(1_000, stale.scheduler, () => {
    staleSettles += 1;
  });
  stale.setNow(316_001);
  stale.fireNext();
  assert.equal(staleSettles, 1, "a run settles only after the strict stale threshold");
  assert.equal(stale.timerCount(), 0, "a settled timer does not re-arm itself");
}

function checkTimelineCanBePersistedWithoutTransientIds() {
  assert.deepEqual(
    toPersistedAiActivity([
      { id: "activity-0", type: "reasoning", text: "Inspecting the graph" },
      { id: "activity-1", type: "action", text: "addNode", detail: "API" },
    ]),
    [
      { type: "reasoning", text: "Inspecting the graph" },
      { type: "action", text: "addNode", detail: "API" },
    ],
    "persisted activity excludes timeline-only IDs",
  );
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

async function main() {
  checkChatMessagesAreValidated();
  checkChatRequestsAreValidated();
  await checkAuthenticatedMessagesUseTheClerkAvatar();
  checkTranscriptIsOrderedAndFiltered();
  checkPromptLinkedRunsAreArrangedAndExpire();
  checkLocalStartFailuresRemainVisibleBesideDurableRuns();
  checkRemoteStatusDoesNotDuplicateVisibleRunProgress();
  checkStaleTimerReevaluatesUntilItSettles();
  checkTimelineCanBePersistedWithoutTransientIds();
  checkMessageIdsCanAnchorInlineRuns();
  checkMarkdownCannotInjectHtml();
  checkMarkdownRendersChatFormatting();
  console.log("✅ markdown is escaped and rendered");
  console.log("✅ ai-chat feed checks passed");
}

void main();
