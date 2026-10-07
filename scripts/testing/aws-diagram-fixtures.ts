/**
 * AWS diagram test fixtures.
 *
 * Factories for creating canonical test nodes and snapshots with AWS identity
 * and nested boundaries. Used across verification scripts to avoid independent
 * incompatible test trees.
 */

import type { CanvasNode } from "@/types/canvas";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { CANVAS_NODE_TYPE, CANVAS_BOUNDARY_TYPE } from "@/types/canvas";

/**
 * Creates a canonical AWS or boundary node for testing.
 * Boundaries and services get their catalog defaults;  parentId is optional.
 */
export function awsNode(
  id: string,
  catalogId: string,
  parentId?: string,
): CanvasNode {
  const boundary = catalogId.startsWith("boundary-");
  return {
    id,
    type: boundary ? CANVAS_BOUNDARY_TYPE : CANVAS_NODE_TYPE,
    position: { x: 24, y: 64 },
    width: boundary ? 400 : 180,
    height: boundary ? 240 : 100,
    ...(parentId ? { parentId } : {}),
    data: {
      label: id,
      shape: "rectangle",
      color: "neutral",
      kind: boundary ? "boundary" : "aws-service",
      catalogId,
    },
  };
}

/**
 * Creates a nested AWS diagram with three boundary levels and two services.
 * Cloud > VPC > Subnets > Services.
 */
export function nestedSnapshot(): CanvasSnapshot {
  return {
    nodes: [
      { ...awsNode("cloud", "boundary-aws-cloud"), position: { x: 100, y: 80 }, width: 1400, height: 1000 },
      { ...awsNode("vpc", "boundary-vpc", "cloud"), position: { x: 32, y: 64 }, width: 900, height: 650 },
      { ...awsNode("public", "boundary-subnet", "vpc"), position: { x: 24, y: 64 }, width: 400, height: 240 },
      { ...awsNode("private", "boundary-subnet", "vpc"), position: { x: 488, y: 64 }, width: 360, height: 400 },
      { ...awsNode("web", "aws-ec2", "public"), position: { x: 24, y: 64 } },
      { ...awsNode("uploads", "aws-s3", "private"), position: { x: 24, y: 64 } },
    ],
    edges: [],
  };
}
