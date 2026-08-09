import { parseAiActivityPart, type AiActivityPart } from "@/types/tasks";

export type AiTimelinePart = AiActivityPart & { id: string };

const MAX_TIMELINE_PARTS = 200;
const MAX_TIMELINE_REASONING_LENGTH = 16_000;

/**
 * Turns untrusted Trigger.dev stream chunks into the chronological activity
 * timeline the sidebar renders. Adjacent reasoning deltas belong to one
 * disclosure; steps and canvas actions remain at their original positions.
 */
export function selectAiActivityTimeline(
  parts: readonly unknown[] | undefined
): AiTimelinePart[] {
  let timeline: AiTimelinePart[] = [];

  for (const [index, rawPart] of (parts ?? []).entries()) {
    timeline = appendAiActivityTimelinePart(timeline, rawPart, index);
  }

  return timeline;
}

/** Adds one onData chunk without relying on the Trigger hook's parts cache. */
export function appendAiActivityTimelinePart(
  timeline: readonly AiTimelinePart[],
  rawPart: unknown,
  sourceIndex: number
): AiTimelinePart[] {
  const part = parseAiActivityPart(rawPart);

  if (!part) {
    return [...timeline];
  }

  const previous = timeline.at(-1);

  if (part.type === "reasoning" && previous?.type === "reasoning") {
    const remaining = Math.max(
      0,
      MAX_TIMELINE_REASONING_LENGTH - previous.text.length
    );

    return [
      ...timeline.slice(0, -1),
      {
        id: previous.id,
        type: "reasoning",
        text: previous.text + part.text.slice(0, remaining),
      },
    ];
  }

  if (timeline.length >= MAX_TIMELINE_PARTS) {
    return [...timeline];
  }

  return [...timeline, { ...part, id: `activity-${sourceIndex}` }];
}
