import {
  canonicalCanvasSnapshotsEqual,
  materializeAgentGraph,
  parseAgentGraph,
} from "@/lib/agent-graph";
import { isAgentLaunchId } from "@/lib/agent-launch";
import {
  drawPacedCanvasActions,
  type CanvasDrawingDependencies,
  type PacedCanvasAction,
} from "@/lib/canvas-drawing";
import type { CanvasSnapshot } from "@/lib/canvas-snapshot";
import { jsonError, readJsonBody } from "@/lib/project-requests";
import type { Authorization } from "@/lib/project-access";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

interface AgentGraphImportFlow {
  readonly nodes: readonly CanvasNode[];
  readonly edges: readonly CanvasEdge[];
  addNodes(nodes: CanvasNode[]): void;
  addEdges(edges: CanvasEdge[]): void;
}

export interface AgentGraphImportDependencies extends CanvasDrawingDependencies {
  authorizeProject: (
    projectId: string,
    options: { requireOwner: true },
  ) => Promise<Authorization>;
  mutateFlow: (
    projectId: string,
    callback: (flow: AgentGraphImportFlow) => void | Promise<void>,
  ) => Promise<void>;
  saveCanvasSnapshot: (projectId: string, snapshot: CanvasSnapshot) => Promise<unknown>;
}

type ImportDecision = "empty" | "exact" | "resume" | "conflict";

function parseImportRequest(value: unknown): CanvasSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const keys = Object.keys(value);

  if (keys.length !== 2 || !keys.includes("launchId") || !keys.includes("graph")) {
    return null;
  }

  const { launchId, graph } = value as { launchId?: unknown; graph?: unknown };

  if (!isAgentLaunchId(launchId)) {
    return null;
  }

  const parsedGraph = parseAgentGraph(graph);
  return parsedGraph ? materializeAgentGraph(parsedGraph) : null;
}

function isExactNode(
  existing: CanvasNode,
  requested: CanvasNode,
): boolean {
  return canonicalCanvasSnapshotsEqual(
    { nodes: [existing], edges: [] },
    { nodes: [requested], edges: [] },
  );
}

function isExactEdge(
  existing: CanvasEdge,
  requested: CanvasEdge,
): boolean {
  return canonicalCanvasSnapshotsEqual(
    { nodes: [], edges: [existing] },
    { nodes: [], edges: [requested] },
  );
}

function findMissingCanonicalItems(
  existing: CanvasSnapshot,
  requested: CanvasSnapshot,
): { nodes: CanvasNode[]; edges: CanvasEdge[] } | null {
  const requestedNodes = new Map(requested.nodes.map((node) => [node.id, node]));
  const requestedEdges = new Map(requested.edges.map((edge) => [edge.id, edge]));

  for (const node of existing.nodes) {
    const requestedNode = requestedNodes.get(node.id);

    if (!requestedNode || !isExactNode(node, requestedNode)) {
      return null;
    }
  }

  for (const edge of existing.edges) {
    const requestedEdge = requestedEdges.get(edge.id);

    if (!requestedEdge || !isExactEdge(edge, requestedEdge)) {
      return null;
    }
  }

  const existingNodeIds = new Set(existing.nodes.map((node) => node.id));
  const existingEdgeIds = new Set(existing.edges.map((edge) => edge.id));

  return {
    nodes: requested.nodes.filter((node) => !existingNodeIds.has(node.id)),
    edges: requested.edges.filter((edge) => !existingEdgeIds.has(edge.id)),
  };
}

/**
 * Injectable owner-only import workflow. Authentication intentionally precedes
 * JSON parsing, so an unauthorised caller cannot probe graph validation.
 */
export async function handleAgentGraphImportPost(
  request: Request,
  projectId: string,
  dependencies: AgentGraphImportDependencies,
): Promise<Response> {
  const access = await dependencies.authorizeProject(projectId, { requireOwner: true });

  if (!access.ok) {
    return access.response;
  }

  const requestedSnapshot = parseImportRequest(await readJsonBody(request));

  if (!requestedSnapshot) {
    return jsonError("Invalid graph import request", 400);
  }

  let decision: ImportDecision = "conflict";
  try {
    await dependencies.mutateFlow(projectId, async (flow) => {
      const existingSnapshot: CanvasSnapshot = {
        nodes: [...flow.nodes],
        edges: [...flow.edges],
      };

      const missingItems = findMissingCanonicalItems(
        existingSnapshot,
        requestedSnapshot,
      );

      if (!missingItems) {
        decision = "conflict";
        return;
      }

      if (missingItems.nodes.length === 0 && missingItems.edges.length === 0) {
        decision = "exact";
        return;
      }

      decision =
        existingSnapshot.nodes.length === 0 && existingSnapshot.edges.length === 0
          ? "empty"
          : "resume";
      const requestedNodes = new Map(
        requestedSnapshot.nodes.map((node) => [node.id, node]),
      );

      const actions: PacedCanvasAction<AgentGraphImportFlow>[] = [
        ...missingItems.nodes.map((node) => ({
          target: () => node.position,
          apply: (target: AgentGraphImportFlow) => {
            target.addNodes([node]);
          },
        })),
        ...missingItems.edges.map((edge) => ({
          target: () => requestedNodes.get(edge.target)?.position ?? null,
          apply: (target: AgentGraphImportFlow) => {
            target.addEdges([edge]);
          },
        })),
      ];

      await drawPacedCanvasActions(projectId, flow, actions, dependencies);
    });
  } catch {
    return jsonError("Could not import the graph", 502);
  }

  if (decision === "conflict") {
    return jsonError("Canvas already contains a different graph", 409);
  }

  try {
    await dependencies.saveCanvasSnapshot(projectId, requestedSnapshot);
  } catch {
    // A Liveblocks write may already have landed. An exact replay will skip the
    // flow write above and retry this persistence boundary.
    return jsonError("Could not save the imported canvas", 502);
  }

  return Response.json({ imported: decision === "empty" || decision === "resume" });
}
