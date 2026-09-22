import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AI_RUN_STEPS } from "../types/tasks";
import { selectOrbState } from "../lib/run-orb-state";

/**
 * The six step verbs are persisted inside chat history, so their *values* are
 * a wire format: a rename would orphan every stored run. The constant exists
 * so the strings are written once, and this file is what stops a later edit
 * from quietly changing one of them.
 */
function checkStepValuesAreStable() {
  assert.deepEqual(AI_RUN_STEPS, {
    readCanvas: "Reading the canvas",
    designCanvas: "Designing the canvas",
    design: "Designing",
    validate: "Validating the proposed changes",
    apply: "Applying to the canvas",
    writeSpec: "Writing the spec",
  });
}

/** A literal left behind in a task file is a seventh vocabulary nobody maps. */
function checkTaskFilesEmitStepsFromTheConstant() {
  for (const path of ["../trigger/orchestrator.ts", "../trigger/design-agent.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const emissions = source.match(/type:\s*"step",\s*text:\s*[^}]+/g) ?? [];

    assert.ok(emissions.length > 0, `${path} emits at least one step`);

    for (const emission of emissions) {
      assert.match(
        emission,
        /text:\s*AI_RUN_STEPS\./,
        `${path} emits every step from AI_RUN_STEPS, not a literal`,
      );
    }
  }
}

/**
 * The orb animates the *kind* of work, so every step has to land on a state
 * deliberately rather than by falling through. An unrecognised string is a
 * real case — a future step, or a row persisted by an older build — and it
 * must animate rather than crash or blank.
 */
function checkEveryStepMapsToAnOrbState() {
  assert.equal(selectOrbState(AI_RUN_STEPS.readCanvas), "searching");
  assert.equal(selectOrbState(AI_RUN_STEPS.designCanvas), "shaping");
  assert.equal(selectOrbState(AI_RUN_STEPS.design), "shaping");
  assert.equal(selectOrbState(AI_RUN_STEPS.validate), "solving");
  assert.equal(selectOrbState(AI_RUN_STEPS.apply), "weaving");
  assert.equal(selectOrbState(AI_RUN_STEPS.writeSpec), "composing");
}

function checkUnknownStepsFallBackRatherThanBlank() {
  assert.equal(selectOrbState("Consulting the oracle"), "working");
  assert.equal(selectOrbState(null), "working");
  assert.equal(selectOrbState(undefined), "working");
  assert.equal(selectOrbState(""), "working");
}

checkStepValuesAreStable();
checkTaskFilesEmitStepsFromTheConstant();
checkEveryStepMapsToAnOrbState();
checkUnknownStepsFallBackRatherThanBlank();
console.log("✅ run step vocabulary checks passed");
