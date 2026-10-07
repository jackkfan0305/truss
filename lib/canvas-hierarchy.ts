/**
 * Canvas hierarchy traversal and validation.
 *
 * Functions for working with nested canvas nodes: computing absolute bounds,
 * validating parent relationships, collecting descendants, and ordering nodes
 * for correct materialization.
 */

import type { CanvasNode, CanvasBounds } from "@/types/canvas";
import { BOUNDARY_PADDING, BOUNDARY_TITLE_HEIGHT } from "@/types/canvas";

/**
 * Computes the absolute bounds of a node in canvas coordinates.
 * Adds every ancestor's position to the node's parent-relative position.
 * Throws if a parent is not found or if there's a cycle.
 */
export function getAbsoluteBounds(
  nodeId: string,
  nodes: readonly CanvasNode[],
): CanvasBounds {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const node = nodeMap.get(nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  let x = node.position.x;
  let y = node.position.y;

  // Walk up the parent chain, accumulating positions
  let parentId = node.parentId;
  const visited = new Set([nodeId]);

  while (parentId) {
    if (visited.has(parentId)) {
      throw new Error(`Containment cycle detected: ${nodeId} -> ... -> ${parentId}`);
    }
    visited.add(parentId);

    const parent = nodeMap.get(parentId);
    if (!parent) {
      throw new Error(`Parent not found: ${parentId} (referenced by ${nodeId})`);
    }

    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return {
    x,
    y,
    width: node.width ?? 180,
    height: node.height ?? 100,
  };
}

/**
 * Computes the usable interior bounds of a boundary node in canvas coordinates.
 * Subtracts padding and title clearance from the boundary's absolute bounds.
 * Used to determine where child nodes can be placed.
 */
export function getBoundaryInterior(
  nodeId: string,
  nodes: readonly CanvasNode[],
): CanvasBounds {
  const bounds = getAbsoluteBounds(nodeId, nodes);
  return {
    x: bounds.x + BOUNDARY_PADDING,
    y: bounds.y + BOUNDARY_TITLE_HEIGHT,
    width: bounds.width - 2 * BOUNDARY_PADDING,
    height: bounds.height - BOUNDARY_PADDING - BOUNDARY_TITLE_HEIGHT,
  };
}

/**
 * Collects all descendant node IDs of a given boundary node.
 * Returns an empty set if the node is not found or has no children.
 */
export function collectDescendantIds(
  nodeId: string,
  nodes: readonly CanvasNode[],
): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const node of nodes) {
      if (node.parentId === id) {
        result.add(node.id);
        visit(node.id);
      }
    }
  };

  visit(nodeId);
  return result;
}

/**
 * Sorts nodes so parents appear before their children.
 * Required for correct materialization and hierarchy validation.
 * Throws if there's a cycle or a missing parent.
 */
export function sortParentsBeforeChildren(nodes: readonly CanvasNode[]): CanvasNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const result: CanvasNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      throw new Error(`Containment cycle detected at: ${nodeId}`);
    }

    visiting.add(nodeId);
    const node = nodeMap.get(nodeId);

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    if (node.parentId) {
      visit(node.parentId);
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    result.push(node);
  };

  for (const node of nodes) {
    visit(node.id);
  }

  return result;
}
