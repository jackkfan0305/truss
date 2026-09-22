import type { AiTimelinePart } from "@/lib/ai-timeline";

/**
 * Turns a run's activity timeline into the task stack the transcript renders.
 *
 * A `step` part opens a group; every `action` and `reasoning` after it joins
 * that group until the next `step`. `artifact` parts stay out of the grouping
 * entirely — a document is the result of a turn rather than a step inside it,
 * and `SpecAttachmentList` already renders those beneath the message.
 *
 * Status comes from position and run phase *together*: neither alone can say
 * whether a group is the one still being worked on.
 *
 * Pure and DOM-free, so `scripts/verify-run-task-groups.ts` can exercise every
 * rule without a browser.
 */

export type RunTaskStatus = "running" | "complete" | "error";

export type RunPhase =
  | "starting"
  | "running"
  | "complete"
  | "error"
  | "incomplete";

export interface RunTaskGroup {
  /** The opening step part's id, so React keeps element identity across renders. */
  id: string;
  title: string;
  status: RunTaskStatus;
  parts: AiTimelinePart[];
}

/**
 * The title for parts that arrive before any step.
 *
 * No worker emits one today — every task fires its step first — so this is a
 * defence rather than a case: a future part that arrives early is shown under
 * a neutral heading instead of being dropped on the floor.
 */
export const RUN_TASK_FALLBACK_TITLE = "Working";

export function selectRunTaskGroups(
  activity: readonly AiTimelinePart[],
  phase: RunPhase
): RunTaskGroup[] {
  const groups: RunTaskGroup[] = [];

  for (const part of activity) {
    if (part.type === "artifact") {
      continue;
    }

    if (part.type === "step") {
      groups.push({ id: part.id, title: part.text, status: "complete", parts: [] });
      continue;
    }

    const open = groups.at(-1);

    if (!open) {
      groups.push({
        id: `${part.id}-lead`,
        title: RUN_TASK_FALLBACK_TITLE,
        status: "complete",
        parts: [part],
      });
      continue;
    }

    open.parts.push(part);
  }

  return groups.map((group, index) => ({
    ...group,
    status:
      index === groups.length - 1
        ? resolveLastGroupStatus(phase)
        : // Earlier groups finished whatever the run went on to do: the work
          // they describe already landed on the canvas.
          "complete",
  }));
}

function resolveLastGroupStatus(phase: RunPhase): RunTaskStatus {
  if (phase === "starting" || phase === "running") {
    return "running";
  }

  // `incomplete` is a run that stopped rather than failed. It shares the error
  // status because both leave a partial diagram; the *wording* differs, and
  // that is the caller's job — it has the phase.
  if (phase === "error" || phase === "incomplete") {
    return "error";
  }

  return "complete";
}
