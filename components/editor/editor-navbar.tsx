"use client"

import type { ReactNode } from "react"
import { SidebarLeftIcon, SidebarRightIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LayoutTemplate } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EditorNavbarProps {
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  /** Workspace only — the editor home has no active diagram. */
  diagramName?: string
  /** Workspace only — opens the starter template picker. */
  onOpenTemplates?: () => void
  /** Workspace only — opens the browser assistant panel. */
  isAssistantOpen?: boolean
  onToggleAssistant?: () => void
  /**
   * Workspace only — metadata for the active diagram. A slot rather than a
   * component so the navbar stays decoupled from flow state: the editor home
   * has no active diagram.
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

/** The sidebar's own surface, so the chrome reads as one family. */
const FLOATING_SURFACE =
  "rounded-xl border border-surface-border bg-elevated shadow-lg shadow-page/60"
/**
 * A plain icon button at the canvas corner. `top-3.5` centres the 36px button
 * on the 40px chips beside it.
 */
const SIDEBAR_TOGGLE = "pointer-events-auto absolute top-3.5 z-10 rounded-lg"

export function EditorNavbar({
  isSidebarOpen,
  onToggleSidebar,
  diagramName,
  onOpenTemplates,
  isAssistantOpen,
  onToggleAssistant,
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
        aria-controls="diagrams-sidebar"
        aria-expanded={isSidebarOpen}
        aria-label={
          isSidebarOpen ? "Close diagrams sidebar" : "Open diagrams sidebar"
        }
        // Rides along with the panel on a transform, on the panel's own
        // timing, so it slides instead of jumping to the panel's inner edge.
        className={cn(
          SIDEBAR_TOGGLE,
          "left-3 transition-transform ease-smooth-out motion-reduce:transition-none",
          isSidebarOpen
            ? "translate-x-[calc(min(var(--diagrams-sidebar-w),calc(100vw-1.5rem))-3.75rem)] duration-400"
            : "translate-x-0 duration-350"
        )}
      >
        <HugeiconsIcon
          icon={SidebarLeftIcon}
          aria-hidden
          className="size-5 text-copy-secondary"
        />
      </Button>

      {diagramName && !isSidebarOpen ? (
        <div
          className={cn(
            FLOATING_SURFACE,
            "pointer-events-auto absolute top-3 left-14 flex h-10 min-w-0 max-w-[calc(100%-7rem)] items-center px-4 sm:max-w-sm"
          )}
        >
          <p className="min-w-0 truncate text-sm font-medium text-copy-primary">
            {diagramName}
          </p>
        </div>
      ) : null}

      <div
        className={cn(
          FLOATING_SURFACE,
          "pointer-events-auto absolute top-15 right-3 flex h-10 items-center gap-0.5 px-1.5 transition-transform ease-smooth-out motion-reduce:transition-none sm:top-3",
          // Slides clear of the open assistant panel (--assistant-sidebar-w), mirroring how
          // the left toggle follows the diagrams sidebar. Below md the panel
          // spans nearly the full width, so there is no room to move into.
          isAssistantOpen ? "duration-400 md:-translate-x-(--assistant-sidebar-w)" : "translate-x-0 duration-350"
        )}
      >
        {saveStatus}
        {saveStatus && onOpenTemplates ? <GroupDivider /> : null}
        {onOpenTemplates ? (
          <Button variant="ghost" size="sm" onClick={onOpenTemplates}>
            <LayoutTemplate className="size-4" />
            <span className="hidden sm:inline">Templates</span>
          </Button>
        ) : null}
        {(saveStatus || onOpenTemplates) && (presence || profile) ? (
          <GroupDivider />
        ) : null}
        <div className="flex items-center gap-2 pr-0.5 pl-1">
          {presence}
          {profile}
        </div>
        {onToggleAssistant ? (
          <>
            <GroupDivider />
            {/* The mirror of the diagrams toggle: same ghost icon button, mirrored glyph. */}
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onToggleAssistant}
              aria-controls="assistant-sidebar"
              aria-expanded={isAssistantOpen}
              aria-label={isAssistantOpen ? "Close assistant" : "Open assistant"}
              className="rounded-lg"
            >
              <HugeiconsIcon
                icon={SidebarRightIcon}
                aria-hidden
                className="size-5 text-copy-secondary"
              />
            </Button>
          </>
        ) : null}
      </div>
    </header>
  )
}

/** Separates the save state, the actions and the people in the utility chip. */
function GroupDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-surface-border-subtle" />
}
