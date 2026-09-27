# Compact graph contract

Send a graph only as the `graph` value in the launcher's stdin JSON object. Emit no fields beyond those shown.

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
