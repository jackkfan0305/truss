"use client"

import { useState } from "react"
import { UserButton } from "@clerk/nextjs"
import { Plus } from "lucide-react"

import { CanvasRoom, CanvasSurface } from "@/components/canvas/canvas-room"
import { CanvasSaveProvider } from "@/components/canvas/canvas-save-context"
import { PresenceAvatars } from "@/components/canvas/presence-avatars"
import { AiSidebar } from "@/components/editor/ai-sidebar"
import { AgentLaunchImportFailure } from "@/components/editor/agent-launch-import-status"
import { EditorNavbar } from "@/components/editor/editor-navbar"
import { ProjectDialogs } from "@/components/editor/project-dialogs"
import { ProjectSidebar } from "@/components/editor/project-sidebar"
import { SaveStatusButton } from "@/components/editor/save-status-button"
import { ShareDialog } from "@/components/editor/share-dialog"
import { Button } from "@/components/ui/button"
import { useProjectActions } from "@/hooks/use-project-actions"
import { useAgentLaunchImport } from "@/hooks/use-agent-launch-import"
import {
  initialEditorSidebar,
  type EditorSidebar,
} from "@/lib/editor-sidebar-state"
import type { ProjectAccess, ProjectSummary } from "@/types/project"

interface EditorShellProps {
  ownedProjects: ProjectSummary[]
  sharedProjects: ProjectSummary[]
  /**
   * Set on `/editor/[roomId]`, absent on the editor home. Its presence is what
   * switches the shell from the create prompt to the workspace layout.
   */
  activeProject?: ProjectAccess
  /** An opaque launch UUID, only accepted for an already-authorized project. */
  launchId?: string
}

type OpenSidebar = EditorSidebar

/**
 * Owns the sidebar open/close state for the editor workspace and the project
 * dialog state. The chrome components stay presentational — see the
 * architecture notes in context/progress-tracker.md.
 */
export function EditorShell({
  ownedProjects,
  sharedProjects,
  activeProject,
  launchId,
}: EditorShellProps) {
  const [openSidebar, setOpenSidebar] = useState<OpenSidebar>(
    () => initialEditorSidebar()
  )
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false)
  const actions = useProjectActions()
  const launchImport = useAgentLaunchImport({
    launchId,
    roomId: activeProject?.id ?? "",
    canStart: Boolean(activeProject),
  })
  const isSidebarOpen = openSidebar === "projects"
  const isAiSidebarOpen = openSidebar === "ai"

  return (
    // No-op without an active project, so the editor home never joins a room.
    <CanvasRoom roomId={activeProject?.id}>
      {/*
        Wraps the navbar as well as the canvas: the save indicator sits in the
        navbar but is driven from inside the canvas (21-canvas-autosave).
      */}
      <CanvasSaveProvider>
        <div className="relative flex flex-1 overflow-hidden">
          <EditorNavbar
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() =>
              setOpenSidebar((current) =>
                current === "projects" ? null : "projects"
              )
            }
            projectName={activeProject?.name}
            onShare={activeProject ? () => setIsShareOpen(true) : undefined}
            onOpenTemplates={
              activeProject ? () => setIsTemplatesOpen(true) : undefined
            }
            isAiSidebarOpen={isAiSidebarOpen}
            onToggleAiSidebar={
              activeProject
                ? () =>
                    setOpenSidebar((current) =>
                      current === "ai" ? null : "ai"
                    )
                : undefined
            }
            // Room-scoped, so it is only mounted where a room exists — the editor
            // home renders the navbar without it, exactly as before.
            presence={activeProject ? <PresenceAvatars /> : undefined}
            saveStatus={activeProject ? <SaveStatusButton /> : undefined}
            profile={<UserButton />}
          />

          <ProjectSidebar
            isOpen={isSidebarOpen}
            ownedProjects={ownedProjects}
            sharedProjects={sharedProjects}
            onCreateProject={actions.openCreate}
            onRenameProject={actions.openRename}
            onDeleteProject={actions.openDelete}
            activeProjectId={activeProject?.id}
          />

          {/*
            Small screens only: the sidebar covers most of the viewport there,
            so it needs a scrim. The floating toggle remains the only close
            control; on desktop the panel sits beside the canvas.
          */}
          {isSidebarOpen ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 z-30 bg-black/60 md:hidden"
            />
          ) : null}

          {activeProject ? (
            <>
              {/* React Flow needs a sized parent, so the canvas fills `main`. */}
              <main aria-label="Canvas" className="relative flex-1 bg-page">
                <CanvasSurface
                  projectId={activeProject.id}
                  isTemplatesOpen={isTemplatesOpen}
                  onTemplatesOpenChange={setIsTemplatesOpen}
                />
                {launchImport.isImporting ? (
                  <div
                    role="status"
                    className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-page/70 px-6 text-center text-sm text-copy-muted"
                  >
                    Importing diagram…
                  </div>
                ) : null}
                {launchImport.error ? (
                  <AgentLaunchImportFailure
                    message={launchImport.error}
                    onRetry={launchImport.retry}
                  />
                ) : null}
              </main>

              <AiSidebar isOpen={isAiSidebarOpen} />
            </>
          ) : (
            <main className="flex flex-1 items-center justify-center bg-page px-6">
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                <h1 className="text-2xl font-medium tracking-tight text-copy-primary">
                  Create a project or open an existing one
                </h1>
                <p className="text-sm text-copy-muted">
                  Start a new architecture workspace, or choose a project from
                  the sidebar.
                </p>
                <Button className="mt-3" size="lg" onClick={actions.openCreate}>
                  <Plus className="h-4 w-4" />
                  New Project
                </Button>
              </div>
            </main>
          )}
          <ProjectDialogs actions={actions} />

          {activeProject ? (
            <ShareDialog
              project={activeProject}
              open={isShareOpen}
              onOpenChange={setIsShareOpen}
            />
          ) : null}
        </div>
      </CanvasSaveProvider>
    </CanvasRoom>
  )
}
