import assert from "node:assert/strict";

import type { AiTimelinePart } from "../lib/ai-timeline";
import {
  RUN_TASK_FALLBACK_TITLE,
  selectRunTaskGroups,
} from "../lib/run-task-groups";
import { AI_RUN_STEPS } from "../types/tasks";

/**
 * The work log is the record of what the agent did to the canvas, so the two
 * things that must never go wrong are which parts belong to which step and
 * which step is still running. Both are derived rather than stored, so both
 * are checked here.
 */

const TIMELINE: AiTimelinePart[] = [
  { id: "a0", type: "step", text: AI_RUN_STEPS.readCanvas },
  { id: "a1", type: "reasoning", text: "Three services, no queue." },
  { id: "a2", type: "step", text: AI_RUN_STEPS.apply },
  { id: "a3", type: "action", text: "addNode", detail: "Queue" },
  { id: "a4", type: "action", text: "addEdge", detail: "API → Queue" },
  { id: "a5", type: "artifact", text: "design.md", detail: "spec_1" },
];

function checkEachStepOpensAGroup() {
  const groups = selectRunTaskGroups(TIMELINE, "complete");

  assert.equal(groups.length, 2, "one group per step");
  assert.equal(groups[0].title, AI_RUN_STEPS.readCanvas);
  assert.equal(groups[1].title, AI_RUN_STEPS.apply);
}

function checkPartsJoinTheStepBeforeThem() {
  const groups = selectRunTaskGroups(TIMELINE, "complete");

  assert.deepEqual(
    groups[0].parts.map((part) => part.id),
    ["a1"],
  );
  assert.deepEqual(
    groups[1].parts.map((part) => part.id),
    ["a3", "a4"],
  );
}

/** A document is the result of a turn, not a step inside it. */
function checkArtifactsAreExcluded() {
  const groups = selectRunTaskGroups(TIMELINE, "complete");
  const ids = groups.flatMap((group) => group.parts.map((part) => part.id));

  assert.ok(!ids.includes("a5"), "an artifact never lands in a task group");
}

/** Position plus phase, together — neither alone decides a group's status. */
function checkLiveRunsRunOnlyTheirLastGroup() {
  const groups = selectRunTaskGroups(TIMELINE, "running");

  assert.equal(groups[0].status, "complete", "an earlier group has finished");
  assert.equal(groups[1].status, "running", "the last group is the live one");
}

function checkStartingIsLiveToo() {
  const groups = selectRunTaskGroups(TIMELINE, "starting");

  assert.equal(groups.at(-1)?.status, "running");
}

function checkFinishedRunsAreCompleteThroughout() {
  for (const group of selectRunTaskGroups(TIMELINE, "complete")) {
    assert.equal(group.status, "complete");
  }
}

function checkFailedRunsMarkOnlyTheLastGroup() {
  const groups = selectRunTaskGroups(TIMELINE, "error");

  assert.equal(groups[0].status, "complete", "work that landed still landed");
  assert.equal(groups[1].status, "error");
}

/**
 * A stopped run reads as an error status here and takes its *wording* from
 * the phase at the call site — "stopped", not "failed".
 */
function checkIncompleteRunsMarkOnlyTheLastGroup() {
  const groups = selectRunTaskGroups(TIMELINE, "incomplete");

  assert.equal(groups[0].status, "complete");
  assert.equal(groups[1].status, "error");
}

function checkAnEmptyRunHasNoGroups() {
  assert.deepEqual(selectRunTaskGroups([], "running"), []);
}

/** A turn that answered in words and did nothing else produces nothing. */
function checkAnArtifactOnlyRunHasNoGroups() {
  const activity: AiTimelinePart[] = [
    { id: "b0", type: "artifact", text: "design.md", detail: "spec_1" },
  ];

  assert.deepEqual(selectRunTaskGroups(activity, "complete"), []);
}

/**
 * Defensive: no part exists before its step fires today, but a worker that
 * emitted one must not silently lose it.
 */
function checkPartsBeforeAnyStepGetAFallbackGroup() {
  const activity: AiTimelinePart[] = [
    { id: "c0", type: "reasoning", text: "Ahead of the first step." },
    { id: "c1", type: "step", text: AI_RUN_STEPS.design },
  ];
  const groups = selectRunTaskGroups(activity, "complete");

  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, RUN_TASK_FALLBACK_TITLE);
  // Not "c0": that part is also inside `parts`, and two React keys colliding
  // in one subtree is the bug this suffix exists to avoid.
  assert.equal(groups[0].id, "c0-lead");
  assert.deepEqual(
    groups[0].parts.map((part) => part.id),
    ["c0"],
  );
}

/** Group ids are stable across renders so React keeps element identity. */
function checkGroupIdsComeFromTheirStep() {
  const groups = selectRunTaskGroups(TIMELINE, "complete");

  assert.equal(groups[0].id, "a0");
  assert.equal(groups[1].id, "a2");
  assert.deepEqual(
    selectRunTaskGroups(TIMELINE, "running").map((group) => group.id),
    ["a0", "a2"],
    "the ids do not move when the phase does",
  );
}

checkEachStepOpensAGroup();
checkPartsJoinTheStepBeforeThem();
checkArtifactsAreExcluded();
checkLiveRunsRunOnlyTheirLastGroup();
checkStartingIsLiveToo();
checkFinishedRunsAreCompleteThroughout();
checkFailedRunsMarkOnlyTheLastGroup();
checkIncompleteRunsMarkOnlyTheLastGroup();
checkAnEmptyRunHasNoGroups();
checkAnArtifactOnlyRunHasNoGroups();
checkPartsBeforeAnyStepGetAFallbackGroup();
checkGroupIdsComeFromTheirStep();
console.log("✅ run task grouping checks passed");
