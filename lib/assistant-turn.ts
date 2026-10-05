import type { AssistantEvent } from "@/lib/assistant-chat";

/**
 * One assistant turn as the side chat renders it, folded from the events
 * `runAssistantTurn` emits. Pure and DOM-free, so
 * `scripts/verify-assistant-turn.ts` can exercise it without a browser.
 */

export type AssistantTaskStatus = "running" | "complete" | "error";

/** `incomplete` is a turn the reader stopped: not a failure, so it is worded apart. */
export type AssistantTurnPhase = "running" | "complete" | "error" | "incomplete";

export type AssistantTurnPart =
  | { type: "reasoning"; id: string; text: string }
  | { type: "tool"; id: string; label: string; href?: string; status: AssistantTaskStatus };

export interface AssistantTurn {
  phase: AssistantTurnPhase;
  parts: AssistantTurnPart[];
  /** The reply, every step's text joined. */
  text: string;
  /** An error from `runAssistantTurn`, shown verbatim. */
  notice: string | null;
}

export interface AssistantTaskGroup {
  id: string;
  title: string;
  href?: string;
  status: AssistantTaskStatus;
  reasoning: Extract<AssistantTurnPart, { type: "reasoning" }>[];
}

/** The title for reasoning that arrives before the turn's first tool call. */
export const ASSISTANT_LEAD_TASK_TITLE = "Working";

export function startAssistantTurn(): AssistantTurn {
  return { phase: "running", parts: [], text: "", notice: null };
}

export function applyAssistantEvent(turn: AssistantTurn, event: AssistantEvent): AssistantTurn {
  const last = turn.parts.at(-1);

  switch (event.type) {
    case "text": {
      // Text that resumes after a tool call starts a new paragraph instead of
      // running into the sentence before it.
      const resumesAfterTool = turn.text !== "" && last?.type === "tool" && !turn.text.endsWith("\n");
      return { ...turn, text: turn.text + (resumesAfterTool ? "\n\n" : "") + event.text };
    }
    case "reasoning":
      // Adjacent deltas belong to one disclosure.
      return last?.type === "reasoning"
        ? { ...turn, parts: [...turn.parts.slice(0, -1), { ...last, text: last.text + event.text }] }
        : { ...turn, parts: [...turn.parts, { type: "reasoning", id: `reasoning-${turn.parts.length}`, text: event.text }] };
    case "tool-start":
      return {
        ...turn,
        parts: [...turn.parts, { type: "tool", id: event.id, label: event.label, status: "running" }],
      };
    case "tool-end":
      return {
        ...turn,
        parts: turn.parts.map((part) =>
          part.type === "tool" && part.id === event.id
            ? {
                ...part,
                status: event.ok ? "complete" : "error",
                ...(event.label ? { label: event.label } : {}),
                ...(event.href ? { href: event.href } : {}),
              }
            : part
        ),
      };
  }
}

/** Ends the turn; a tool still running when it stops did not finish. */
export function settleAssistantTurn(
  turn: AssistantTurn,
  outcome: { error: string | null; aborted: boolean }
): AssistantTurn {
  const phase: AssistantTurnPhase = outcome.error ? "error" : outcome.aborted ? "incomplete" : "complete";
  return {
    ...turn,
    phase,
    notice: outcome.error,
    parts: turn.parts.map((part) =>
      part.type === "tool" && part.status === "running"
        ? { ...part, status: phase === "complete" ? "complete" : "error" }
        : part
    ),
  };
}

/**
 * The task stack: each tool call opens a task and the reasoning after it
 * joins that task. Reasoning before any tool call sits under a lead task that
 * runs only while it is the newest task of a live turn.
 */
export function selectAssistantTaskGroups(turn: AssistantTurn): AssistantTaskGroup[] {
  const groups: AssistantTaskGroup[] = [];

  for (const part of turn.parts) {
    if (part.type === "tool") {
      groups.push({ id: part.id, title: part.label, href: part.href, status: part.status, reasoning: [] });
      continue;
    }
    const open = groups.at(-1);
    if (open) {
      open.reasoning.push(part);
    } else {
      groups.push({ id: `${part.id}-lead`, title: ASSISTANT_LEAD_TASK_TITLE, status: "complete", reasoning: [part] });
    }
  }

  // One group led by reasoning means no tool has been called yet.
  if (turn.phase === "running" && groups.length === 1 && turn.parts[0]?.type === "reasoning") {
    groups[0].status = "running";
  }
  return groups;
}
