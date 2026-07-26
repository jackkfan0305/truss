"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { EditorNavbar } from "@/components/editor/editor-navbar"
import { ProjectDialogs } from "@/components/editor/project-dialogs"
import { ProjectSidebar } from "@/components/editor/project-sidebar"
import { Button } from "@/components/ui/button"
import { useProjectActions } from "@/hooks/use-project-actions"
import type { ProjectSummary } from "@/types/project"

interface EditorShellProps {
  ownedProjects: ProjectSummary[]
  sharedProjects: ProjectSummary[]
}

/**
 * Owns the sidebar open/close state for the editor workspace and the project
 * dialog state. The chrome components stay presentational — see the
 * architecture notes in context/progress-tracker.md.
 */
export function EditorShell({
  ownedProjects,
  sharedProjects,
}: EditorShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const actions = useProjectActions()

  return (
    <div className="flex flex-1 flex-col">
      <EditorNavbar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
      />

      {/*
        `relative` scopes ProjectSidebar's absolute overlay to the work area, so
        opening it slides over the canvas instead of reflowing it.
      */}
      <div className="relative flex flex-1 overflow-hidden">
        <ProjectSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          ownedProjects={ownedProjects}
          sharedProjects={sharedProjects}
          onCreateProject={actions.openCreate}
          onRenameProject={actions.openRename}
          onDeleteProject={actions.openDelete}
        />

        {/*
          Small screens only: the sidebar covers most of the viewport there, so
          it needs a scrim and a tap-out. On desktop it sits beside the canvas
          and stays open while you work.
        */}
        {isSidebarOpen ? (
          <button
            type="button"
            aria-label="Close projects sidebar"
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 z-30 bg-black/60 md:hidden"
          />
        ) : null}

        <main className="flex flex-1 items-center justify-center bg-page px-6">
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <h1 className="text-2xl font-medium tracking-tight text-copy-primary">
              Create a project or open an existing one
            </h1>
            <p className="text-sm text-copy-muted">
              Start a new architecture workspace, or choose a project from the
              sidebar.
            </p>
            <Button className="mt-3" size="lg" onClick={actions.openCreate}>
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </div>
        </main>
      </div>

      <ProjectDialogs actions={actions} />
    </div>
  )
}
