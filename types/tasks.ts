/**
 * The contract for the shared AI activity feed (23-design-agent-logic).
 *
 * Background tasks publish progress here through `lib/ai-activity.ts`, and the
 * sidebar reads the latest message back out. Kept deliberately generic — spec
 * generation publishes to the same feed, so `kind` is what tells them apart.
 *
 * Declared as `type`s rather than `interface`s: Liveblocks feed messages are
 * constrained to `Json`, and only type aliases get the implicit index signature
 * that satisfies it (the same reason `CanvasNodeData` is a type).
 */

/** The room-scoped feed every AI task reports into. */
export const AI_STATUS_FEED_ID = "ai-status-feed";

export const AI_TASK_KINDS = ["design", "spec"] as const;

export type AiTaskKind = (typeof AI_TASK_KINDS)[number];

export const AI_TASK_STATUSES = [
  "started",
  "processing",
  "complete",
  "error",
] as const;

export type AiTaskStatus = (typeof AI_TASK_STATUSES)[number];

export type AiStatusMessage = {
  kind: AiTaskKind;
  status: AiTaskStatus;
  /** The Trigger.dev run this message belongs to. */
  runId: string;
  /** Human-readable line for the sidebar. Optional: a status alone is valid. */
  text?: string;
};

/** A status line long enough to be useful, short enough not to reflow the panel. */
const MAX_STATUS_TEXT_LENGTH = 240;

/**
 * Feed messages are written by a background task and read by every client in
 * the room, so the reader validates rather than trusts: an older task version,
 * a partial write or a message from an unrelated feature must render as nothing
 * instead of as a broken status line.
 */
export function parseAiStatusMessage(data: unknown): AiStatusMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const { kind, status, runId, text } = data as Record<string, unknown>;

  if (!isMember(AI_TASK_KINDS, kind) || !isMember(AI_TASK_STATUSES, status)) {
    return null;
  }

  if (typeof runId !== "string" || runId.length === 0) {
    return null;
  }

  if (text === undefined || typeof text !== "string") {
    return { kind, status, runId };
  }

  return { kind, status, runId, text: text.slice(0, MAX_STATUS_TEXT_LENGTH) };
}

function isMember<T extends string>(
  values: readonly T[],
  value: unknown
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

/**
 * The design agent's live activity stream (26-ai-chat-functional).
 *
 * A Trigger.dev realtime stream rather than a third Liveblocks feed: this is
 * run-token scoped and interesting only while the run is on screen. Putting it
 * on a durable room feed would re-broadcast detailed work to every client.
 *
 * It is read only by the client that started the run, over the same run-scoped
 * token its keyed run and activity observers use.
 */
export const AI_ACTIVITY_STREAM_ID = "design-activity";

/**
 * The models the composer offers, shared by the picker and the worker.
 *
 * Gemini 3 only, and not for tidiness: `thinkingLevel` is a Gemini 3 control
 * (2.x takes a numeric `thinkingBudget`), so keeping the list to one generation
 * is what lets the task send one provider option for every entry.
 *
 * Every id here was run against the real design workload on this project's key
 * before being listed — `models.list` is not evidence, it advertises models that
 * answer 404 on generate. Latency and plan size below are from that run
 * ("Build a CI/CD pipeline", empty canvas).
 */
export const AI_DESIGN_MODELS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", hint: "Fast" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", hint: "Balanced" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash Lite", hint: "Fastest" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", hint: "Deepest" },
] as const;

export type AiDesignModelId = (typeof AI_DESIGN_MODELS)[number]["id"];

export const DEFAULT_AI_DESIGN_MODEL_ID: AiDesignModelId = "gemini-3.6-flash";

/**
 * An allowlist, not a format check: the model id arrives from a browser and is
 * handed to a paid provider call, so anything not offered above is refused
 * rather than forwarded. Absent is not an error — it means "the default" — but
 * a value that is present and unknown is, because it is a request this build
 * cannot honour rather than one it can guess at.
 */
export function parseAiDesignModelId(
  value: unknown
): AiDesignModelId | "invalid" | null {
  if (value === undefined || value === null) {
    return null;
  }

  const match = AI_DESIGN_MODELS.find((model) => model.id === value);

  return match ? match.id : "invalid";
}

export const AI_ACTIVITY_PART_TYPES = ["step", "reasoning", "action"] as const;

export type AiActivityPartType = (typeof AI_ACTIVITY_PART_TYPES)[number];

/**
 * - `step` — a phase of the run ("Reading the canvas").
 * - `reasoning` — a safe, user-facing summary of the agent's current logic.
 * - `action` — one canvas operation the agent performed, named as the operation
 *   itself (`addNode`, `addEdge`, …) with the thing it acted on as `detail`.
 */
