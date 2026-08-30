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
 */
export interface DiagramAccess extends DiagramSummary {
  isOwner: boolean
  storyboardId: string | null
}
