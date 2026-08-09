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

/**
 * A timeline as it is stored on a chat message: the parts without their ids.
 *
 * Ids are positional (`activity-3`) and rebuilt from the same array on the way
 * back in, so persisting them would only be a second copy of the index.
 */
export function toStorableActivity(
  timeline: readonly AiTimelinePart[]
): AiActivityPart[] {
  return timeline.map((part) => ({
    type: part.type,
    text: part.text,
    ...(part.detail ? { detail: part.detail } : {}),
  }));
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
