import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ImageConfigContext } from "next/dist/shared/lib/image-config-context.shared-runtime";
import {
  imageConfigDefault,
  type ImageConfigComplete,
} from "next/dist/shared/lib/image-config";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AiRunActivity,
  type AiRunActivityState,
} from "../components/editor/ai-run-activity";
import { AiChatTranscript } from "../components/editor/ai-chat-transcript";
import { ChatEntry } from "../components/editor/chat-entry";
import { ManualSpecCopyFallback } from "../components/editor/spec-attachment";
import type { DesignRunObserverProps } from "../components/editor/design-run-observer";
import type { ChatMessage } from "../lib/ai-chat";

const collaboratorMessage: ChatMessage = {
  id: "chat-collaborator",
  role: "user",
  senderId: "user_grace",
  senderName: "Grace Hopper",
  senderAvatar: "https://img.clerk.com/grace.jpg",
  content: "I think the queue should own retries.",
  sentAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

// `tsx` renders outside Next's runtime, so it does not inject the project's
// remote-image config. Keep the real Image component under the same narrow
// Clerk host pattern rather than replacing it with a test double.
const imageConfig: ImageConfigComplete = {
  ...imageConfigDefault,
  remotePatterns: [
    { protocol: "https", hostname: "img.clerk.com", pathname: "/**" },
  ],
};

function renderEntry(entry: React.ReactNode): string {
  return renderToStaticMarkup(
    <ImageConfigContext.Provider value={imageConfig}>
      {entry}
    </ImageConfigContext.Provider>,
  );
}

/**
 * The contributor rail is the shared worklog's provenance: dropping its name,
 * avatar, or left-side geometry would make a collaborator prompt read like the
 * current user's and sever an AI run from the person who asked for it.
 */
function checkCollaboratorIdentityIsVisible() {
  const html = renderEntry(<ChatEntry message={collaboratorMessage} isOwn={false} />);

  assert.ok(html.includes("Grace Hopper"), "a collaborator name is visible");
  assert.ok(html.includes('alt="Grace Hopper"'), "the avatar has useful alt text");
  assert.ok(html.includes("img.clerk.com%2Fgrace.jpg"), "the Clerk avatar is rendered");
  assert.ok(
    html.includes("flex items-start gap-2.5"),
    "a collaborator uses the quiet left-side author rail",
  );
  assert.ok(html.includes("bg-elevated"), "human content stays on the elevated surface");
}

function checkLegacyCollaboratorUsesInitials() {
  const html = renderEntry(
    <ChatEntry
      message={{ ...collaboratorMessage, senderAvatar: undefined }}
      isOwn={false}
    />,
  );

  assert.ok(html.includes(">GH<"), "a legacy collaborator falls back to initials");
}

function checkLegacyCollaboratorUsesLivePresenceAvatar() {
  const html = renderEntry(
    <ChatEntry
      message={{ ...collaboratorMessage, senderAvatar: undefined }}
      isOwn={false}
      liveAvatar="https://img.clerk.com/grace-live.jpg"
    />,
  );

  assert.ok(
    html.includes("img.clerk.com%2Fgrace-live.jpg"),
    "a legacy message uses the collaborator's current presence avatar",
  );
  assert.ok(html.includes("Grace Hopper"), "the collaborator name remains visible");
}

function checkOwnPromptStaysQuiet() {
  const html = renderEntry(
    <ChatEntry message={collaboratorMessage} isOwn />,
  );

  assert.equal(
    html.includes(">Grace Hopper<"),
    false,
    "the current user's prompt does not expose another collaborator label",
  );
}

/** A stale snapshot must state that work stopped without discarding its ledger. */
function checkIncompleteRunKeepsItsPartialWork() {
  const incomplete: AiRunActivityState = {
    id: "chat-run",
    runId: "run-123",
    phase: "incomplete",
    activity: [
      { id: "activity-0", type: "step", text: "Reading the canvas" },
      { id: "activity-1", type: "action", text: "addNode", detail: "Add Cache" },
    ],
  };
  const html = renderEntry(<AiRunActivity state={incomplete} />);

  assert.ok(
    html.includes("Work stopped before completion"),
    "an incomplete run states that it stopped",
  );
  assert.ok(
    html.includes("Add Cache"),
    "the canvas work a stopped run did manage remains inspectable",
  );

  // Steps are the live line above the composer now (38-live-step-status).
  // Listing them here too would print the same verbs twice, and they are the
  // least useful part of a log read after the fact.
  assert.equal(
    html.includes("Reading the canvas"),
    false,
    "step verbs are status, not ledger, and do not appear in the work log",
  );
}

/**
 * Only the newest part of a live run may claim to be in progress.
 *
 * Every reasoning disclosure used to decide this from the run phase alone, so a
 * run that thought four times showed four spinners all saying "Thinking" —
 * three of them finished minutes earlier. The regression is invisible in a
 * static diff and obvious to anyone watching the panel.
 */
function checkOnlyTheNewestThoughtIsStillThinking() {
  const running: AiRunActivityState = {
    id: "chat-run",
    runId: "run-123",
    phase: "running",
    activity: [
      { id: "activity-0", type: "reasoning", text: "First thought" },
      { id: "activity-1", type: "reasoning", text: "Second thought" },
    ],
  };
  const html = renderEntry(<AiRunActivity state={running} />);

  assert.equal(
    html.match(/Thinking/g)?.length,
    1,
    "exactly one part of a live run is thinking",
  );
  assert.equal(
    html.match(/Thought process/g)?.length,
    1,
    "and the one before it has settled",
  );

  // A step arriving after a thought settles it, even though the step itself is
  // not rendered — which is why the streaming part is chosen against the
  // unfiltered activity rather than the list on screen.
  const afterStep = renderEntry(
    <AiRunActivity
      state={{
        ...running,
        activity: [
          { id: "activity-0", type: "reasoning", text: "First thought" },
          { id: "activity-1", type: "step", text: "Applying to the canvas" },
        ],
      }}
    />,
  );

  assert.equal(
    afterStep.includes("Thinking"),
    false,
    "a thought the model has moved on from is not still thinking",
  );
}

/** A turn that only answered has nothing to show once steps are out of the log. */
function checkACompletedTurnWithNoWorkRendersNothing() {
  const answered: AiRunActivityState = {
    id: "chat-run",
    runId: "run-123",
    phase: "complete",
    activity: [{ id: "activity-0", type: "step", text: "Reading the canvas" }],
  };

  assert.equal(
    renderEntry(<AiRunActivity state={answered} />),
    "",
    "an empty work log renders no disclosure rather than an empty one",
  );
}

/**
 * A successful REST prompt write can be delayed in the Liveblocks feed. The
 * private Trigger subscription must still mount exactly once so it can settle
 * and unlock the initiating composer, even with no prompt row to map over.
 */
function checkRunObserverDoesNotDependOnVisibleMessages() {
  function ObserverProbe({ subscription }: DesignRunObserverProps) {
    return <span data-observed-run={subscription.runId}>observer mounted</span>;
  }

  const renderTranscript = (messages: ChatMessage[]) =>
    renderEntry(
      <AiChatTranscript
        messages={messages}
        selfId="user_ada"
        turns={[]}
        status={null}
        isRoomActive={false}
        projectId="checkout-flow-a1b2"
        emptyState={<p>No messages yet</p>}
        subscription={{ runId: "run-delayed-feed", token: "token" }}
        onRunSettled={() => undefined}
        hasOlderMessages={false}
        isFetchingOlder={false}
        onFetchOlder={() => undefined}
        ObserverComponent={ObserverProbe}
        useCollaboratorsSource={() => []}
      />,
    );

  for (const messages of [[], [collaboratorMessage]]) {
    const html = renderTranscript(messages);
    const mounts = html.match(/data-observed-run="run-delayed-feed"/g) ?? [];

    assert.equal(
      mounts.length,
      1,
      "the subscription observer mounts once without its prompt in the transcript",
    );
  }
}

/**
 * The spec preview's copy button.
 *
 * Asserted against the source, not a render: the preview only exists inside an
 * open dialog, and there is no DOM in this toolchain to open one. What is worth
 * pinning is not the markup anyway — it is the three things that fail silently.
 */
function checkSpecPreviewCopiesMarkdownSource() {
  const source = readFileSync(
    new URL("../components/editor/spec-attachment.tsx", import.meta.url),
    "utf8",
  );

  // The clipboard gets the document, not the dialog's rendered HTML.
  assert.match(source, /copy\(markdown\)/);
  assert.doesNotMatch(
    source,
    /copy\(\s*renderChatMarkdown/,
    "the clipboard gets Markdown source, never the rendered HTML",
  );

  // No button while the fetch is in flight or has failed: copying an error
  // message or an empty string is worse than offering nothing.
  assert.match(
    source,
    /\{markdown\s*\?\s*<CopyAction/,
    "the copy button waits for a document to exist",
  );
}

/** A denied Clipboard API write must expose the source the instruction refers to. */
function checkSpecCopyFailureExposesSelectableMarkdown() {
  const markdown = "# Queue\n\nRetry failed jobs with backoff.";
  const html = renderEntry(<ManualSpecCopyFallback markdown={markdown} />);

  assert.ok(
    html.includes("Copy the Markdown manually"),
    "the fallback explains the manual action",
  );
  assert.ok(html.includes("<textarea"), "the fallback exposes a selectable control");
  assert.equal(
    html.includes("autofocus"),
    false,
    "the fallback does not steal focus when the clipboard request fails",
  );
  assert.ok(
    html.includes("# Queue\n\nRetry failed jobs with backoff."),
    "the selectable control contains the exact Markdown source",
  );
}

/**
 * One clipboard implementation, not one per dialog.
 *
 * The timeout is the part that rots: a component that unmounts inside the
 * feedback window (the spec preview closes on Escape, routinely) leaves a timer
 * holding a setter for a component that is gone. It is cleared on unmount and
 * re-armed on every copy, in one place — so a second open-coded `writeText` is
 * a regression, not a style question.
 */
function checkClipboardFeedbackLivesInOneHook() {
  const hook = readFileSync(
    new URL("../hooks/use-copy-to-clipboard.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    hook,
    /return\s*\(\)\s*=>\s*{\s*if\s*\(timeoutRef\.current\)\s*clearTimeout\(timeoutRef\.current\)/,
    "the feedback timer is cleared on unmount",
  );
  assert.match(
    hook,
    /if\s*\(timeoutRef\.current\)\s*clearTimeout\(timeoutRef\.current\)/,
    "a second copy re-arms the timer rather than racing the first",
  );
  assert.match(
    hook,
    /if\s*\(next\s*===\s*"copied"\)\s*{[\s\S]*?setTimeout/,
    "only transient success feedback clears automatically",
  );
  assert.match(hook, /catch\s*{[\s\S]*?next\s*=\s*"error"/, "a denied write is a state, not a throw");

  for (const path of [
    "../components/editor/spec-attachment.tsx",
    "../components/editor/share-dialog.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");

    assert.match(source, /useCopyToClipboard\(\)/, `${path} uses the shared hook`);
    assert.doesNotMatch(
      source,
      /navigator\.clipboard/,
      `${path} must not open-code a second clipboard write`,
    );
  }
}

checkCollaboratorIdentityIsVisible();
checkLegacyCollaboratorUsesInitials();
checkLegacyCollaboratorUsesLivePresenceAvatar();
checkOwnPromptStaysQuiet();
checkIncompleteRunKeepsItsPartialWork();
checkOnlyTheNewestThoughtIsStillThinking();
checkACompletedTurnWithNoWorkRendersNothing();
checkRunObserverDoesNotDependOnVisibleMessages();
checkSpecPreviewCopiesMarkdownSource();
checkSpecCopyFailureExposesSelectableMarkdown();
checkClipboardFeedbackLivesInOneHook();
console.log("✅ ai-chat collaborator markup and spec copy checks passed");
