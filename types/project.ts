/**
 * Minimal project shape the editor chrome renders. A subset of the Prisma
 * `Project` model added in 05-prisma — widen it there, not here.
 */
export interface ProjectSummary {
  id: string
  name: string
}

/**
 * A project the current user may open, plus whether they own it. The workspace
 * needs the distinction: collaborators get a read-only share dialog.
 *
 * `isOwner` is derived server-side from `Project.ownerId` and is presentation
 * only — every mutation re-checks ownership in its own handler.
 */
export interface ProjectAccess extends ProjectSummary {
  isOwner: boolean
}

export type ProjectRole = "owner" | "collaborator"

/**
 * Someone with access to a project, enriched with Clerk profile data — the
 * owner and every collaborator, which is what the share dialog lists.
 *
 * `name` and `imageUrl` are null when Clerk has no matching user: an invite can
 * be sent to an address that has never signed up, so the email stands alone.
 * `email` is null only when a Clerk lookup for the owner fails.
 *
 * `id` is the `ProjectCollaborator` row ID for collaborators and the Clerk user
 * ID for the owner. Only the former is a valid remove target, which the owner's
 * role already prevents.
 */
export interface ProjectMember {
  id: string
  email: string | null
  name: string | null
  imageUrl: string | null
  role: ProjectRole
}

/**
 * One generated spec, as the Specs tab lists it. Metadata only — the Markdown
 * lives in a private Blob and is read through the download route, never held
 * alongside the list.
 *
 * `createdAt` is an ISO string rather than a `Date` because it crosses JSON.
 * `fileName` is computed server-side by `specFileName`, the same function that
 * names the download, so the list and the saved file agree.
 */
export interface ProjectSpecSummary {
  id: string
  createdAt: string
  fileName: string
}