export type AiActivityPart = {
  type: AiActivityPartType;
  text: string;
  /** Set on `action` only: the node or edge the operation names. */
  detail?: string;
};

/** Internal marker used to settle only after the final stream chunk arrives. */
export type AiActivityTerminalPart = {
  type: "terminal";
  phase: "complete" | "error";
};

export function isAiActivityTerminalPart(
  data: unknown
): data is AiActivityTerminalPart {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }

  const { type, phase } = data as Record<string, unknown>;

  return type === "terminal" && (phase === "complete" || phase === "error");
}

/** Per-part clamp; the timeline also enforces an aggregate session bound. */
const MAX_ACTIVITY_TEXT_LENGTH = 2000;

/**
 * The same trust boundary as the feed parsers: stream chunks are written by a
 * background task and read by a browser, so a chunk this build cannot read is
 * dropped rather than rendered as an empty row.
 */
export function parseAiActivityPart(data: unknown): AiActivityPart | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const { type, text, detail } = data as Record<string, unknown>;

  if (!isMember(AI_ACTIVITY_PART_TYPES, type) || typeof text !== "string") {
    return null;
  }

  const part: AiActivityPart = {
    type,
    text: text.slice(0, MAX_ACTIVITY_TEXT_LENGTH),
  };

  return typeof detail === "string" && detail.length > 0
    ? { ...part, detail: detail.slice(0, MAX_ACTIVITY_TEXT_LENGTH) }
    : part;
}

/**
 * The room's chat feed (25-sidebar-chat-feed).
 *
 * Deliberately a *second* feed rather than a `kind` on the status one: the
 * status line renders only its latest entry and drops everything older, which is
 * the opposite of what a transcript needs. Sharing a feed would mean each reader
 * filtering out the other's messages on every render.
 */
export const AI_CHAT_FEED_ID = "ai-chat";

export const AI_CHAT_ROLES = ["user", "assistant"] as const;

/**
 * The AI's identity — in the room's presence and on the chat feed.
 *
 * Here rather than in `lib/ai-activity.ts` because the sidebar writes the run's
 * closing line itself (26-ai-chat-functional) and that module is node-only: it
 * holds the Liveblocks secret.
 *
 * `AI_USER_ID` is deliberately not a Clerk ID — `useCollaborators` filters the
 * current user out by Clerk ID, and this must never match anyone.
 */
export const AI_USER_ID = "truss-ai-architect";

export const AI_USER_NAME = "AI Architect";

export type AiChatRole = (typeof AI_CHAT_ROLES)[number];

export type AiChatMessage = {
  role: AiChatRole;
  /** Clerk user ID, matching `UserMeta.id`, so a reader can spot their own lines. */
  senderId: string;
  /** Display name as it was when the message was sent. */
  senderName: string;
  content: string;
  /** The sender's clock, for the visible timestamp only — see `selectAiChatMessages`. */
  sentAt: number;
};

/** Long enough for a paragraph, short enough that one message can't flood the panel. */
export const MAX_CHAT_CONTENT_LENGTH = 2000;
const MAX_CHAT_SENDER_ID_LENGTH = 256;
const MAX_CHAT_SENDER_NAME_LENGTH = 120;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;

/**
 * Same trust boundary as `parseAiStatusMessage`, one step wider: chat messages
 * are written by *other clients*, not by a background task. An entry this build
 * cannot read is skipped rather than rendered as a blank bubble.
 */
export function parseAiChatMessage(data: unknown): AiChatMessage | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const { role, senderId, senderName, content, sentAt } = data as Record<
    string,
    unknown
  >;

  if (!isMember(AI_CHAT_ROLES, role)) {
    return null;
  }

  if (
    typeof senderId !== "string" ||
    senderId.length === 0 ||
    senderId.length > MAX_CHAT_SENDER_ID_LENGTH
  ) {
    return null;
  }

  if (
    typeof senderName !== "string" ||
    senderName.length === 0 ||
    senderName.length > MAX_CHAT_SENDER_NAME_LENGTH
  ) {
    return null;
  }

  // Whitespace-only content is a bubble with nothing in it, so it is junk here
  // rather than a message worth rendering.
  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }

  if (
    typeof sentAt !== "number" ||
    !Number.isFinite(sentAt) ||
    Math.abs(sentAt) > MAX_DATE_MILLISECONDS
  ) {
    return null;
  }

  return {
    role,
    senderId,
    senderName,
    content: content.slice(0, MAX_CHAT_CONTENT_LENGTH),
    sentAt,
  };
}
