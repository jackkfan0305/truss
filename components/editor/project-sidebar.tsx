"use client"

import { FolderOpen, Pencil, Plus, Trash2, Users, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ProjectSummary } from "@/types/project"

interface ProjectSidebarProps {
  isOpen: boolean
  onClose: () => void
  ownedProjects: ProjectSummary[]
  sharedProjects: ProjectSummary[]
  onCreateProject: () => void
  onRenameProject: (project: ProjectSummary) => void
  onDeleteProject: (project: ProjectSummary) => void
  className?: string
}

export function ProjectSidebar({
  isOpen,
  onClose,
  ownedProjects,
  sharedProjects,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  className,
}: ProjectSidebarProps) {
  return (
    // Overlay, not a flex child — opening it must not reflow the canvas.
    <aside
      aria-label="Projects"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-0 left-0 z-40 flex w-72 flex-col gap-4 border-r border-surface-border bg-surface/95 p-4 backdrop-blur transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "-translate-x-full",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-copy-primary">Projects</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close projects sidebar"
        >
          <X className="h-4 w-4 text-copy-muted" />
        </Button>
      </div>

      <Tabs defaultValue="mine" className="min-h-0 flex-1">
        <TabsList className="w-full">
          <TabsTrigger value="mine">My Projects</TabsTrigger>
          <TabsTrigger value="shared">Shared</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          {ownedProjects.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-8 w-8 text-copy-faint" />}
              message="No projects yet"
            />
          ) : (
            <ProjectList
              label="My projects"
              projects={ownedProjects}
              onRename={onRenameProject}
              onDelete={onDeleteProject}
            />
          )}
        </TabsContent>
        <TabsContent value="shared">
          {sharedProjects.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8 text-copy-faint" />}
              message="Nothing shared with you"
            />
          ) : (
            // No rename/delete: collaborators do not own these projects.
            <ProjectList label="Shared with me" projects={sharedProjects} />
          )}
        </TabsContent>
      </Tabs>

      <Button className="w-full" onClick={onCreateProject}>
        <Plus className="h-4 w-4" />
        New Project
      </Button>
    </aside>
  )
}

function ProjectList({
  label,
  projects,
  onRename,
  onDelete,
}: {
  label: string
  projects: ProjectSummary[]
  onRename?: (project: ProjectSummary) => void
  onDelete?: (project: ProjectSummary) => void
}) {
  return (
    <ul aria-label={label} className="flex h-full flex-col gap-0.5 overflow-y-auto">
      {projects.map((project) => (
        <li
          key={project.id}
          className="flex items-center gap-1 rounded-xl px-2 py-1.5 transition-colors hover:bg-subtle"
        >
          {/* Opening a project arrives with the workspace route in 08. */}
          <span className="min-w-0 flex-1 truncate text-sm text-copy-secondary">
            {project.name}
          </span>

          {onRename ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRename(project)}
              aria-label={`Rename ${project.name}`}
            >
              <Pencil className="h-3 w-3 text-copy-muted" />
            </Button>
          ) : null}

          {onDelete ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(project)}
              aria-label={`Delete ${project.name}`}
            >
              <Trash2 className="h-3 w-3 text-copy-muted" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function EmptyState({
  icon,
  message,
}: {
  icon: React.ReactNode
  message: string
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-surface-border p-6 text-center">
      {icon}
      <p className="text-sm text-copy-muted">{message}</p>
    </div>
  )
}
