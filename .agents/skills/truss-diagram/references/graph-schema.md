# Compact graph contract

Send a graph only as the `graph` value of `truss_create_diagram` or the `desiredGraph` of `truss_apply_diagram_edit`. Emit no fields beyond those shown.

Coordinates are optional. Omit `x` and `y` on a new node and Truss arranges the diagram, routes its connections, and places its labels. Keep the coordinates `truss_get_diagram` returned for a node that already exists, so an edit leaves the rest of the canvas where the user put it.

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "client",
      "label": "Client",
      "shape": "circle",
      "color": "blue"
    },
    {
      "id": "orders-api",
      "label": "Orders API",
      "shape": "rectangle",
      "color": "teal"
    }
  ],
  "edges": [
    {
      "id": "client-to-orders",
      "source": "client",
      "target": "orders-api",
      "label": "HTTPS"
    }
  ]
}
```

Rules:

- Use graph `version: 1`, 1–40 nodes, and 0–60 edges.
- Use lowercase kebab-case IDs (`[a-z0-9]+(?:-[a-z0-9]+)*`), 1–48 characters, unique across nodes and separately across edges.
- Give every node a trimmed 1–80 character label; use only `rectangle`, `diamond`, `circle`, `pill`, `cylinder`, or `hexagon` as its shape; and use only `neutral`, `blue`, `purple`, `orange`, `red`, `pink`, `green`, or `teal` as its color.
- Omit both `x` and `y`, or send both as integers from -10,000 through 10,000. Half a pair is rejected.
- Give every edge an existing, different source and target, with no repeated source/target pair. Its label is trimmed and 0–40 characters.
- Aim for an overview a reader understands at a glance, normally 4-8 nodes. Add detail when the user asks for it.
- Never include React Flow fields, dimensions, viewport state, groups, metadata, or unknown keys. The launcher rejects the entire graph if any rule is violated.
- The encoded launch fragment must not exceed 16,384 characters. Keep the graph compact; the launcher never truncates it.

## Version 2: AWS services and nested boundaries

Use `version: 2` for AWS services, boundaries and any diagram that nests. Version 1 stays valid for flat generic diagrams, and a version 1 client cannot read or edit a diagram that has AWS or nested content (the server answers `unsupportedGraphVersion`; request version 2).

Get catalog ids from `truss_get_catalog`, never from memory. Services use `aws-` ids (`aws-lambda`, `aws-s3`, `aws-eks`), boundaries use `boundary-` ids (`boundary-vpc`, `boundary-subnet`).

```json
{
  "version": 2,
  "nodes": [
    { "id": "vpc", "kind": "boundary", "catalogId": "boundary-vpc", "label": "VPC" },
    { "id": "private", "kind": "boundary", "catalogId": "boundary-subnet", "label": "Private subnet", "parentId": "vpc" },
    { "id": "worker", "kind": "aws-service", "catalogId": "aws-lambda", "label": "Worker", "parentId": "private" },
    { "id": "uploads", "kind": "aws-service", "catalogId": "aws-s3", "label": "Uploads", "parentId": "vpc" },
    { "id": "client", "kind": "generic", "label": "Client", "shape": "circle", "color": "blue" }
  ],
  "edges": [
    { "id": "client-to-worker", "source": "client", "target": "worker", "label": "HTTPS" },
    { "id": "worker-to-uploads", "source": "worker", "target": "uploads", "label": "Writes" }
  ]
}
```

Writable node fields:

- `generic`: `id`, `kind`, `label`, `shape`, `color`, optional `parentId`, `x`, `y`, `width`, `height`.
- `aws-service` and `boundary`: `id`, `kind`, `label`, `catalogId`, and the same optional fields. Never send `shape`, `color`, SVG or icon URLs; the catalog supplies the look.
- Only a `boundary` can be a `parentId`. Parentage is visual grouping, not an AWS deployment requirement. Parents must exist and cannot form a cycle.
- `note`: `id`, `kind`, `label` (the note's text, up to 1,000 characters, line breaks allowed), optional `color` (`yellow`, `pink`, `blue` or `green`; default `yellow`), `x`, `y`, `width`, `height`. A note never has `parentId` or `catalogId`, no edge may touch it, and no node may name it as a parent. Truss puts a note without coordinates to the right of the diagram.
- Boundaries and notes count toward the node limit. Version 2 allows 80 nodes and 120 edges; version 1 stays at 40 and 60.
- Omit `x` and `y` on new nodes so Truss places them. Version 2 accepts fractional coordinates; send `x` with `y` and `width` with `height`, or neither.
- `x` and `y` are top-left positions relative to the parent (the canvas for root nodes), in canvas units.

### Notes

```json
{ "id": "why-dynamodb", "kind": "note", "label": "Chose DynamoDB over RDS: access is key-value and traffic is spiky.", "color": "yellow" }
```

Add a note only when the diagram cannot show something important, such as a key design decision or a caveat. Keep it short and plain: one or two sentences a person can read at a glance. Never connect notes.

Read-only geometry lives in `spatial` on reads and write results, never in the graph. Do not copy bounds or routes into a write. `spatial.nodes[].bounds` and `spatial.edges[].layout.points` are absolute canvas coordinates. Items listed in `opaqueNodeIds` are obstacles you cannot edit: keep clear of their bounds and never reuse their ids. A boundary with opaque descendants cannot be removed (`opaqueDescendants`).

A geometry failure (`invalidGeometry`, HTTP 422) lists `itemIds` per issue. Revise those items or omit their coordinates and retry; nothing was saved. After a conflict, read again and revise against the new graph.

### Code nodes

A `code` node draws one piece of code. It takes the common optional fields plus these, all optional except `catalogId`:

- `catalogId`: `code-entry`, `code-function`, `code-method`, `code-type` or `code-enum`.
- `signature`: one line, at most 120 characters.
- `summary`: one plain sentence on what the code does, at most 100 characters.
- `pseudocode`: at most 16 lines of plain-language steps, each at most 80 characters, indented two spaces per level. Shown on hover.
- `rows`: at most 12 strings of at most 60 characters, trimmed and single-line. Use them for the fields of a type or the values of an enum.
- `source`: `{ "path": "...", "line": 12, "url": "https://github.com/..." }`. `path` is repository-relative and at most 200 characters. `line` is a positive integer. `url` must start with `https://github.com/`; leave it out otherwise.

A `boundary` node may use `code-class` or `code-module` as its `catalogId`. A `code-method` must have a `code-class` boundary as its `parentId`. Other code nodes may sit in either code boundary or at the root.

An edge in a version 2 graph may carry `kind`: `calls` (the default, drawn solid) or `uses` (drawn dashed, for a reference to a type). Version 1 edges take no `kind`.

A read returns these fields, so an edit must send them back unchanged for every node and edge it keeps. See [code diagrams](code-diagrams.md).
