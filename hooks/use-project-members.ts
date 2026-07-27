"use client"

import { useCallback, useEffect, useState } from "react"

import type { ProjectMember } from "@/types/project"

/**
 * The loaded member list for one project. Stamped with the project it belongs
 * to so a response for a project you have navigated away from is never rendered
 * as if it belonged to the current one.
 */
interface ListState {
  projectId: string
  members: ProjectMember[]
  error: string | null
}

/**
 * Everyone with access to a project, plus the owner-only invite and remove
 * mutations. The list includes the owner; only collaborators can be removed,
 * which the server enforces independently.
 *
 * Fetches when `isOpen` turns true rather than on mount: the list is only ever
 * shown inside the share dialog, and it should be fresh each time it opens.
 *
 * `isLoading` is derived from whether `list` matches the current project rather
 * than being its own state, so opening the dialog does not cost an extra render
 * pass just to flip a flag (react-hooks/set-state-in-effect).
 */
export function useProjectMembers(projectId: string, isOpen: boolean) {
  const [list, setList] = useState<ListState | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [email, setEmail] = useState("")

  const endpoint = `/api/projects/${projectId}/members`
  const isLoaded = list?.projectId === projectId

  useEffect(() => {
    if (!isOpen) return

    // Guards against a slow response landing after the dialog closed or the
    // workspace changed.
    const controller = new AbortController()

    void (async () => {
      try {
        const response = await fetch(endpoint, { signal: controller.signal })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        const body = (await response.json()) as { members?: ProjectMember[] }

        // A response that resolved before the abort landed still belongs to a
        // dead effect run; writing it would let an older list win the race.
        if (controller.signal.aborted) return

        setList({ projectId, members: body.members ?? [], error: null })
      } catch (caught) {
        if (controller.signal.aborted) return

        setList({ projectId, members: [], error: getErrorMessage(caught) })
      }
    })()

    return () => controller.abort()
  }, [endpoint, isOpen, projectId])

  /**
   * Runs a mutation and folds its outcome into the list. Returning members
   * replaces them; returning `null` leaves them untouched.
   */
  const run = useCallback(
    async (request: () => Promise<ProjectMember[] | null>) => {
      if (isPending) return

      setIsPending(true)

      try {
        const members = await request()

        setList((current) =>
          current
            ? { ...current, ...(members ? { members } : {}), error: null }
            : current,
        )
      } catch (caught) {
        setList((current) =>
          current ? { ...current, error: getErrorMessage(caught) } : current,
        )
      } finally {
        setIsPending(false)
      }
    },
    [isPending],
  )

  const invite = useCallback(async () => {
    const trimmed = email.trim()

    if (!trimmed) return

    // The route answers with the refreshed list, so there is no second fetch
    // and no local list surgery that could drift from the server.
    await run(async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      })

      if (!response.ok) {
        throw new Error(await readErrorMessage(response))
      }

      // Cleared only on success, so a rejected address stays in the field to fix.
      setEmail("")

      const body = (await response.json()) as { members?: ProjectMember[] }
      return body.members ?? []
    })
  }, [email, endpoint, run])

  const remove = useCallback(
    async (memberId: string) => {
      await run(async () => {
        const response = await fetch(`${endpoint}/${memberId}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          throw new Error(await readErrorMessage(response))
        }

        // 204, no body — drop the row rather than refetching the whole list.
        setList((current) =>
          current
            ? {
                ...current,
                members: current.members.filter(
                  (member) => member.id !== memberId,
                ),
              }
            : current,
        )

        return null
      })
    },
    [endpoint, run],
  )

  return {
    members: isLoaded ? list.members : [],
    error: isLoaded ? list.error : null,
    isLoading: isOpen && !isLoaded,
    email,
    setEmail,
    isPending,
    invite,
    remove,
  }
}

export type ProjectMemberActions = ReturnType<typeof useProjectMembers>

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
