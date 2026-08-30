/**
 * Minimal diagram shape the editor chrome renders. A subset of the Prisma
 * `Diagram` model — widen it there, not here.
 */
export interface DiagramSummary {
  id: string
  name: string
}

/**
 * A diagram the current user may open, plus whether they own it. The workspace
 * needs the distinction: collaborators get a read-only share dialog.
 *
 * `isOwner` is derived server-side from `Diagram.ownerId` and is presentation
 * only — every mutation re-checks ownership in its own handler.
 *
 * `storyboardId` is the diagram's parent board, or `null` for a standalone
 * diagram. Sharing hangs off it: collaborators are invited to a storyboard, so
 * a diagram with no parent has nobody to invite and no share dialog.
 *
 * `ownsStoryboard` is a separate question from `isOwner`, not a synonym.
 * Inviting and removing collaborators are storyboard mutations, so they are the
 * parent owner's to make — and a diagram you own can sit on a board you do not.
 * `false` whenever there is no parent at all.
 */
export interface DiagramAccess extends DiagramSummary {
  isOwner: boolean
  storyboardId: string | null
  ownsStoryboard: boolean
}
