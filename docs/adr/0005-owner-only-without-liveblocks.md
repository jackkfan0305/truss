# Owner-only, without Liveblocks

Truss stored every diagram in a Liveblocks room so collaborators could edit it
together, and invited those collaborators to a storyboard by email. On
2026-09-21 the owner decided human co-editing was not worth what it cost, and on
2026-09-25 extended that to the invitation flow itself. Every storyboard and
diagram now has exactly one user: its owner.

A diagram's canvas is one private Vercel Blob snapshot. `Diagram.canvasVersion`
versions it, and every write is a compare-and-swap on that version: the editor's
autosave and the agent-token routes alike. A stale write gets `409`. An idle
editor polls the version and, when the terminal agent wrote, replays the change
node by node behind the agent cursor.

## Consequences

`StoryboardCollaborator`, the Share dialog, the member routes, the Shared list,
presence avatars for people and live cursors for people are gone. The agent's
cursor and avatar stay; they are driven by the replay, not by a realtime
service.

Undo is this tab's own stack. Two tabs on one diagram do not merge: the one
that saves second is told to reload.
