"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"

import {
  buildRoomId,
  createRoomIdSuffix,
  getRetryRoomIdSuffix,
} from "@/lib/room-id"
import type { DiagramSummary } from "@/types/diagram"

export type DiagramDialog =
  | { kind: "create" }
  | { kind: "rename"; diagram: DiagramSummary }
  | { kind: "delete"; diagram: DiagramSummary }

class DiagramMutationError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "DiagramMutationError"
    this.status = status
  }
}

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

async function mutate(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  })

  if (!response.ok) {
    throw new DiagramMutationError(
      await readErrorMessage(response),
      response.status,
    )
  }

  return response
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again."
}

/**
 * Owns dialog state, form state and the diagram mutations. Presentational
 * components (sidebar, dialogs, editor home) stay stateless and take these
 * handlers as props.
 */
export function useDiagramActions() {
  const router = useRouter()
  const pathname = usePathname()

  const [dialog, setDialog] = useState<DiagramDialog | null>(null)
  const [name, setName] = useState("")
  // Generated once per create dialog rather than per render, so the ID the
  // preview shows is the ID that gets created.
  const [suffix, setSuffix] = useState("")
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The diagram ID is also the Liveblocks room ID and the /editor/[roomId]
  // segment — one identifier, per 10-liveblocks-setup.
  const roomId = buildRoomId(name, suffix)

  const closeDialog = () => {
    setDialog(null)
    setError(null)
  }

  const openCreate = () => {
    setName("")
    setSuffix(createRoomIdSuffix())
    setError(null)
    setDialog({ kind: "create" })
  }

  const openRename = (diagram: DiagramSummary) => {
    setName(diagram.name)
    setError(null)
    setDialog({ kind: "rename", diagram })
  }

  const openDelete = (diagram: DiagramSummary) => {
    setError(null)
    setDialog({ kind: "delete", diagram })
  }

  const createDiagram = async () => {
    const response = await mutate("/api/diagrams", {
      method: "POST",
      body: JSON.stringify({ id: roomId, name }),
    })

    const { diagram } = (await response.json()) as {
      diagram?: { id?: unknown }
    }

    if (typeof diagram?.id !== "string") {
      throw new Error("The diagram was created but could not be opened.")
    }

    router.push(`/editor/${diagram.id}`)
  }

  const renameDiagram = async (diagram: DiagramSummary) => {
    await mutate(`/api/diagrams/${diagram.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    })

    router.refresh()
  }

  const deleteDiagram = async (diagram: DiagramSummary) => {
    await mutate(`/api/diagrams/${diagram.id}`, { method: "DELETE" })

    // Deleting the workspace you are standing in: leave before it 404s.
    const workspacePath = `/editor/${diagram.id}`
    const isActiveWorkspace =
      pathname === workspacePath || pathname.startsWith(`${workspacePath}/`)

    if (isActiveWorkspace) {
      router.push("/editor")
      return
    }

    router.refresh()
  }

  const submit = async () => {
    if (!dialog || isPending) return

    setIsPending(true)
    setError(null)

    try {
      if (dialog.kind === "create") {
        await createDiagram()
      } else if (dialog.kind === "rename") {
        await renameDiagram(dialog.diagram)
      } else {
        await deleteDiagram(dialog.diagram)
      }

      setDialog(null)
    } catch (caught) {
      if (dialog.kind === "create" && caught instanceof DiagramMutationError) {
        setSuffix(
          getRetryRoomIdSuffix(suffix, caught.status, createRoomIdSuffix),
        )
      }

      // Keep the dialog open so the typed name is not lost on a failed retry.
      setError(getErrorMessage(caught))
    } finally {
      setIsPending(false)
    }
  }

  return {
    dialog,
    name,
    setName,
    roomId,
    isPending,
    error,
    openCreate,
    openRename,
    openDelete,
    closeDialog,
    submit,
  }
}

export type DiagramActions = ReturnType<typeof useDiagramActions>
