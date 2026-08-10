import { readAiArtifactSpecId, type AiActivityPart } from "@/types/tasks";

/**
 * The documents a turn produced, read out of its durable work log
 * (36-spec-attachment).
 *
 * In `lib/` rather than beside the card that renders it, for the reason every
 * other selector in this project is: it sits on the same trust boundary as the
 * rest of the feed — an `artifact` part is written by a worker and read by every
 * client in the room — and `scripts/verify-ai-chat.ts` has to be able to
 * exercise it without mounting React.
 */

export interface SpecAttachmentRef {
  specId: string;
  fileName: string;
}

/**
 * Complete artifacts only, in the order they were produced. A part naming no
 * spec would render as a card whose download 404s, and one with no file name
 * would render as a card with nothing written on it — both are worse than
 * nothing, so both are dropped.
 */
export function selectSpecAttachments(
  activity: readonly AiActivityPart[] | undefined
): SpecAttachmentRef[] {
  return (activity ?? []).flatMap((part) => {
    const specId = readAiArtifactSpecId(part);

    return specId && part.text ? [{ specId, fileName: part.text }] : [];
  });
}
