"use client"

import type { ReactNode } from "react"
import { PanelLeft, PanelRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FLOATING_SURFACE } from "@/lib/floating-surface"
import { cn } from "@/lib/utils"

interface EditorNavbarProps {
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  /** Workspace only — the editor home has no active diagram. */
  diagramName?: string
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

/** The chips are 40px tall; `px-0.5` around a 36px button keeps it centred. */
const CHIP = cn(FLOATING_SURFACE, "pointer-events-auto absolute top-3 flex h-10 items-center rounded-xl px-0.5")

export function EditorNavbar({
  isSidebarOpen,
  onToggleSidebar,
  diagramName,
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
      {/*
        The mirror of the utility chip: toggle, divider, title. Open, the title
        folds away and the chip rides the panel's edge on a transform, on the
        panel's own timing, so it slides instead of jumping.
      */}
      <div
        className={cn(
          CHIP,
          "left-3 z-10 min-w-0 max-w-[calc(100%-1.5rem)] transition-transform ease-smooth-out motion-reduce:transition-none sm:max-w-sm",
          isSidebarOpen
            ? "translate-x-[calc(min(var(--diagrams-sidebar-w),calc(100vw-1.5rem))-4.125rem)] duration-400"
            : "translate-x-0 duration-350"
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
          className="shrink-0 rounded-lg"
        >
          <PanelLeft aria-hidden className="size-5 text-copy-secondary" />
        </Button>
        {diagramName && !isSidebarOpen ? (
          <>
            <GroupDivider />
            <p className="min-w-0 truncate pr-3.5 pl-1 text-sm font-medium text-copy-primary">
              {diagramName}
            </p>
          </>
        ) : null}
      </div>

      <div
        className={cn(
          CHIP,
          "top-15 right-3 gap-0.5 px-1.5 transition-transform ease-smooth-out motion-reduce:transition-none sm:top-3",
          // Slides clear of the open assistant panel (--assistant-sidebar-w), mirroring how
          // the left toggle follows the diagrams sidebar. Below md the panel
          // spans nearly the full width, so there is no room to move into.
          isAssistantOpen ? "duration-400 md:-translate-x-(--assistant-sidebar-w)" : "translate-x-0 duration-350"
        )}
      >
        {saveStatus}
        {saveStatus && (presence || profile) ? (
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
              <PanelRight aria-hidden className="size-5 text-copy-secondary" />
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
