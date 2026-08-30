# Truss

Truss is a collaborative planning board. A terminal agent authors a plan as a
board of panels, the owner and their teammates argue with it in place, and the
curated feedback goes back to that agent to keep the questioning loop running
until the plan is worth implementing.

## Language

### The artifact

**Storyboard**:
A board of panels expressing one plan, owned by one user and shared with
collaborators. It is the top-level object in the app.
_Avoid_: Project, board, doc, plan

**Panel**:
One node on a storyboard carrying one idea. Four types: prose, decision, code,
diagram.
_Avoid_: Card, frame, scene, block, section

**Block**:
An addressable element inside a prose panel's HTML, and the unit a thread
anchors to.
_Avoid_: Element, chunk, region

**Decision panel**:
A panel offering options where exactly one is picked by the owner. A pick is
feedback the agent reads.
_Avoid_: Choice, poll, question

**Code panel**:
A panel holding pseudocode in a code-editor frame. It shows the shape of what
is to be implemented, never real syntax.
_Avoid_: Snippet, listing

**Diagram**:
A system architecture graph in its own Liveblocks room, rendered on a
storyboard as static SVG and opening into a full editor. Valid on its own with
no storyboard pointing at it.
_Avoid_: Chart, graph, canvas, figure

### The conversation

**Thread**:
A comment conversation anchored to a block, a decision option, a diagram node,
or nothing at all. Started by anyone, resolved by the owner. Rendered as a
free-floating sticky note tethered to its anchor.
_Avoid_: Comment, note, annotation

**Queue**:
The owner's act of sending selected threads and picks to the waiting agent.
Nothing reaches the agent without it.
_Avoid_: Submit, send off, dispatch

**Wait**:
An agent's open request to receive the next queue. One per storyboard at a
time; a second is refused.
_Avoid_: Poll, subscribe, listen

**Revision**:
One agent write of storyboard content, applied against a fingerprint and
naming every block it deliberately removes.
_Avoid_: Update, edit, patch

**Stop**:
The owner ending an agent session with one last queue, after which the agent
writes the implementation Markdown. It ends the session, never the storyboard.
_Avoid_: Close, finish, accept, complete

### Participants

**Owner**:
The user a storyboard belongs to. The only one who edits panels, picks
decisions, queues, and stops.
_Avoid_: Author, creator

**Collaborator**:
A user invited to a storyboard by email. Comments and replies, nothing else.
_Avoid_: Viewer, member, guest

**Agent**:
The terminal agent holding an agent token, present in the room under the
owner's name plus a suffix. It authors panels and answers threads; it never
queues and never picks.
_Avoid_: AI, assistant, bot
