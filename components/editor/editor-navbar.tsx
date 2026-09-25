"use client"

import type { ReactNode } from "react"
import { SidebarLeftIcon, SidebarRightIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LayoutTemplate, Share2 } from "lucide-react"

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

/** The sidebars' own surface, so the chrome reads as one family. */
const FLOATING_SURFACE =
  "rounded-xl border border-surface-border bg-elevated shadow-lg shadow-page/60"
/**
 * Plain icon buttons at the canvas corners, one per sidebar. `top-3.5` centres
 * the 36px button on the 40px chips beside it.
 */
const SIDEBAR_TOGGLE = "pointer-events-auto absolute top-3.5 z-10 rounded-lg"

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
        // Rides along with the panel on a transform, on the panel's own
        // timing, so it slides instead of jumping to the panel's inner edge.
        className={cn(
          SIDEBAR_TOGGLE,
          "left-3 transition-transform ease-smooth-out motion-reduce:transition-none",
          isSidebarOpen
            ? "translate-x-[calc(min(18rem,calc(100vw-1.5rem))-3.75rem)] duration-400"
            : "translate-x-0 duration-350"
        )}
      >
        <HugeiconsIcon
          icon={SidebarLeftIcon}
          aria-hidden
          className="size-5 text-copy-secondary"
        />
      </Button>

      {projectName && !isSidebarOpen ? (
        <div
          className={cn(
            FLOATING_SURFACE,
            "pointer-events-auto absolute flex h-10 min-w-0 items-center px-4",
            isAiSidebarOpen
              ? "top-15 left-3 max-w-[calc(100%-14rem)] xl:top-3 xl:left-14 xl:max-w-sm"
              : "top-3 left-14 max-w-[calc(100%-7rem)] sm:max-w-sm"
          )}
        >
          <p className="min-w-0 truncate text-sm font-medium text-copy-primary">
            {projectName}
          </p>
        </div>
      ) : null}

      <div
        className={cn(
          FLOATING_SURFACE,
          "pointer-events-auto absolute flex h-10 items-center gap-0.5 px-1.5",
          isAiSidebarOpen
            ? "top-15 right-3 xl:top-3 xl:right-[calc(26rem+0.75rem)]"
            : "top-15 right-3 sm:top-3 sm:right-14"
        )}
      >
        {saveStatus}
        {saveStatus && (onOpenTemplates || onShare) ? <GroupDivider /> : null}
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
        {(saveStatus || onOpenTemplates || onShare) && (presence || profile) ? (
          <GroupDivider />
        ) : null}
        <div className="flex items-center gap-2 pr-0.5 pl-1">
          {presence}
          {profile}
        </div>
      </div>

      {onToggleAiSidebar && !isAiSidebarOpen ? (
        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onToggleAiSidebar}
          aria-controls="ai-sidebar"
          aria-expanded={isAiSidebarOpen}
          aria-label="Open AI sidebar"
          className={cn(SIDEBAR_TOGGLE, "right-3")}
        >
          <HugeiconsIcon
            icon={SidebarRightIcon}
            aria-hidden
            className="size-5 text-copy-secondary"
          />
        </Button>
      ) : null}
    </header>
  )
}

/** Separates the save state, the actions and the people in the utility chip. */
function GroupDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-surface-border-subtle" />
}
