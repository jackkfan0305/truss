const MAX_TITLE_LENGTH = 120;
const MAX_NODE_LABEL_LENGTH = 80;
const MAX_EDGE_LABEL_LENGTH = 40;

/**
 * Builds a valid compact-launch input with an exact JSON payload length once
 * `{ version: 1, launchId, ...input }` is serialized. Keep this in test code:
 * the production limit is enforced by each launch boundary.
 */
export function createAgentLaunchFragmentBoundaryInput(
  targetJsonLength,
  launchId,
) {
  const nodeId = (index) => `node-${index}-${"x".repeat(40)}`;
  const edgeId = (index) => `edge-${index}-${"x".repeat(40)}`;
  const nodes = Array.from({ length: 20 }, (_, index) => ({
    id: nodeId(index),
    label: "n",
    shape: "rectangle",
    color: "blue",
    x: index * 240,
    y: 0,
  }));
  const edges = Array.from({ length: 40 }, (_, index) => {
    const sourceIndex = Math.floor(index / 19);
    const offset = index % 19;
    const targetIndex = offset >= sourceIndex ? offset + 1 : offset;

    return {
      id: edgeId(index),
      source: nodeId(sourceIndex),
      target: nodeId(targetIndex),
      label: "",
    };
  });
  const input = { title: "T", graph: { version: 1, nodes, edges } };
  let remaining = targetJsonLength - JSON.stringify({ version: 1, launchId, ...input }).length;

  for (const field of [input, ...nodes, ...edges]) {
    const maximumAddition =
      field === input
        ? MAX_TITLE_LENGTH - field.title.length
        : "shape" in field
          ? MAX_NODE_LABEL_LENGTH - field.label.length
          : MAX_EDGE_LABEL_LENGTH - field.label.length;
    const addition = Math.min(remaining, maximumAddition);

    if (field === input) {
      field.title += "x".repeat(addition);
    } else {
      field.label += "x".repeat(addition);
    }
    remaining -= addition;
  }

  if (remaining !== 0) {
    throw new Error("Unable to construct the requested launch-fragment fixture.");
  }

  return input;
}
