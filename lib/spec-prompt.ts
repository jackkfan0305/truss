import { describeCanvas, formatChatHistory } from "@/lib/canvas-context";
import type { DesignContext } from "@/lib/design-plan";
import type { AiChatMessage } from "@/types/tasks";

/**
 * Everything the spec writer tells the model (35-orchestrator-backend).
 *
 * Moved out of `trigger/generate-spec.ts` for the reason every other prompt in
 * this project lives in `lib/`: pure string building, so `scripts/verify-spec-prompt.ts`
 * can assert on what the model is actually shown without a Trigger runtime.
 */

export const SPEC_SYSTEM_PROMPT = [
  "You are a staff engineer writing the technical specification for a system that a team has diagrammed on a shared canvas.",
  "",
  "Write the spec in Markdown, and return only the Markdown document — no preamble, no commentary, and no surrounding code fence.",
  "",
  "Structure it as:",
  "# <System name>",
  "## Overview — what the system is for, in a short paragraph.",
  "## Architecture — the components from the canvas and how they fit together.",
  "## Components — one subsection per significant node: responsibility, inputs, outputs.",
  "## Data Flow — the paths through the system, following the canvas connections.",
  "## Interfaces & Integrations — boundaries with external systems.",
  "## Open Questions & Risks — what the canvas and conversation leave undecided.",
  "",
  "Node shapes carry meaning: rectangle is a general component, diamond a decision or gateway,",
  "circle an event or endpoint, pill a service or process, cylinder a datastore, hexagon an external system.",
  "",
  // The canvas is a drawing, and the drawing is part of the argument. The old
  // description dropped positions and colors, which left the writer unable to
  // see that a left-to-right layout *is* the data flow.
  "The diagram's layout and colouring carry meaning too, so read them:",
  "- Each node is listed with its position and size. A node's x,y is its top-left corner.",
  "  Flows are laid out left to right or top to bottom, so relative position tells you",
  "  the direction data moves and which components sit at the boundary.",
  "- Colors are used semantically, not decoratively: nodes sharing a colour are usually",
  "  the same kind of thing (a group of services, the datastores, the external systems).",
  "  Describe those groupings; do not name the colours themselves in the document.",
  "",
  "Describe the system the canvas and conversation actually show. Where they are silent, say so under",
  "Open Questions rather than inventing a component, a technology choice, or a requirement.",
].join("\n");

/**
 * The canvas, the conversation, and the emphasis the orchestrator asked for.
 *
 * `focus` is the orchestrator's paraphrase of what the user wanted written up,
 * so it is the last thing read — the same ordering as the design prompt.
 */
export function buildSpecPrompt(input: {
  context: DesignContext;
  history: readonly AiChatMessage[];
  focus?: string;
}): string {
  return [
    describeCanvas(input.context),
    formatChatHistory(input.history),
    input.focus
      ? `Emphasise this in the document: ${input.focus}`
      : "",
    "Write the technical specification for this system.",
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}
