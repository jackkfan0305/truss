import type { OrbState } from "thinking-orbs";

import { AI_RUN_STEPS } from "@/types/tasks";

/**
 * Which orb animation stands for which phase of a run.
 *
 * A type-only import of the package, so this module stays loadable from a
 * plain node verify script — `OrbState` is erased at build time and nothing
 * from `thinking-orbs` is executed here.
 *
 * The keys come from `AI_RUN_STEPS` rather than being retyped, so a step whose
 * wording is ever corrected cannot silently fall off the map.
 */
const ORB_STATE_BY_STEP: Record<string, OrbState> = {
  [AI_RUN_STEPS.readCanvas]: "searching",
  [AI_RUN_STEPS.designCanvas]: "shaping",
  [AI_RUN_STEPS.design]: "shaping",
  [AI_RUN_STEPS.validate]: "solving",
  [AI_RUN_STEPS.apply]: "weaving",
  [AI_RUN_STEPS.writeSpec]: "composing",
};

/**
 * `working` is the fallback rather than an error, and it covers two real
 * cases: a step a future build emits, and a row persisted before that step
 * existed. Both are a run that is working — the orb just cannot say at what.
 */
export function selectOrbState(step: string | null | undefined): OrbState {
  if (!step) return "working";

  return ORB_STATE_BY_STEP[step] ?? "working";
}
