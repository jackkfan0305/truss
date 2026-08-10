"use client"

import type { ReactNode } from "react"
import {
  LayoutTemplate,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Share2,
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
  /** Account control supplied by the shell so this component stays pure. */
  profile?: ReactNode
  className?: string
}

const FLOATING_SURFACE =
  "rounded-xl border border-surface-border bg-surface/80 shadow-lg shadow-page/40 backdrop-blur-xl"
const FLOATING_CONTROL =
  "pointer-events-auto absolute top-3 z-10 rounded-xl border border-surface-border bg-surface/80 shadow-lg shadow-page/40 backdrop-blur-xl"

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
  profile,
  className,
}: EditorNavbarProps) {
  const LeftToggleIcon = isSidebarOpen ? PanelLeftClose : PanelLeftOpen
  const RightToggleIcon = isAiSidebarOpen
    ? PanelRightClose
    : PanelRightOpen

  return (
    <header
      className={cn(
        "pointer-events-none absolute inset-0 z-50 min-w-0",
        className
      )}
    >
      <Button
        variant="ghost"
        size="icon-lg"
        onClick={onToggleSidebar}
        aria-controls="projects-sidebar"
        aria-expanded={isSidebarOpen}
        aria-label={
          isSidebarOpen ? "Close projects sidebar" : "Open projects sidebar"
        }
        className={cn(
          FLOATING_CONTROL,
          isSidebarOpen
            ? "left-[calc(min(18rem,calc(100vw-1.5rem))-3rem)]"
            : "left-3"
        )}
      >
        <LeftToggleIcon className="size-5 text-copy-secondary" />
      </Button>

      {projectName && !isSidebarOpen ? (
        <div
          className={cn(
            FLOATING_SURFACE,
            "pointer-events-auto absolute flex h-9 min-w-0 items-center px-3",
            isAiSidebarOpen
              ? "top-15 left-3 max-w-[calc(100%-14rem)] xl:top-3 xl:left-14 xl:max-w-sm"
              : "top-3 left-14 max-w-[calc(100%-7rem)] sm:max-w-sm"
          )}
        >
          <p className="min-w-0 truncate pr-2 text-sm font-medium text-copy-primary">
            {projectName}
          </p>
        </div>
      ) : null}

      <div
        className={cn(
          FLOATING_SURFACE,
          "pointer-events-auto absolute flex h-10 items-center gap-1 px-1",
          isAiSidebarOpen
            ? "top-15 right-3 xl:top-3 xl:right-[calc(26rem+0.75rem)]"
            : "top-15 right-3 sm:top-3 sm:right-14"
        )}
      >
        {saveStatus}
        {onOpenTemplates ? (
          <Button variant="ghost" size="sm" onClick={onOpenTemplates}>
            <LayoutTemplate className="size-4" />
            <span
              className={
                isAiSidebarOpen ? "hidden xl:inline" : "hidden sm:inline"
              }
            >
              Templates
            </span>
          </Button>
        ) : null}
        {onShare ? (
          <Button variant="ghost" size="sm" onClick={onShare}>
            <Share2 className="size-4" />
            <span
              className={
                isAiSidebarOpen ? "hidden xl:inline" : "hidden sm:inline"
              }
            >
              Share
            </span>
          </Button>
        ) : null}
        {presence}
        {profile}
      </div>

      {onToggleAiSidebar ? (
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onToggleAiSidebar}
          aria-controls="ai-sidebar"
          aria-expanded={isAiSidebarOpen}
          aria-label={isAiSidebarOpen ? "Close AI sidebar" : "Open AI sidebar"}
          className={cn(
            FLOATING_CONTROL,
            isAiSidebarOpen
              ? "right-[calc(min(26rem,calc(100vw-1.5rem))-3.75rem)] xl:right-[calc(26rem-3rem)]"
              : "right-3"
          )}
        >
          <RightToggleIcon className="size-5 text-copy-secondary" />
        </Button>
      ) : null}
    </header>
  )
}
