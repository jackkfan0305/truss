import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GET as catalogRoute } from "../app/api/agent/catalog/route";
import { canvasFingerprint, canvasToAgentGraph } from "../lib/agent-graph";
import { createSnapshotFlow, type AgentCanvasWriteDependencies } from "../lib/agent-canvas-write";
import { handleAgentGraphEditPost } from "../lib/agent-graph-edit-server";
import { handleAgentGraphImportPost } from "../lib/agent-graph-import-server";
import { handleAgentGraphGet } from "../lib/agent-graph-read-server";
import { parseRequestedVersion } from "../lib/agent-graph-version";
import { AWS_CATALOG } from "../lib/aws-catalog";
import { createAssistantActions } from "../lib/assistant-tools";
import type { CanvasSnapshot } from "../lib/canvas-snapshot";
import { validateDiagramGeometry } from "../lib/diagram-geometry";
import type { CanvasNode } from "../types/canvas";
import { awsNode, nestedSnapshot } from "./testing/aws-diagram-fixtures";

/**
 * One persisted nested diagram, driven through the browser assistant's actions
 * and the terminal core against the same handler-backed HTTP server. Nothing
 * here is canned: validation, ELK layout, geometry checks, fingerprints and the
 * committed snapshots all come from the production handlers.
 */

const watchdog = setTimeout(() => {
  console.error("verify-aws-agent-roundtrip: TIMED OUT.");
  process.exit(1);
}, 60_000);
watchdog.unref();

const store = new Map<string, CanvasSnapshot>();
let writes = 0;

