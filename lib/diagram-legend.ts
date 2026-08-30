import type { NodeColor, NodeShape } from "@/types/canvas";

/**
 * The one canonical diagram vocabulary — what a shape means, what a color
 * layer means, and when an edge gets a label.
 *
 * Two different agents draw Truss diagrams: the in-app design agent
 * (`lib/design-prompt.ts`) and the external `truss-diagram` skill
 * (`.agents/skills/truss-diagram/`). Both need the same answer to "what does
 * this shape mean", or the two populations of diagrams read as drawn by two
 * different people. That answer lives here, once, as code rather than as
 * prose duplicated in `lib/design-prompt.ts` and in the skill's
 * `references/graph-schema.md`: a `Record<NodeShape, string>` breaks the
 * build the moment a shape is added to `NODE_SHAPES` without a meaning to go
 * with it, which a second copy of a markdown table cannot do. The markdown
 * copy is kept honest instead by `scripts/verify-design-agent.ts`, which reads
 * both this file and the skill's `graph-schema.md` and fails if the meanings
 * drift apart.
 */

/**
 * Shape = the kind of thing a node represents. Chosen so the six options are
 * mutually exclusive for anything worth putting on a diagram: a box either
 * runs continuously, holds state, decides something, or is a boundary — never
 * two of those at once.
 */
export const NODE_SHAPE_LEGEND: Record<NodeShape, string> = {
  rectangle:
    "a service or component you would own and deploy — the default box for anything you build",
  pill: "a process, worker, or job: something that runs on its own rather than something callers call directly",
  cylinder: "durable storage — a database, queue-backed store, or file store that outlives one request",
  diamond: "a decision, route, or branch point in the flow",
  circle: "an actor or an entry/exit point — a user, a client, an external caller, or an event source",
  hexagon: "a third-party or external system outside your boundary — you call it, you do not deploy it",
};

/**
 * Color = the layer a node belongs to, not a decoration. Eight layers cover
 * the seams that actually matter in a system diagram (your code vs. someone
 * else's, sync vs. async, the happy path vs. the failure path, who a request
 * is before it's authenticated); `neutral` is the deliberate escape hatch so
 * nothing is forced into a layer it doesn't fit.
 */
export const NODE_COLOR_LEGEND: Record<NodeColor, string> = {
  blue: "your own services — the components this system owns and deploys",
  teal: "data stores — the durable layer, paired with the cylinder shape",
  green: "entry points and clients — where a request or event originates",
  orange: "external or third-party systems — outside your boundary",
  purple: "async or eventing — queues, topics, background jobs, anything not a direct synchronous call",
  pink: "auth or identity — anything that authenticates, authorizes, or issues identity",
  red: "error or failure paths — a path only exercised when something goes wrong",
  neutral: "anything that doesn't fit one of the other seven layers",
};

const EDGE_SEMANTICS = [
  "Edges carry meaning too. An arrow points the direction the request or the",
  "data moves — not just \"these are related\". Draw it from caller to callee,",
  "or from producer to consumer.",
  "",
  "Label an edge only when the source and target don't already say what moves",
  "between them or which protocol it uses — a label repeating what the two",
  "shapes and their names already make obvious is noise. Keep any label to a",
  "few words (a verb, a protocol, a data type — \"reads\", \"gRPC\", \"order",
  "created\"), never a sentence.",
].join("\n");

function renderLegendTable(
  title: string,
  legend: Record<string, string>
): string {
  const rows = Object.entries(legend)
    .map(([key, meaning]) => `- ${key}: ${meaning}`)
    .join("\n");

  return `${title}\n${rows}`;
}

/**
 * The whole legend as a prompt block, assembled from the tables above so the
 * text handed to a model can never name a shape or color the tables don't
 * also define.
 */
export const DIAGRAM_LEGEND_PROMPT: string = [
  renderLegendTable("Node shapes are a fixed vocabulary, not a suggestion — the kind of thing a node is:", NODE_SHAPE_LEGEND),
  "",
  renderLegendTable("Node colors are the layer a node belongs to, chosen semantically, never decoratively:", NODE_COLOR_LEGEND),
  "",
  EDGE_SEMANTICS,
].join("\n");
