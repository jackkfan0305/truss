"use client"

import Link from "next/link"
import { FolderOpen, Pencil, Plus, Trash2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { ProjectSummary } from "@/types/project"

interface ProjectSidebarProps {
  isOpen: boolean
  ownedProjects: ProjectSummary[]
  sharedProjects: ProjectSummary[]
  onCreateProject: () => void
  onRenameProject: (project: ProjectSummary) => void
  onDeleteProject: (project: ProjectSummary) => void
  /** Project the workspace is currently showing, highlighted in the list. */
  activeProjectId?: string
  className?: string
}

export function ProjectSidebar({
  isOpen,
  ownedProjects,
  sharedProjects,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  activeProjectId,
  className,
}: ProjectSidebarProps) {
  return (
    // Overlay, not a flex child — opening it must not reflow the canvas.
    <aside
      id="projects-sidebar"
      aria-label="Projects"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-0 left-0 z-40 flex w-72 max-w-[calc(100%-1.5rem)] flex-col gap-4 border-r border-surface-border bg-surface/80 p-4 shadow-2xl shadow-black/60 backdrop-blur-xl transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "-translate-x-[calc(100%+2rem)]",
        className
      )}
    >
      <div className="flex h-9 shrink-0 items-center pr-10">
        <h2 className="text-sm font-medium text-copy-primary">Projects</h2>
      </div>

      <Tabs defaultValue="mine" className="min-h-0 flex-1 max-sm:pt-8">
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
              activeProjectId={activeProjectId}
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
            <ProjectList
              label="Shared with me"
              projects={sharedProjects}
              activeProjectId={activeProjectId}
            />
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
  activeProjectId,
  onRename,
  onDelete,
}: {
  label: string
  projects: ProjectSummary[]
  activeProjectId?: string
  onRename?: (project: ProjectSummary) => void
  onDelete?: (project: ProjectSummary) => void
}) {
  return (
    <ul aria-label={label} className="flex h-full flex-col gap-0.5 overflow-y-auto">
      {projects.map((project) => {
        const isActive = project.id === activeProjectId

        return (
        <li
          key={project.id}
          className={cn(
            "flex items-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
            isActive ? "bg-subtle" : "hover:bg-subtle"
          )}
        >
          {/* The project ID is the workspace route segment — see the
              one-identifier decision in context/progress-tracker.md. */}
          <Link
            href={`/editor/${project.id}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "min-w-0 flex-1 truncate rounded-xl text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive
                ? "text-copy-primary"
                : "text-copy-secondary hover:text-copy-primary"
            )}
          >
            {project.name}
          </Link>

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
        )
      })}
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
