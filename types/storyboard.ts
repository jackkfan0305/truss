export type StoryboardRole = "owner" | "collaborator"

/**
 * Someone with access to a storyboard, enriched with Clerk profile data — the
 * owner and every collaborator, which is what the share dialog lists.
 *
 * `name` and `imageUrl` are null when Clerk has no matching user: an invite can
 * be sent to an address that has never signed up, so the email stands alone.
 * `email` is null only when a Clerk lookup for the owner fails.
 *
 * `id` is the `StoryboardCollaborator` row ID for collaborators and the Clerk
 * user ID for the owner. Only the former is a valid remove target, which the
 * owner's role already prevents.
 */
export interface StoryboardMember {
  id: string
  email: string | null
  name: string | null
  imageUrl: string | null
  role: StoryboardRole
}
