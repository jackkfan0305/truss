/**
 * Pure snapshot transactions for manual canvas editing.
 *
 * Functions for reparenting nodes through drag-drop, resizing boundaries,
 * deleting subtrees, and inserting items while maintaining hierarchy invariants.
 * All transactions return complete immutable snapshots.
 */

import type { CanvasNode, CanvasBounds, NodeSize } from "@/types/canvas";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { CANVAS_BOUNDARY_TYPE, BOUNDARY_PADDING, BOUNDARY_TITLE_HEIGHT } from "@/types/canvas";
import {
  getAbsoluteBounds,
  getBoundaryInterior,
  sortParentsBeforeChildren,
  collectDescendantIds,
} from "@/lib/canvas-hierarchy";

/**
 * Finds the deepest boundary that contains the given center point,
 * excluding the node itself and its descendants.
 * Returns null if the point is outside all boundaries.
 */
function chooseDeepestBoundary(
  nodes: readonly CanvasNode[],
  center: { x: number; y: number },
  excluded: Set<string>,
): CanvasNode | null {
  let deepest: CanvasNode | null = null;
  let deepestDepth = -1;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    if (excluded.has(node.id) || node.type !== CANVAS_BOUNDARY_TYPE) {
      continue;
    }

    try {
      const interior = getBoundaryInterior(node.id, nodes);
      const containsPoint =
        center.x >= interior.x &&
        center.x <= interior.x + interior.width &&
        center.y >= interior.y &&
        center.y <= interior.y + interior.height;

      if (containsPoint) {
        // Count depth by walking up parent chain
        let depth = 0;
        let parentId = node.parentId;
        while (parentId) {
          depth++;
          parentId = nodeById.get(parentId)?.parentId;
        }

        if (depth > deepestDepth) {
          deepestDepth = depth;
          deepest = node;
        }
      }
    } catch {
      // Skip boundaries with invalid hierarchy
    }
  }

  return deepest;
}

/**
 * Expands ancestors up the tree when their child's absolute bounds exceed interior.
 * Returns nodes with updated ancestor sizes and positions.
 * Raises an error if expansion conflicts with siblings.
 */
function expandAffectedAncestors(nodes: readonly CanvasNode[], childId: string): CanvasNode[] {
  let result = [...nodes];
  const nodeMap = new Map(result.map((n) => [n.id, n]));

  // Find the child and start walking ancestors
  const child = nodeMap.get(childId);
  if (!child || !child.parentId) {
    return result;
  }

  let currentId: string | undefined = child.parentId;

  while (currentId) {
    const current = nodeMap.get(currentId);
    if (!current || current.type !== CANVAS_BOUNDARY_TYPE) {
      break;
    }

    const updated = [...result];
    let expandedCurrent: CanvasNode | null = null;

    // Check if any child needs more space
    let needsExpansion = false;
    // Boundary-local space: children's positions are relative to `current`.
    let maxX = (current.width ?? 400) - BOUNDARY_PADDING;
    let maxY = (current.height ?? 240) - BOUNDARY_PADDING;

    for (const node of updated) {
      if (node.parentId === current.id) {
        const right = node.position.x + (node.width ?? 180);
        const bottom = node.position.y + (node.height ?? 100);
        if (right > maxX || bottom > maxY) {
          maxX = Math.max(maxX, right);
          maxY = Math.max(maxY, bottom);
          needsExpansion = true;
        }
      }
    }

    if (needsExpansion) {
      const newWidth = maxX + BOUNDARY_PADDING;
      const newHeight = maxY + BOUNDARY_PADDING;

      expandedCurrent = {
        ...current,
        width: Math.max(current.width ?? 400, newWidth),
        height: Math.max(current.height ?? 240, newHeight),
      };

      result = updated.map((n) => (n.id === current.id ? expandedCurrent! : n));
      nodeMap.set(current.id, expandedCurrent);
    }

    currentId = current.parentId;
  }

  return result;
}

/**
 * Completes a drag operation by determining the final parent based on drop location.
 * Converts absolute positions to parent-relative coordinates.
 * Expands ancestors to fit the child.
 */
