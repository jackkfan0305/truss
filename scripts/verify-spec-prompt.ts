import assert from "node:assert/strict";

import { SPEC_SYSTEM_PROMPT, buildSpecPrompt } from "../lib/spec-prompt";
import type { DesignContext } from "../lib/design-plan";
import {
  CANVAS_EDGE_TYPE,
  CANVAS_NODE_TYPE,
  type CanvasEdge,
  type CanvasNode,
} from "../types/canvas";
import type { AiChatMessage } from "../types/tasks";

/**
 * What the spec writer is shown (35-orchestrator-backend).
 *
 * The spec agent used to see `- name (shape)` and nothing else: no positions,
 * no colors, no IDs. It therefore could not tell that a left-to-right layout
 * *is* the data flow, or that the teal nodes are the datastores — exactly the
 * structure the diagram encodes. These assertions are what keeps that from
 * silently regressing, because a thinner prompt still produces a document.
 */

function node(
  id: string,
  label: string,
  shape: CanvasNode["data"]["shape"],
  color: CanvasNode["data"]["color"],
  x: number,
  y: number,
): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPE,
    position: { x, y },
    width: 180,
    height: 80,
    data: { label, color, shape },
  };
}

function edge(id: string, source: string, target: string, label: string): CanvasEdge {
  return { id, type: CANVAS_EDGE_TYPE, source, target, data: { label } };
}

const context: DesignContext = {
  nodes: [
    node("gateway", "API Gateway", "hexagon", "orange", 0, 0),
    node("orders", "Orders Service", "pill", "blue", 380, 0),
    node("ordersdb", "Orders DB", "cylinder", "teal", 760, 0),
  ],
  edges: [edge("e1", "gateway", "orders", "REST"), edge("e2", "orders", "ordersdb", "writes")],
};

const history: AiChatMessage[] = [
  { role: "user", content: "Add a payments service", senderId: "u1", senderName: "Ada", sentAt: 0 },
];

function checkCanvasReachesTheWriterWhole() {
  const prompt = buildSpecPrompt({ context, history });

  // Positions: the writer reads layout as flow direction, so a node listed
  // without one leaves it guessing which end of the system it is.
  assert.match(prompt, /at 0,0 \| 180x80/, "positions and sizes survive");
  assert.match(prompt, /at 760,0/, "every node is placed, not just the first");

  // Colors: the design agent uses them semantically (teal for stores), which is
  // grouping information the document is supposed to describe.
  assert.match(prompt, /teal/, "colors survive");
  assert.match(prompt, /cylinder/, "shapes survive");

  // Connections, by ID and by direction.
  assert.match(prompt, /gateway -> orders/, "edge direction survives");
  assert.match(prompt, /"writes"/, "edge labels survive");

  // The conversation, because a request made in chat is a requirement that may
  // never have reached the canvas.
  assert.match(prompt, /Add a payments service/, "chat history survives");
}

function checkFocusIsOptionalAndLast() {
  const withoutFocus = buildSpecPrompt({ context, history });
  const withFocus = buildSpecPrompt({ context, history, focus: "the failure modes" });

  assert.doesNotMatch(withoutFocus, /Emphasise/, "no focus, no line about one");
  assert.match(withFocus, /Emphasise this in the document: the failure modes/);
  assert.ok(
    withFocus.indexOf("Emphasise") > withFocus.indexOf("Add a payments service"),
    "the emphasis is read after the context it applies to",
  );
}

function checkEmptyCanvasStillDescribesItself() {
  const prompt = buildSpecPrompt({ context: { nodes: [], edges: [] }, history: [] });

  assert.match(prompt, /The canvas is empty\./);
  assert.match(prompt, /Write the technical specification/);
}

/**
 * The rule that keeps the document honest. A spec writer with a partial diagram
 * will happily fill the gaps with a plausible technology choice, and a plausible
 * invention is worse than a stated omission because nobody can tell it apart
 * from a decision the team made.
 */
function checkTheDoNotInventRuleSurvives() {
  assert.match(
    SPEC_SYSTEM_PROMPT,
    /Where they are silent, say so under\s+Open Questions rather than inventing a component, a technology choice, or a requirement\./,
  );

  // The structure the document is written to, and the two readings of the
  // diagram that were added with it.
  for (const heading of [
    "## Overview",
    "## Architecture",
    "## Components",
    "## Data Flow",
    "## Interfaces & Integrations",
    "## Open Questions & Risks",
  ]) {
    assert.ok(SPEC_SYSTEM_PROMPT.includes(heading), `prompt names ${heading}`);
  }

  assert.match(SPEC_SYSTEM_PROMPT, /top-left corner/, "explains what x,y means");
  assert.match(SPEC_SYSTEM_PROMPT, /semantically, not decoratively/, "explains colour");
  assert.match(
    SPEC_SYSTEM_PROMPT,
    /do not name the colours themselves/,
    "the reader of a spec does not care what colour a box was",
  );
}

function main() {
  checkCanvasReachesTheWriterWhole();
  checkFocusIsOptionalAndLast();
  checkEmptyCanvasStillDescribesItself();
  checkTheDoNotInventRuleSurvives();

  console.log("✅ Spec prompt canvas fidelity and the do-not-invent rule verified");
}

try {
  main();
} catch (error) {
  console.error("❌ Spec prompt verification failed");
  console.error(error);
  process.exitCode = 1;
}
