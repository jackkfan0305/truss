import type { ProjectSummary } from "@/types/project"

/*
 * Placeholder data for 04-project-dialogs — the spec forbids API calls and
 * persistence at this stage. 07-wire-editor-home deletes this file and fetches
 * the same two lists server-side in app/editor/page.tsx.
 */

export const MOCK_OWNED_PROJECTS: ProjectSummary[] = [
  { id: "checkout-service", name: "Checkout Service" },
  { id: "event-pipeline", name: "Event Pipeline" },
  { id: "identity-platform", name: "Identity Platform" },
]

export const MOCK_SHARED_PROJECTS: ProjectSummary[] = [
  { id: "billing-migration", name: "Billing Migration" },
]
