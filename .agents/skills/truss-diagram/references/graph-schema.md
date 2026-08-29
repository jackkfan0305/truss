# Compact graph contract

Send a graph only as the `graph` value in the launcher's stdin JSON object. Emit no fields beyond those shown.

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
- Give every node a trimmed 1–80 character label; use only `rectangle`, `diamond`, `circle`, `pill`, `cylinder`, or `hexagon` as its shape; and use only `neutral`, `blue`, `purple`, `orange`, `red`, `pink`, `green`, or `teal` as its color — see the legend below for what each one means.
- `x` and `y` are optional integers from -10,000 through 10,000. The app lays out every graph itself and ignores whatever you send, so omit them — it keeps the encoded launch fragment well under its budget.
- Give every edge an existing, different source and target. Its label is trimmed and 0–40 characters. Two edges may share a source and target — that's two relationships between the same pair, drawn as parallel lines — but not with the same label too; an edge repeating an earlier edge's source, target and label is rejected.
- Never include React Flow fields, dimensions, viewport state, groups, metadata, or unknown keys. The launcher rejects the entire graph if any rule is violated.
- The encoded launch fragment must not exceed 16,384 characters. Keep the graph compact; the launcher never truncates it.

## Legend

Shape is a fixed vocabulary — the kind of thing a node represents, not a stylistic choice:

- `rectangle` — a service or component you would own and deploy — the default box for anything you build
- `pill` — a process, worker, or job: something that runs on its own rather than something callers call directly
- `cylinder` — durable storage — a database, queue-backed store, or file store that outlives one request
- `diamond` — a decision, route, or branch point in the flow
- `circle` — an actor or an entry/exit point — a user, a client, an external caller, or an event source
- `hexagon` — a third-party or external system outside your boundary — you call it, you do not deploy it

Color is the layer a node belongs to, chosen semantically, never decoratively:

- `blue` — your own services — the components this system owns and deploys
- `teal` — data stores — the durable layer, paired with the cylinder shape
- `green` — entry points and clients — where a request or event originates
- `orange` — external or third-party systems — outside your boundary
- `purple` — async or eventing — queues, topics, background jobs, anything not a direct synchronous call
- `pink` — auth or identity — anything that authenticates, authorizes, or issues identity
- `red` — error or failure paths — a path only exercised when something goes wrong
- `neutral` — anything that doesn't fit one of the other seven layers

Edges carry meaning too: an arrow points the direction the request or the data moves, not just "these are related". Label an edge only when the source and target don't already say what moves between them or which protocol it's on — a label repeating what the two shapes and their names already make obvious is noise. Keep any label to a few words.
