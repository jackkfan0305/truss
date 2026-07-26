"use client"

import { FolderOpen, Plus, Users, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

interface ProjectSidebarProps {
  isOpen: boolean
  onClose: () => void
  className?: string
}

export function ProjectSidebar({
  isOpen,
  onClose,
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
          <EmptyState
            icon={<FolderOpen className="h-8 w-8 text-copy-faint" />}
            message="No projects yet"
          />
        </TabsContent>
        <TabsContent value="shared">
          <EmptyState
            icon={<Users className="h-8 w-8 text-copy-faint" />}
            message="Nothing shared with you"
          />
        </TabsContent>
      </Tabs>

      <Button className="w-full">
        <Plus className="h-4 w-4" />
        New Project
      </Button>
    </aside>
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
