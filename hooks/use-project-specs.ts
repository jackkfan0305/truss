"use client"

import { useEffect, useState } from "react"

import type { ProjectSpecSummary } from "@/types/project"

/**
 * Reading generated specs from the Specs tab (29-spec-ui-integration).
 *
 * Two reads against routes that already exist: the list is metadata, and the
 * document comes back from the download route. Nothing here touches Blob — its
 * store is private, so the browser could not fetch a spec directly even if the
 * URL were handed to it.
 */

/** The download route, which is also where the preview reads its Markdown. */
export function specDownloadHref(projectId: string, specId: string): string {
  return `/api/projects/${projectId}/specs/${specId}/download`
}

/**
 * Loaded specs, stamped with the project they belong to so a response for a
 * project the editor has navigated away from is never rendered as this one's.
 * Same shape as `useProjectMembers` for the same reason.
 */
interface ListState {
  projectId: string
  specs: ProjectSpecSummary[]
  error: string | null
}

export interface ProjectSpecList {
  specs: ProjectSpecSummary[]
  isLoading: boolean
  error: string | null
}

/** This project's specs, newest first. Fetched once per project. */
export function useProjectSpecs(projectId: string): ProjectSpecList {
  const [list, setList] = useState<ListState | null>(null)

  const isLoaded = list?.projectId === projectId

  useEffect(() => {
    const controller = new AbortController()
    /*
     * A flag of its own rather than `controller.signal.aborted`. The two are
     * equivalent today, because the only thing that ends this run is the
     * cleanup calling `abort()` — but that ties "should I still write state" to
     * one particular fetch. Any later `await` that is not that fetch would slip
     * past a signal check and not past this.
     */
    let isStale = false

    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/specs`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const body = (await response.json()) as { specs?: ProjectSpecSummary[] }

        // A response that resolved before the abort landed still belongs to a
        // dead effect run; writing it would let an older list win the race.
        if (isStale) return

        setList({ projectId, specs: body.specs ?? [], error: null })
      } catch (caught) {
        if (isStale) return

        setList({ projectId, specs: [], error: getErrorMessage(caught) })
      }
    })()

    return () => {
      isStale = true
      controller.abort()
    }
  }, [projectId])

  return {
    specs: isLoaded ? list.specs : [],
    error: isLoaded ? list.error : null,
    // Derived rather than its own state, so the first render does not cost an
    // extra pass just to flip a flag (react-hooks/set-state-in-effect).
    isLoading: !isLoaded,
  }
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
    // Same reasoning as `useProjectSpecs` above.
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
