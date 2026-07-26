"use client"

import { useState } from "react"

import { EditorNavbar } from "@/components/editor/editor-navbar"
import { ProjectSidebar } from "@/components/editor/project-sidebar"

/**
 * Owns the sidebar open/close state for the editor workspace. The chrome
 * components stay presentational — see the architecture notes in
 * context/progress-tracker.md.
 */
export function EditorShell() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

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
        />

        <main className="flex flex-1 items-center justify-center bg-base px-6 text-center">
          <p className="text-sm text-copy-muted">
            Select a project or create a new one to get started.
          </p>
        </main>
      </div>
    </div>
  )
}
