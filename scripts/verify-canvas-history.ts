import assert from "node:assert/strict";

import {
  EMPTY_CANVAS_HISTORY,
  MAX_CANVAS_HISTORY,
  isCanvasHistoryCommit,
  pushCanvasHistory,
  redoCanvasHistory,
  undoCanvasHistory,
} from "../lib/canvas-history";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { CANVAS_NODE_TYPE, type CanvasNode } from "../types/canvas";

function node(id: string, extra: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x: 0, y: 0 },
    data: { label: id, color: "neutral", shape: "rectangle" },
    ...extra,
  } as CanvasNode;
}

const s = (label: string): CanvasSnapshot => ({ nodes: [node(label)], edges: [] });

function checkUndoRedoRoundTrip() {
  const pushed = pushCanvasHistory(pushCanvasHistory(EMPTY_CANVAS_HISTORY, s("a")), s("b"));
  const undone = undoCanvasHistory(pushed, s("c"));
  assert.ok(undone);
  assert.equal(undone.snapshot.nodes[0].id, "b");
  assert.deepEqual(undone.stacks.future.map((x) => x.nodes[0].id), ["c"]);

  const redone = redoCanvasHistory(undone.stacks, undone.snapshot);
  assert.ok(redone);
  assert.equal(redone.snapshot.nodes[0].id, "c");
  assert.deepEqual(redone.stacks.past.map((x) => x.nodes[0].id), ["a", "b"]);
}

function checkEdgesOfTheStacks() {
  assert.equal(undoCanvasHistory(EMPTY_CANVAS_HISTORY, s("x")), null, "nothing to undo");
  assert.equal(redoCanvasHistory(EMPTY_CANVAS_HISTORY, s("x")), null, "nothing to redo");

  const undone = undoCanvasHistory(pushCanvasHistory(EMPTY_CANVAS_HISTORY, s("a")), s("b"));
  assert.ok(undone);
  const branched = pushCanvasHistory(undone.stacks, s("a"));
  assert.deepEqual(branched.future, [], "a new edit after undo drops the redo branch");
}

function checkTheCap() {
  let stacks = EMPTY_CANVAS_HISTORY;
  for (let index = 0; index < MAX_CANVAS_HISTORY + 5; index += 1) {
    stacks = pushCanvasHistory(stacks, s(`n${index}`));
  }
  assert.equal(stacks.past.length, MAX_CANVAS_HISTORY);
  assert.equal(stacks.past[0].nodes[0].id, "n5", "the oldest entries fall off first");
}

/** Review Focus 5: a remote apply resets history to empty. */
function checkResetEmptiesBothStacks() {
  assert.deepEqual(EMPTY_CANVAS_HISTORY, { past: [], future: [] });
}

/** Review Focus 4: one drag is one entry, and measuring is not an edit. */
function checkCommitClassification() {
  const idle = [node("a")];
  const dragging = [node("a", { dragging: true })];
  const resizing = [node("a", { resizing: true })];

  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", dragging: true, position: { x: 1, y: 0 } }, idle), true, "drag start");
  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", dragging: true, position: { x: 2, y: 0 } }, dragging), false, "mid drag");
  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", dragging: false, position: { x: 3, y: 0 } }, dragging), false, "drag end");
  assert.equal(isCanvasHistoryCommit({ type: "position", id: "a", position: { x: 20, y: 0 } }, idle), true, "arrow-key move");

  assert.equal(isCanvasHistoryCommit({ type: "dimensions", id: "a", dimensions: { width: 10, height: 10 } }, idle), false, "measurement");
  assert.equal(isCanvasHistoryCommit({ type: "dimensions", id: "a", resizing: true, dimensions: { width: 10, height: 10 } }, idle), true, "resize start");
  assert.equal(isCanvasHistoryCommit({ type: "dimensions", id: "a", resizing: true, dimensions: { width: 12, height: 10 } }, resizing), false, "mid resize");

  assert.equal(isCanvasHistoryCommit({ type: "select", id: "a", selected: true }, idle), false, "selection");
  assert.equal(isCanvasHistoryCommit({ type: "remove", id: "a" }, idle), true);
  assert.equal(isCanvasHistoryCommit({ type: "replace", id: "a", item: node("a") }, idle), true, "label or colour edit");
}

checkUndoRedoRoundTrip();
checkEdgesOfTheStacks();
checkTheCap();
checkResetEmptiesBothStacks();
checkCommitClassification();
console.log("✅ canvas history verified");
