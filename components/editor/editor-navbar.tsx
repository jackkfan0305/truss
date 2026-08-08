"use client"

import type { ReactNode } from "react"
import { UserButton } from "@clerk/nextjs"
import {
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  Share2,
  Sparkles,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EditorNavbarProps {
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  /** Workspace only — the editor home has no active project. */
  projectName?: string
  onShare?: () => void
  /** Workspace only — opens the starter template picker. */
  onOpenTemplates?: () => void
  isAiSidebarOpen?: boolean
  onToggleAiSidebar?: () => void
  /**
   * Workspace only — the collaborator avatar stack, rendered beside the Clerk
   * UserButton. A slot rather than a component so the navbar stays outside the
   * Liveblocks room: the editor home has no room, and calling a presence hook
   * there would throw (19-presence-avatars-cursors).
   */
  presence?: ReactNode
  /**
   * Workspace only — the canvas save state. A slot for the same reason
   * `presence` is one: it is driven by flow state that only exists inside the
   * canvas, and the editor home has no canvas at all (21-canvas-autosave).
   */
  saveStatus?: ReactNode
  className?: string
}

export function EditorNavbar({
  isSidebarOpen,
  onToggleSidebar,
  projectName,
  onShare,
  onOpenTemplates,
  isAiSidebarOpen = false,
  onToggleAiSidebar,
  presence,
  saveStatus,
  className,
}: EditorNavbarProps) {
  const ToggleIcon = isSidebarOpen ? PanelLeftClose : PanelLeftOpen

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-2 border-b border-surface-border bg-page px-3",
        className
      )}
    >
      <div className="flex flex-1 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
        >
          <ToggleIcon className="h-5 w-5 text-copy-secondary" />
        </Button>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center">
        {projectName ? (
          <p className="truncate text-sm font-medium text-copy-primary">
            {projectName}
          </p>
        ) : null}
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        {saveStatus}

        {onOpenTemplates ? (
          <Button variant="ghost" size="sm" onClick={onOpenTemplates}>
            <LayoutTemplate className="h-4 w-4" />
            <span className="hidden sm:inline">Templates</span>
          </Button>
        ) : null}

        {onToggleAiSidebar ? (
          <>
            <Button variant="ghost" size="sm" onClick={onShare}>
              <Share2 className="h-4 w-4" />
              <span className="hidden sm:inline">Share</span>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleAiSidebar}
              aria-expanded={isAiSidebarOpen}
              aria-label={
                isAiSidebarOpen ? "Close AI assistant" : "Open AI assistant"
              }
            >
              <Sparkles
                className={cn(
                  "h-5 w-5",
                  isAiSidebarOpen ? "text-ai-text" : "text-copy-secondary"
                )}
              />
            </Button>
          </>
        ) : null}

        {presence}

        <UserButton />
      </div>
    </header>
  )
}
