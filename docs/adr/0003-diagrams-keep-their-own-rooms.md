# A diagram keeps its own Liveblocks room

A diagram panel sits on a storyboard, but its graph lives in a separate
Liveblocks room rather than inside the storyboard's room. Every diagram tool,
the paced draw, the fingerprint concurrency check, and `readCanvas` address a
room today, and they keep working unchanged. A diagram that no storyboard points
at is still a valid diagram.

## Consequences

Two rooms means two fingerprints, so a revision touching both a panel and a
diagram is two MCP calls with two concurrency windows rather than one atomic
write. That is the price of not rewriting the diagram tools to address a panel
inside a room, and it keeps each write's failure mode scoped to the thing it
was writing.
