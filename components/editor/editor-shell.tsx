"use client"

import { useCallback, useRef, useState } from "react"
import { Plus } from "lucide-react"

import { CanvasRoom, CanvasSurface } from "@/components/canvas/canvas-room"
import { PresenceAvatars } from "@/components/canvas/presence-avatars"
import { AiSidebar } from "@/components/editor/ai-sidebar"
import { EditorNavbar } from "@/components/editor/editor-navbar"
import { ProjectDialogs } from "@/components/editor/project-dialogs"
import { ProjectSidebar } from "@/components/editor/project-sidebar"
import { SaveStatusButton } from "@/components/editor/save-status-button"
import { ShareDialog } from "@/components/editor/share-dialog"
import { Button } from "@/components/ui/button"
import type { SaveStatus } from "@/hooks/use-canvas-autosave"
import { useProjectActions } from "@/hooks/use-project-actions"
import type { ProjectAccess, ProjectSummary } from "@/types/project"

interface EditorShellProps {
  ownedProjects: ProjectSummary[]
  sharedProjects: ProjectSummary[]
  /**
   * Set on `/editor/[roomId]`, absent on the editor home. Its presence is what
   * switches the shell from the create prompt to the workspace layout.
   */
  activeProject?: ProjectAccess
}

/**
 * Owns the sidebar open/close state for the editor workspace and the project
 * dialog state. The chrome components stay presentational — see the
 * architecture notes in context/progress-tracker.md.
 */
export function EditorShell({
  ownedProjects,
  sharedProjects,
  activeProject,
}: EditorShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false)
  const [isShareOpen, setIsShareOpen] = useState(false)
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const actions = useProjectActions()

  /*
   * The canvas owns the autosave, because it is the only thing that can see the
   * flow state — but the indicator belongs in the navbar. Status comes up as
   * state; the flush comes up as a ref, since re-rendering the whole shell to
   * store a stable callback would be a render per canvas mount for nothing.
   */
  const saveNowRef = useRef<(() => void) | null>(null)
  const registerSaveNow = useCallback((saveNow: () => void) => {
    saveNowRef.current = saveNow
  }, [])

  return (
    // No-op without an active project, so the editor home never joins a room.
    <CanvasRoom roomId={activeProject?.id}>
      <div className="flex flex-1 flex-col">
        <EditorNavbar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((open) => !open)}
          projectName={activeProject?.name}
          onShare={activeProject ? () => setIsShareOpen(true) : undefined}
          onOpenTemplates={
            activeProject ? () => setIsTemplatesOpen(true) : undefined
          }
          isAiSidebarOpen={isAiSidebarOpen}
          onToggleAiSidebar={
            activeProject
              ? () => setIsAiSidebarOpen((open) => !open)
              : undefined
          }
          // Room-scoped, so it is only mounted where a room exists — the editor
          // home renders the navbar without it, exactly as before.
          presence={activeProject ? <PresenceAvatars /> : undefined}
          saveStatus={
            activeProject ? (
              <SaveStatusButton
                status={saveStatus}
                onSave={() => saveNowRef.current?.()}
              />
            ) : undefined
          }
        />

        {/*
          `relative` scopes ProjectSidebar's absolute overlay to the work area,
          so opening it slides over the canvas instead of reflowing it.
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
            activeProjectId={activeProject?.id}
          />

          {/*
            Small screens only: the sidebar covers most of the viewport there,
            so it needs a scrim and a tap-out. On desktop it sits beside the
            canvas and stays open while you work.
          */}
          {isSidebarOpen ? (
            <button
              type="button"
              aria-label="Close projects sidebar"
              onClick={() => setIsSidebarOpen(false)}
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
                  onSaveStatusChange={setSaveStatus}
                  onRegisterSaveNow={registerSaveNow}
                />
              </main>

              <AiSidebar
                isOpen={isAiSidebarOpen}
                onClose={() => setIsAiSidebarOpen(false)}
              />
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
        </div>

        <ProjectDialogs actions={actions} />

        {activeProject ? (
          <ShareDialog
            project={activeProject}
            open={isShareOpen}
            onOpenChange={setIsShareOpen}
          />
        ) : null}
      </div>
    </CanvasRoom>
  )
}
