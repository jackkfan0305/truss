# Temporary storyboards before sign-in

Signed-out users can build a complete temporary storyboard in the current tab.
The temporary storyboard is held only in memory, so refresh or tab close loses
it. The page shows `Sign in to save` in the top-right and opens sign-in in a
modal. A successful sign-in creates a new owned storyboard containing the
current panels, diagrams, and terminal-agent work. A cancelled or failed
sign-in returns to the same temporary storyboard. Each browser tab has an
independent in-memory temporary storyboard. If saving fails, the temporary
storyboard remains available for retry. After saving succeeds, the page enters
the normal owned state, removes `Sign in to save`, and exposes collaboration.

Temporary storyboards cannot invite collaborators. The invite control stays
hidden until the storyboard has an owner. All other storyboard features remain
available, including terminal-agent operations.

## Consequences

The in-page sign-in flow is required to preserve in-memory work without making
the temporary storyboard persistent. Browser refresh recovery is deliberately
not supported. A user who wants to keep the work must sign in before leaving
or refreshing the page.

Saving creates a new storyboard rather than merging with an existing one. This
keeps the anonymous user's work separate from storyboards they already own.
