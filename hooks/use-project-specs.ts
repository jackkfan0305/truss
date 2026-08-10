"use client"

import { useEffect, useState } from "react"

/**
 * Reading a generated spec from the transcript (29-spec-ui-integration,
 * 36-spec-attachment).
 *
 * One read against a route that already exists: the document comes back from
 * the download route. Nothing here touches Blob — its store is private, so the
 * browser could not fetch a spec directly even if the URL were handed to it.
 *
 * The project-scoped *list* read went with the Specs tab. `GET
 * /api/projects/[projectId]/specs` still exists and still answers; nothing in
 * the client calls it, because a spec now arrives attached to the turn that
 * wrote it and the transcript is the list.
 */

/** The download route, which is also where the preview reads its Markdown. */
export function specDownloadHref(projectId: string, specId: string): string {
  return `/api/projects/${projectId}/specs/${specId}/download`
}

export interface SpecContent {
  markdown: string | null
  isLoading: boolean
  error: string | null
}

/**
 * The Markdown of one spec.
 *
 * Deliberately not cached across opens: a spec is thousands of characters of
 * prose, and the preview is a modal you look at once. The caller keeps this
 * hook mounted only while the dialog is open, so closing it is what drops the
 * document — this hook never has to clear itself.
 */
export function useSpecContent(
  projectId: string,
  specId: string,
): SpecContent {
  const [state, setState] = useState<{
    specId: string
    markdown: string | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    // A flag of its own rather than `controller.signal.aborted`: that ties
    // "should I still write state" to one particular fetch, and any later
    // `await` that is not that fetch would slip past a signal check.
    let isStale = false

    void (async () => {
      try {
        const response = await fetch(specDownloadHref(projectId, specId), {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        // `Content-Disposition: attachment` only tells a *navigation* to save
        // the body; read through fetch it is just text.
        const markdown = await response.text()

        if (isStale) return

        setState({ specId, markdown, error: null })
      } catch (caught) {
        if (isStale) return

        setState({ specId, markdown: null, error: getErrorMessage(caught) })
      }
    })()

    return () => {
      isStale = true
      controller.abort()
    }
  }, [projectId, specId])

  const isCurrent = state?.specId === specId

  return {
    markdown: isCurrent ? state.markdown : null,
    error: isCurrent ? state.error : null,
    isLoading: !isCurrent,
  }
}

/** The download route answers `{ error }` on failure; a proxy or crash may not. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    const message = (body as { error?: unknown } | null)?.error

    if (typeof message === "string" && message) {
      return message
    }
  } catch {
    // Fall through to the status-based message below.
  }

  return `Something went wrong (${response.status}). Please try again.`
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again."
}
