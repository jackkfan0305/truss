"use client"

import { useState } from "react"
import { UserButton } from "@clerk/nextjs"
import { Plus } from "lucide-react"

import { CanvasRoom, CanvasSurface } from "@/components/canvas/canvas-room"
import { CanvasSaveProvider } from "@/components/canvas/canvas-save-context"
import { PresenceAvatars } from "@/components/canvas/presence-avatars"
import { AgentLaunchImportController } from "@/components/editor/agent-launch-import-status"
import { EditorNavbar } from "@/components/editor/editor-navbar"
import { DiagramDialogs } from "@/components/editor/diagram-dialogs"
import { DiagramSidebar } from "@/components/editor/diagram-sidebar"
import { SaveStatusButton } from "@/components/editor/save-status-button"
import { ShareDialog } from "@/components/editor/share-dialog"
import { Button } from "@/components/ui/button"
import { useDiagramActions } from "@/hooks/use-diagram-actions"
import {
  initialEditorSidebar,
  type EditorSidebar,
} from "@/lib/editor-sidebar-state"
import type { DiagramAccess, DiagramSummary } from "@/types/diagram"

interface EditorShellProps {
  ownedDiagrams: DiagramSummary[]
  sharedDiagrams: DiagramSummary[]
  /**
   * Set on `/editor/[roomId]`, absent on the editor home. Its presence is what
   * switches the shell from the create prompt to the workspace layout.
   */
  activeDiagram?: DiagramAccess
  /** An opaque launch UUID, only accepted for an already-authorized diagram. */
  launchId?: string
}

type OpenSidebar = EditorSidebar

/**
 * Owns the sidebar open/close state for the editor workspace and the diagram
 * dialog state. The chrome components stay presentational — see the
 * architecture notes in context/progress-tracker.md.
 */
export function EditorShell({
  ownedDiagrams,
  sharedDiagrams,
  activeDiagram,
  launchId,
}: EditorShellProps) {
  const [openSidebar, setOpenSidebar] = useState<OpenSidebar>(
    () => initialEditorSidebar()
  )
  const [isShareOpen, setIsShareOpen] = useState(false)
  /*
   * Sharing hangs off the storyboard, so a standalone diagram — every
   * agent-created one, until it is placed on a board — has nobody to invite
   * and no Share button. See CONTEXT.md on Collaborator.
   */
  const shareStoryboardId = activeDiagram?.ownsStoryboard
    ? activeDiagram.storyboardId
    : null
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false)
  const actions = useDiagramActions()
  const isSidebarOpen = openSidebar === "diagrams"

  return (
    // No-op without an active diagram, so the editor home never joins a room.
    <CanvasRoom roomId={activeDiagram?.id}>
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
                current === "diagrams" ? null : "diagrams"
              )
            }
            diagramName={activeDiagram?.name}
            onShare={shareStoryboardId ? () => setIsShareOpen(true) : undefined}
            onOpenTemplates={
              activeDiagram ? () => setIsTemplatesOpen(true) : undefined
            }
            // Room-scoped, so it is only mounted where a room exists — the editor
            // home renders the navbar without it, exactly as before.
            presence={activeDiagram ? <PresenceAvatars /> : undefined}
            saveStatus={activeDiagram ? <SaveStatusButton /> : undefined}
            profile={<UserButton />}
          />

          <DiagramSidebar
            isOpen={isSidebarOpen}
            ownedDiagrams={ownedDiagrams}
            sharedDiagrams={sharedDiagrams}
            onCreateDiagram={actions.openCreate}
            onRenameDiagram={actions.openRename}
            onDeleteDiagram={actions.openDelete}
            activeDiagramId={activeDiagram?.id}
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

          {activeDiagram ? (
            /* React Flow needs a sized parent, so the canvas fills `main`. */
            <main aria-label="Canvas" className="relative flex-1 bg-page">
              <CanvasSurface
                diagramId={activeDiagram.id}
                isTemplatesOpen={isTemplatesOpen}
                onTemplatesOpenChange={setIsTemplatesOpen}
              >
                <AgentLaunchImportController
                  launchId={launchId}
                  roomId={activeDiagram.id}
                />
              </CanvasSurface>
            </main>
          ) : (
            <main className="flex flex-1 items-center justify-center bg-page px-6">
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                <h1 className="text-2xl font-medium tracking-tight text-copy-primary">
                  Create a diagram or open an existing one
                </h1>
                <p className="text-sm text-copy-muted">
                  Start a new architecture workspace, or choose a diagram from
                  the sidebar.
                </p>
                <Button className="mt-3" size="lg" onClick={actions.openCreate}>
                  <Plus className="h-4 w-4" />
                  New Diagram
                </Button>
              </div>
            </main>
          )}
          <DiagramDialogs actions={actions} />

          {activeDiagram && shareStoryboardId ? (
            <ShareDialog
              diagram={activeDiagram}
              storyboardId={shareStoryboardId}
              open={isShareOpen}
              onOpenChange={setIsShareOpen}
            />
          ) : null}
        </div>
      </CanvasSaveProvider>
    </CanvasRoom>
  )
}
