"use client"

import { useState } from "react"

import type { ProjectSummary } from "@/types/project"

export type ProjectDialog =
  | { kind: "create" }
  | { kind: "rename"; project: ProjectSummary }
  | { kind: "delete"; project: ProjectSummary }

/**
 * Room-ID-safe slug. NFKD splits accented letters into base + combining mark,
 * and the non-alphanumeric collapse below drops the mark, so "Café Service"
 * becomes "cafe-service". 07-wire-editor-home appends a short unique suffix.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Owns dialog, form and loading state for the project actions. Presentational
 * components (sidebar, dialogs, editor home) stay stateless and take these
 * handlers as props.
 */
export function useProjectActions() {
  const [dialog, setDialog] = useState<ProjectDialog | null>(null)
  const [name, setName] = useState("")
  // ponytail: nothing flips this until 07-wire-editor-home adds the fetch calls.
  // The dialogs already consume it, so wiring the mutations stays a local change.
  const [isPending] = useState(false)

  const closeDialog = () => setDialog(null)

  const openCreate = () => {
    setName("")
    setDialog({ kind: "create" })
  }

  const openRename = (project: ProjectSummary) => {
    setName(project.name)
    setDialog({ kind: "rename", project })
  }

  const openDelete = (project: ProjectSummary) =>
    setDialog({ kind: "delete", project })

  // 04-project-dialogs is UI only. 07-wire-editor-home branches on `dialog.kind`
  // here and calls POST/PATCH/DELETE before closing.
  const submit = () => setDialog(null)

  return {
    dialog,
    name,
    setName,
    slug: slugify(name),
    isPending,
    openCreate,
    openRename,
    openDelete,
    closeDialog,
    submit,
  }
}

export type ProjectActions = ReturnType<typeof useProjectActions>
