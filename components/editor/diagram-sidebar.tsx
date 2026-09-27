"use client"

import Link from "next/link"
import { FolderOpen, Pencil, Plus, Trash2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import type { DiagramSummary } from "@/types/diagram"

interface DiagramSidebarProps {
  isOpen: boolean
  ownedDiagrams: DiagramSummary[]
  sharedDiagrams: DiagramSummary[]
  onCreateDiagram: () => void
  onRenameDiagram: (diagram: DiagramSummary) => void
  onDeleteDiagram: (diagram: DiagramSummary) => void
  /** Diagram the workspace is currently showing, highlighted in the list. */
  activeDiagramId?: string
  className?: string
}

export function DiagramSidebar({
  isOpen,
  ownedDiagrams,
  sharedDiagrams,
  onCreateDiagram,
  onRenameDiagram,
  onDeleteDiagram,
  activeDiagramId,
  className,
}: DiagramSidebarProps) {
  return (
    // Overlay, not a flex child — opening it must not reflow the canvas.
    <aside
      id="diagrams-sidebar"
      aria-label="Diagrams"
      inert={!isOpen}
      className={cn(
        "absolute inset-y-0 left-0 z-40 flex w-72 max-w-[calc(100%-1.5rem)] flex-col gap-4 border-r border-surface-border bg-elevated px-4 pt-3.5 pb-4 shadow-2xl shadow-page/80 transition-transform ease-smooth-out motion-reduce:transition-none",
        // Open is the invitation, close gets out of the way: 400ms in, 350ms out.
        isOpen ? "translate-x-0 duration-400" : "-translate-x-[calc(100%+2rem)] duration-350",
        className
      )}
    >
      <div className="flex h-9 shrink-0 items-center pr-10">
        <h2 className="text-sm font-medium text-copy-primary">Diagrams</h2>
      </div>

      <Tabs defaultValue="mine" className="min-h-0 flex-1 max-sm:pt-8">
        <TabsList className="w-full">
          <TabsTrigger value="mine">My Diagrams</TabsTrigger>
          <TabsTrigger value="shared">Shared</TabsTrigger>
        </TabsList>
        <TabsContent value="mine">
          {ownedDiagrams.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-8 w-8 text-copy-faint" />}
              message="No diagrams yet"
            />
          ) : (
            <DiagramList
              label="My diagrams"
              diagrams={ownedDiagrams}
              activeDiagramId={activeDiagramId}
              onRename={onRenameDiagram}
              onDelete={onDeleteDiagram}
            />
          )}
        </TabsContent>
        <TabsContent value="shared">
          {sharedDiagrams.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8 text-copy-faint" />}
              message="Nothing shared with you"
            />
          ) : (
            // No rename/delete: collaborators do not own these diagrams.
            <DiagramList
              label="Shared with me"
              diagrams={sharedDiagrams}
              activeDiagramId={activeDiagramId}
            />
          )}
        </TabsContent>
      </Tabs>

      <Button className="w-full" onClick={onCreateDiagram}>
        <Plus className="h-4 w-4" />
        New Diagram
      </Button>
    </aside>
  )
}

function DiagramList({
  label,
  diagrams,
  activeDiagramId,
  onRename,
  onDelete,
}: {
  label: string
  diagrams: DiagramSummary[]
  activeDiagramId?: string
  onRename?: (diagram: DiagramSummary) => void
  onDelete?: (diagram: DiagramSummary) => void
}) {
  return (
    <ul aria-label={label} className="flex h-full flex-col gap-0.5 overflow-y-auto">
      {diagrams.map((diagram) => {
        const isActive = diagram.id === activeDiagramId

        return (
        <li
          key={diagram.id}
          className={cn(
            "group flex items-center gap-1 rounded-xl px-2 py-1.5 transition-colors",
            isActive ? "bg-subtle" : "hover:bg-subtle"
          )}
        >
          {/* The diagram ID is the workspace route segment — see the
              one-identifier decision in context/progress-tracker.md. */}
          <Link
            href={`/editor/${diagram.id}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "min-w-0 flex-1 truncate rounded-xl text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive
                ? "text-copy-primary"
                : "text-copy-secondary hover:text-copy-primary"
            )}
          >
            {diagram.name}
          </Link>

          {onRename ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRename(diagram)}
              aria-label={`Rename ${diagram.name}`}
              // Row actions stay out of the way until the row is pointed at or
              // focused; touch screens have no hover, so they always show there.
              className="transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <Pencil className="h-3 w-3 text-copy-muted" />
            </Button>
          ) : null}

          {onDelete ? (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(diagram)}
              aria-label={`Delete ${diagram.name}`}
              className="transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 group-focus-within:opacity-100"
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
