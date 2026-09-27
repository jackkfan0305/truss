"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import { computeEdgeRoutes, type EdgeRoute } from "@/lib/canvas-edge-route";
import {
  diagramGeometryKey,
  getDiagramEdgeLayout,
  type DiagramEdgeLayout,
} from "@/lib/diagram-route";
import { computeParallelEdgeLabelOffsets } from "@/lib/edge-label-layout";
import type { CanvasEdge, CanvasNode } from "@/types/canvas";

/**
 * Routes for every generated edge, computed once per change rather than once
 * per edge: a lane depends on the other edges sharing a node side, so each edge
 * working it out alone would rescan the whole diagram.
 *
 * The canvas already re-renders on every node change (it is a controlled flow),
 * so reading `nodes` here costs nothing beyond the routing pass itself.
 */
interface EdgeLayout {
  savedRoutes: ReadonlyMap<string, DiagramEdgeLayout>;
  routes: ReadonlyMap<string, EdgeRoute>;
  labelOffsets: ReadonlyMap<string, number>;
}

const EMPTY_EDGE_LAYOUT: EdgeLayout = {
  savedRoutes: new Map(),
  routes: new Map(),
  labelOffsets: new Map(),
};

const EdgeRouteContext = createContext<EdgeLayout>(EMPTY_EDGE_LAYOUT);

export function useSavedEdgeRoute(id: string): DiagramEdgeLayout | undefined {
  return useContext(EdgeRouteContext).savedRoutes.get(id);
}

export function useEdgeRoute(id: string): EdgeRoute | undefined {
  return useContext(EdgeRouteContext).routes.get(id);
}

export function useEdgeLabelOffset(id: string): number {
  return useContext(EdgeRouteContext).labelOffsets.get(id) ?? 0;
}

export function CanvasEdgeRouteProvider({
  nodes,
  edges,
  children,
}: {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  children: ReactNode;
}) {
  const savedRoutes = useMemo(() => {
    const result = new Map<string, DiagramEdgeLayout>();
    // Hashed once for the whole diagram: every edge compares against the same
    // key, and rebuilding it per edge would rescan every node on every drag.
    const geometryKey = diagramGeometryKey(nodes);
    for (const edge of edges) {
      const route = getDiagramEdgeLayout(edge, nodes, geometryKey);
      if (route) result.set(edge.id, route);
    }
    return result;
  }, [nodes, edges]);
  const routes = useMemo(() => computeEdgeRoutes(nodes, edges), [nodes, edges]);
  const labelOffsets = useMemo(
    () => computeParallelEdgeLabelOffsets(edges),
    [edges],
  );
  const layout = useMemo(
    () => ({
      savedRoutes,
      routes,
      labelOffsets,
    }),
    [savedRoutes, routes, labelOffsets],
  );

  return (
    <EdgeRouteContext.Provider value={layout}>
      {children}
    </EdgeRouteContext.Provider>
  );
}