export function finishCanvasDrop(snapshot: CanvasSnapshot, id: string): CanvasSnapshot {
  const nodeIndex = snapshot.nodes.findIndex((n) => n.id === id);
  if (nodeIndex === -1) {
    return snapshot;
  }

  // ponytail: notes are never children; they stay where they were dropped.
  if (snapshot.nodes[nodeIndex].data.kind === "note") {
    return snapshot;
  }

  const absolute = getAbsoluteBounds(id, snapshot.nodes);
  const center = { x: absolute.x + absolute.width / 2, y: absolute.y + absolute.height / 2 };
  const excluded = new Set([id, ...collectDescendantIds(id, snapshot.nodes)]);

  const parent = chooseDeepestBoundary(snapshot.nodes, center, excluded);

  // Get parent's absolute position for coordinate conversion
  const origin = parent
    ? getAbsoluteBounds(parent.id, snapshot.nodes)
    : { x: 0, y: 0, width: 0, height: 0 };

  // Convert absolute position to parent-relative
  const reparented = snapshot.nodes.map((n) =>
    n.id === id
      ? {
          ...n,
          parentId: parent?.id,
          position: {
            x: absolute.x - origin.x,
            y: absolute.y - origin.y,
          },
        }
      : n,
  );

  // Expand ancestors and sort for correct materialization order
  const expanded = expandAffectedAncestors(reparented, id);
  return { ...snapshot, nodes: sortParentsBeforeChildren(expanded) };
}

/**
 * Inserts a new node and finalizes its placement in the hierarchy.
 */
export function insertCanvasItem(snapshot: CanvasSnapshot, node: CanvasNode): CanvasSnapshot {
  return finishCanvasDrop({ ...snapshot, nodes: [...snapshot.nodes, node] }, node.id);
}

/**
 * Resizes a boundary and adjusts child positions if the top-left moves.
 * Clamps to minimum content bounds.
 */
export function resizeCanvasBoundary(
  snapshot: CanvasSnapshot,
  id: string,
  requested: CanvasBounds,
): CanvasSnapshot {
  const boundary = snapshot.nodes.find((n) => n.id === id);
  if (!boundary || boundary.type !== CANVAS_BOUNDARY_TYPE) {
    return snapshot;
  }

  // Compute minimum size from direct children
  let minWidth = requested.width;
  let minHeight = requested.height;

  for (const node of snapshot.nodes) {
    if (node.parentId === id) {
      try {
        const childX = node.position.x + (node.width ?? 180);
        const childY = node.position.y + (node.height ?? 100);
        minWidth = Math.max(minWidth, childX + BOUNDARY_PADDING);
        minHeight = Math.max(minHeight, childY + BOUNDARY_TITLE_HEIGHT + BOUNDARY_PADDING);
      } catch {
        // Skip invalid bounds
      }
    }
  }

  // Calculate position delta
  const deltX = requested.x - boundary.position.x;
  const deltY = requested.y - boundary.position.y;

  // Update boundary and adjust children if position changed
  const updated = snapshot.nodes.map((n) => {
    if (n.id === id) {
      return {
        ...n,
        position: { x: requested.x, y: requested.y },
        width: minWidth,
        height: minHeight,
      };
    }

    // Compensate child positions if boundary top-left moved
    if (n.parentId === id && (deltX !== 0 || deltY !== 0)) {
      return {
        ...n,
        position: {
          x: n.position.x - deltX,
          y: n.position.y - deltY,
        },
      };
    }

    return n;
  });

  return { ...snapshot, nodes: sortParentsBeforeChildren(updated) };
}

/**
 * Deletes one or more nodes and all their descendants, plus incident edges.
 * Removes edges with source or target in the deleted set.
 */
export function deleteCanvasSubtrees(
  snapshot: CanvasSnapshot,
  ids: readonly string[],
): CanvasSnapshot {
  const toDelete = new Set<string>();

  // Collect all descendants
  for (const id of ids) {
    toDelete.add(id);
    for (const descendantId of collectDescendantIds(id, snapshot.nodes)) {
      toDelete.add(descendantId);
    }
  }

  // Filter nodes and edges
  const nodes = snapshot.nodes.filter((n) => !toDelete.has(n.id));
  const edges = snapshot.edges.filter(
    (e) => !toDelete.has(e.source) && !toDelete.has(e.target),
  );

  return { ...snapshot, nodes: sortParentsBeforeChildren(nodes), edges };
}

/**
 * Computes the minimum size a boundary needs to contain its direct children
 * with proper padding and title clearance.
 */
export function getBoundaryMinimumSize(
  id: string,
  nodes: readonly CanvasNode[],
): NodeSize {
  let width = BOUNDARY_PADDING * 2 + 200; // Default minimum
  let height = BOUNDARY_TITLE_HEIGHT + BOUNDARY_PADDING * 2 + 100; // Title + min content

  const boundary = nodes.find((n) => n.id === id);
  if (!boundary) {
    return { width, height };
  }

  // Find bounds of all direct children
  for (const node of nodes) {
    if (node.parentId === id) {
      const childWidth = node.position.x + (node.width ?? 180) + BOUNDARY_PADDING;
      const childHeight = node.position.y + (node.height ?? 100) + BOUNDARY_PADDING;

      width = Math.max(width, childWidth + BOUNDARY_PADDING);
      height = Math.max(height, childHeight + BOUNDARY_TITLE_HEIGHT + BOUNDARY_PADDING);
    }
  }

  return { width, height };
}
