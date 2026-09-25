# Temporary storyboards before sign-in

## Problem Statement

The current storyboard builder requires sign-in before a user can begin. This
forces an account decision before the user can experience the product and
prevents users from exploring the complete storyboard workflow first.

## Solution

Allow signed-out users to build a temporary storyboard with the complete
storyboard feature set. A temporary storyboard exists only in memory in its
browser tab. It has no Owner, cannot invite Collaborators, and disappears when
the page is refreshed or the tab is closed.

Show `Sign in to save` in the top-right of the builder. Open sign-in in an
in-page modal. A successful sign-in promotes the complete temporary storyboard
to a new owned storyboard, including its Panels, Diagrams, and terminal-agent
work. A cancelled or failed sign-in returns to the same temporary storyboard.
After a successful save, hide the sign-in action and expose collaboration.

## User Stories

1. As a signed-out user, I want to open the storyboard builder, so that I can
   evaluate the product before creating an account.
2. As a signed-out user, I want to create a temporary storyboard, so that I can
   begin work without signing in.
3. As a signed-out user, I want to create and edit Panels, so that I can use
   the full storyboard-building workflow.
4. As a signed-out user, I want to create and edit Diagrams, so that I can
   model architecture before deciding whether to sign in.
5. As a signed-out user, I want to use starter templates, so that I can begin
   from an existing system design.
6. As a signed-out user, I want to use terminal-agent operations, so that the
   temporary storyboard supports the same authoring workflow as an owned one.
7. As a signed-out user, I want to see `Sign in to save` in the top-right, so
   that I know how to keep my work.
8. As a signed-out user, I want to continue editing without signing in, so
   that the account prompt does not interrupt exploration.
9. As a signed-out user, I want collaborator invitations unavailable, so that
   a storyboard without an Owner cannot grant access to other users.
10. As a signed-out user, I want the invitation control hidden, so that I do
    not attempt an operation the temporary storyboard cannot support.
11. As a signed-out user, I want sign-in to open in a modal, so that my
    temporary storyboard remains in the current tab while I authenticate.
12. As a signed-out user, I want my complete storyboard preserved after
    successful sign-in, so that I do not have to rebuild it.
13. As a signed-out user, I want successful sign-in to create a new owned
    storyboard, so that my work becomes part of my account.
14. As a signed-out user, I want Panels, Diagrams, and terminal-agent work
    included in the save, so that the saved storyboard matches what I built.
15. As a signed-out user, I want a cancelled sign-in to return me to my
    temporary storyboard, so that cancelling does not discard my work.
16. As a signed-out user, I want a failed sign-in to return me to my temporary
    storyboard, so that an authentication problem does not discard my work.
17. As a signed-out user, I want a failed save to leave my temporary storyboard
    available for retry, so that a transient persistence problem does not cause
    data loss.
18. As an Owner, I want the saved storyboard to enter the normal owned state,
    so that I can use account-backed features immediately.
19. As an Owner, I want the sign-in action removed after saving, so that the UI
    reflects that the storyboard now belongs to me.
20. As an Owner, I want collaborator invitations available after saving, so
    that I can share the storyboard with others.
21. As a user with multiple tabs open, I want each tab to have its own
    temporary storyboard, so that work in one tab cannot alter another tab.
22. As a signed-out user, I want a refresh to discard the temporary storyboard,
    so that the product does not persist anonymous work implicitly.
23. As a signed-out user, I want closing the tab to discard the temporary
    storyboard, so that anonymous work has a clear lifetime.
24. As an existing Owner, I want the normal owned storyboard experience to
    remain unchanged, so that this feature affects only the signed-out entry
    path.

## Implementation Decisions

- Add a public storyboard-builder entry path for signed-out users. The current
  signed-out redirect to the authenticated editor is not sufficient.
- Represent the builder session with two explicit modes: temporary and owned.
- Keep temporary storyboard state in client memory only. Do not use a database,
  Vercel Blob, local storage, or session storage for anonymous storyboard data.
- Keep temporary storyboard state isolated per browser tab.
- Use the existing Clerk integration through an in-page sign-in modal. Do not
  rely on a full-page authentication redirect to preserve temporary state.
- Add one promotion operation that accepts the complete temporary storyboard
  and creates a new owned storyboard for the authenticated Owner.
- The promotion operation includes all current Panels, Diagrams, and
  terminal-agent work.
- Do not merge the temporary storyboard with an existing owned storyboard.
- Keep the temporary storyboard available until promotion succeeds. A failed
  promotion is retryable.
- Hide collaboration invitation controls while the storyboard is temporary.
  Show them immediately after promotion succeeds.
- Preserve the existing Owner and Collaborator permissions once the storyboard
  becomes owned.
- Signed-out authoring must use a temporary-session boundary rather than
  weakening authenticated persistence or ownership checks.
- Canvas and terminal-agent work must target the temporary-session boundary
  before promotion and the existing owned persistence boundaries afterward.
- The temporary-session boundary owns mode, in-memory storyboard state,
  authentication transitions, promotion, retry state, and collaboration UI
  visibility.

## Testing Decisions

- Test externally visible behavior through the storyboard-builder boundary.
  Tests should not assert React state names, hook internals, or implementation
  details.
- Test that a signed-out user can enter the public builder and use every
  storyboard feature except collaborator invitations.
- Test that the top-right `Sign in to save` action opens the in-page auth modal
  and remains visible while the storyboard is temporary.
- Test that cancelling or failing sign-in returns to the unchanged temporary
  storyboard.
- Test that successful sign-in promotes the complete storyboard and changes the
  UI to the owned state.
- Test that promotion failures retain the temporary storyboard and expose a
  retry path.
- Test that Panels, Diagrams, starter-template content, and terminal-agent work
  survive successful promotion.
- Test that invitation controls are hidden before promotion and available after
  promotion.
- Test that two browser tabs maintain independent temporary storyboards.
- Test that refresh and tab close do not recover a temporary storyboard.
- Test the promotion persistence boundary with the existing Prisma and canvas
  persistence test patterns. Promotion must not leave a partially owned
  storyboard that the user cannot retry or recover from.
- Extend the existing auth and editor-control verification patterns for the
  public entry path, modal transitions, and collaboration visibility.
- Keep existing authenticated editor, diagram access, Liveblocks, and agent
  operation tests passing.

## Out of Scope

- Recovering temporary storyboard state after refresh or tab close.
- Saving anonymous storyboard data to local storage, session storage, a
  database, Vercel Blob, or any other persistent store.
- Merging a temporary storyboard into an existing owned storyboard.
- Inviting or collaborating from a temporary storyboard.
- Anonymous access to storyboards created by another user.
- Changes to Owner or Collaborator permissions after promotion.
- New authentication providers or changes to Clerk's authentication model.
- Billing, quotas, or anonymous usage limits.

## Further Notes

- The existing project glossary calls the anonymous artifact a temporary
  storyboard. Do not call it a project, board, guest board, or draft plan.
- The user must sign in before refreshing or closing the tab if they want to
  keep the work.
- The feature changes the current authenticated-only entry flow and should be
  split into implementation tickets only after this specification is accepted.