const dependencies: AgentCanvasWriteDependencies = {
  authorizeDiagram: async () => ({ ok: true as const, userId: "owner" }),
  mutateCanvas: async (diagramId, callback) => {
    const flow = createSnapshotFlow(store.get(diagramId) ?? { nodes: [], edges: [] });
    await callback(flow);
    // Mirrors `mutateStoredCanvas`: only a changed canvas is written.
    if (flow.hasChanged) {
      store.set(diagramId, flow.toSnapshot());
      writes += 1;
    }
  },
};

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const version = parseRequestedVersion(request.url);
  const match = url.pathname.match(/^\/api\/diagrams\/([^/]+)\/(agent-graph|agent-graph-edit|agent-launch-import)$/);

  if (url.pathname === "/api/agent/catalog" && request.method === "GET") return catalogRoute();
  if (url.pathname === "/api/diagrams" && request.method === "GET") {
    return Response.json({ diagrams: [...store.keys()].map((id) => ({ id, name: id })) });
  }
  if (url.pathname === "/api/diagrams" && request.method === "POST") {
    const { id } = (await request.json()) as { id: string };
    store.set(id, { nodes: [], edges: [] });
    return Response.json({ diagram: { id } }, { status: 201 });
  }
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (match[2] === "agent-graph") {
      return handleAgentGraphGet(id, {
        authorizeDiagram: dependencies.authorizeDiagram,
        readCanvas: async (room) => store.get(room) ?? { nodes: [], edges: [] },
      }, version);
    }
    return match[2] === "agent-graph-edit"
      ? handleAgentGraphEditPost(request, id, dependencies, version)
      : handleAgentGraphImportPost(request, id, dependencies, version);
  }
  return Response.json({ error: "not found" }, { status: 404 });
}

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const response = await route(new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }),
  }));
  res.writeHead(response.status, { "content-type": "application/json" });
  res.end(await response.text());
});
async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const home = mkdtempSync(join(tmpdir(), "truss-roundtrip-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const corePath: string = join(process.cwd(), ".agents/skills/truss-diagram/scripts/core.mjs");
  const credentialsPath: string = join(process.cwd(), ".agents/skills/truss-diagram/scripts/credentials.mjs");
  const terminal = (await import(corePath)) as Record<string, (...args: unknown[]) => Promise<TerminalResult>>;
  const credentials = (await import(credentialsPath)) as Record<string, (...args: unknown[]) => Promise<void>>;
  await credentials.writeCredential(origin, `trs_agent_${"A".repeat(43)}`);

  const browser = createAssistantActions({
    fetch: (input, init) => fetch(`${origin}${input}`, init),
    createSuffix: () => "abc123",
  });

  interface TerminalResult {
  graph: { nodes: Record<string, unknown>[] };
  spatial: unknown;
  fingerprint: string;
  opaqueNodeIds: string[];
}

type Spatial = { nodes: { id: string; bounds: { x: number; y: number; width: number; height: number }; editable: boolean }[]; edges: { id: string; layout: { points: unknown[] } | null }[] };
  const boundsOf = (spatial: Spatial) => new Map(spatial.nodes.map((node) => [node.id, node.bounds]));

  try {
    // Every ID comes from the real catalog; the base tree is the shared fixture, coordinates stripped.
    for (const id of ["boundary-aws-cloud", "boundary-region", "boundary-vpc", "boundary-subnet", "boundary-eks-cluster", "aws-ec2", "aws-eks", "aws-s3", "aws-cloudwatch", "aws-lambda"]) {
      assert.ok(AWS_CATALOG.some((entry) => entry.id === id), id);
    }
    const base = canvasToAgentGraph(nestedSnapshot(), 2).graph;
    const stripped = base.nodes.map((node) => {
      const rest: Record<string, unknown> = { ...node };
      for (const key of ["x", "y", "width", "height"]) delete rest[key];
      return rest;
    });
    const longTitle = "Public subnet with an intentionally long title that has to wrap inside";
    const node = (id: string, catalogId: string, label: string, parentId?: string) => ({
      id, kind: catalogId.startsWith("boundary-") ? "boundary" : "aws-service", catalogId, label, ...(parentId ? { parentId } : {}),
    });
    const nestedInput = {
      version: 2 as const,
      nodes: [
        ...stripped.map((entry) => entry.id === "vpc" ? { ...entry, parentId: "region" }
          : entry.id === "public" ? { ...entry, label: longTitle } : entry),
        node("region", "boundary-region", "us-east-1", "cloud"),
        node("cluster", "boundary-eks-cluster", "Platform", "private"),
        node("worker", "aws-eks", "Worker", "cluster"),
        node("audit", "aws-cloudwatch", "Audit", "region"),
        { id: "client", kind: "generic", label: "Client", shape: "circle", color: "blue" },
      ],
      edges: [
        { id: "client-to-web", source: "client", target: "web", label: "HTTPS" },
        { id: "web-to-worker", source: "web", target: "worker", label: "Calls" },
        { id: "worker-to-uploads", source: "worker", target: "uploads", label: "Writes" },
      ],
    };

    // --- create through the browser, read through the terminal ---
    const created = await browser.createDiagram({ title: "AWS round trip", graph: nestedInput as never });
    assert.ok("graph" in created && "fingerprint" in created && "spatial" in created, JSON.stringify(created));
    const diagramId = created.diagramId;
    const stored = () => store.get(diagramId)!;
    assert.equal(created.fingerprint, canvasFingerprint(stored()));
    assert.deepEqual(validateDiagramGeometry(stored()), []);

    const terminalRead = await terminal.getDiagram(origin, diagramId);
    assert.deepEqual(terminalRead.graph, created.graph);
    assert.deepEqual(terminalRead.spatial, created.spatial);
    assert.equal(terminalRead.fingerprint, created.fingerprint);

    // Containment: children sit inside the interior their boundary reserves below its title.
    const spatial0 = created.spatial as Spatial;
    const geometry = new Map(spatial0.nodes.map((entry) => [entry.id, entry as Spatial["nodes"][number] & { parentId: string | null; interior: Spatial["nodes"][number]["bounds"] | null }]));
    for (const entry of geometry.values()) {
      if (!entry.parentId) continue;
      const inside = geometry.get(entry.parentId)!.interior!;
      assert.ok(
        entry.bounds.x >= inside.x && entry.bounds.y >= inside.y
          && entry.bounds.x + entry.bounds.width <= inside.x + inside.width
          && entry.bounds.y + entry.bounds.height <= inside.y + inside.height,
        `${entry.id} stays inside ${entry.parentId}`,
      );
    }
    for (const edge of spatial0.edges) assert.ok((edge.layout?.points.length ?? 0) >= 2, `${edge.id} is routed`);

    // An opaque obstacle joins the persisted canvas before any edit.
    const obstacle: CanvasNode = { ...awsNode("Opaque_Item", "aws-ec2"), position: { x: 4000, y: 40 } };
    store.set(diagramId, { ...stored(), nodes: [...stored().nodes, obstacle] });
    const preEdit = await browser.getDiagram({ diagramId });
    assert.ok("spatial" in preEdit);
    assert.deepEqual(preEdit.opaqueNodeIds, ["Opaque_Item"]);
    const before = boundsOf(preEdit.spatial as Spatial);
    const obstacleBounds = before.get("Opaque_Item")!;
    assert.equal((preEdit.spatial as Spatial).nodes.find((entry) => entry.id === "Opaque_Item")!.editable, false);

    // --- terminal edit adds a service inside one boundary; browser reads the same committed view ---
    const readGraph = (preEdit as { graph: { nodes: unknown[]; edges: unknown[] } }).graph;
    const withApi = { ...readGraph, version: 2 as const, nodes: [...readGraph.nodes, node("api", "aws-lambda", "API", "private")] };
    const edited = await terminal.applyDiagramEdit(origin, diagramId, preEdit.fingerprint, withApi);
    assert.equal(edited.fingerprint, canvasFingerprint(stored()));
    assert.deepEqual(edited.graph, canvasToAgentGraph(stored(), 2).graph);
    const browserRead = await browser.getDiagram({ diagramId });
    assert.ok("spatial" in browserRead);
    assert.deepEqual(browserRead.graph, edited.graph);
    assert.deepEqual(browserRead.spatial, edited.spatial);
    assert.equal(browserRead.fingerprint, edited.fingerprint);
    assert.deepEqual(validateDiagramGeometry(stored()), []);

    const after = boundsOf(edited.spatial as Spatial);
    assert.deepEqual(after.get("Opaque_Item"), obstacleBounds, "the opaque obstacle survives untouched");
    assert.equal((edited.opaqueNodeIds as string[]).join(), "Opaque_Item");
    const api = (edited.spatial as Spatial).nodes.find((entry) => entry.id === "api") as Spatial["nodes"][number] & { parentId: string };
    assert.equal(api.parentId, "private");
    // Ancestors of the changed boundary may grow; everything else holds still.
    for (const id of ["public", "web", "client", "audit", "uploads"]) {
      assert.deepEqual(after.get(id), before.get(id), `${id} keeps its absolute bounds`);
    }

    // --- stale fingerprint through the browser: 409 and the stored snapshot is identical ---
    const snapshotBefore = JSON.stringify(stored());
    const writesBefore = writes;
    const stale = await browser.applyDiagramEdit({
      diagramId, fingerprint: preEdit.fingerprint, graph: withApi as never,
    });
    assert.ok("conflict" in stale, JSON.stringify(stale));
    assert.equal(JSON.stringify(stored()), snapshotBefore);
    assert.equal(writes, writesBefore);

    // Re-read, revise (a cross-boundary connection), and submit successfully.
    const fresh = await browser.getDiagram({ diagramId });
    assert.ok("graph" in fresh);
    const freshGraph = fresh.graph as { nodes: unknown[]; edges: unknown[] };
    const revised = { ...freshGraph, version: 2 as const, edges: [...freshGraph.edges, { id: "api-to-audit", source: "api", target: "audit", label: "Logs" }] };
    const revisedResult = await browser.applyDiagramEdit({ diagramId, fingerprint: fresh.fingerprint, graph: revised as never });
    assert.ok("applied" in revisedResult && "spatial" in revisedResult, JSON.stringify(revisedResult));
    assert.equal(revisedResult.fingerprint, canvasFingerprint(stored()));
    const route = (revisedResult.spatial as Spatial).edges.find((edge) => edge.id === "api-to-audit");
    assert.ok((route?.layout?.points.length ?? 0) >= 2, "the new cross-boundary connection is routed");
    assert.ok((revisedResult.opaqueNodeIds as string[]).includes("Opaque_Item"));
    const terminalAfter = await terminal.getDiagram(origin, diagramId);
    assert.deepEqual(terminalAfter.graph, revisedResult.graph);
    assert.equal(terminalAfter.fingerprint, revisedResult.fingerprint);

    // --- cycles and explicit collisions persist nothing through either client ---
    const settled = JSON.stringify(stored());
    const settledWrites = writes;
    const nodesOf = (revisedResult.graph as { nodes: Record<string, unknown>[] }).nodes;
    const cyclic = { ...(revisedResult.graph as object), version: 2 as const, nodes: nodesOf.map((entry) => entry.id === "region" ? { ...entry, parentId: "vpc" } : entry) };
    const cycleBrowser = await browser.applyDiagramEdit({ diagramId, fingerprint: revisedResult.fingerprint!, graph: cyclic as never });
    assert.ok("error" in cycleBrowser);
    await assert.rejects(terminal.applyDiagramEdit(origin, diagramId, revisedResult.fingerprint, cyclic), /invalid|cycle/i);

    const apiNode = nodesOf.find((entry) => entry.id === "api") as Record<string, number>;
    const uploadsNode = nodesOf.find((entry) => entry.id === "uploads") as Record<string, number>;
    const colliding = {
      ...(revisedResult.graph as object), version: 2 as const,
      nodes: nodesOf.map((entry) => entry.id === "api" ? { ...entry, x: uploadsNode.x, y: uploadsNode.y } : entry),
    };
    assert.notEqual(apiNode.x, uploadsNode.x);
    const collisionBrowser = await browser.applyDiagramEdit({ diagramId, fingerprint: revisedResult.fingerprint!, graph: colliding as never });
    assert.ok("code" in collisionBrowser && collisionBrowser.code === "invalidGeometry", JSON.stringify(collisionBrowser));
    assert.ok((collisionBrowser.issues as { itemIds: string[] }[]).some((issue) => issue.itemIds.includes("api")));
    await assert.rejects(
      terminal.applyDiagramEdit(origin, diagramId, revisedResult.fingerprint, colliding),
      /invalidGeometry.*"itemIds"/,
    );
    assert.equal(JSON.stringify(stored()), settled);
    assert.equal(writes, settledWrites);

    // The catalog is public and identical from both clients.
    const browserCatalog = await browser.getCatalog();
    assert.deepEqual(await terminal.getCatalog(origin), browserCatalog);
  } finally {
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }


}

void main().then(() => console.log("verify-aws-agent-roundtrip: ok"), (error) => {
  console.error(error);
  process.exit(1);
});
