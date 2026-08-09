import assert from "node:assert/strict";

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
import { ChatEntry } from "../components/editor/chat-entry";
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
    activity: [{ id: "activity-0", type: "step", text: "Reading the canvas" }],
  };
  const html = renderEntry(<AiRunActivity state={incomplete} />);

  assert.ok(
    html.includes("Work stopped before completion"),
    "an incomplete run states that it stopped",
  );
  assert.ok(html.includes("Reading the canvas"), "partial activity remains inspectable");
}

checkCollaboratorIdentityIsVisible();
checkLegacyCollaboratorUsesInitials();
checkOwnPromptStaysQuiet();
checkIncompleteRunKeepsItsPartialWork();
console.log("✅ ai-chat collaborator markup checks passed");
