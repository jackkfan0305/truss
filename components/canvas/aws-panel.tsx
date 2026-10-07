"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { Cloud } from "lucide-react";

import { AwsIcon } from "@/components/canvas/aws-icon";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { searchAwsCatalog, type AwsCatalogEntry } from "@/lib/aws-catalog";
import { AWS_DRAG_MIME, buildAwsDragPayload } from "@/lib/canvas-drag";

const SECTIONS = [
  { kind: "service", title: "Services" },
  { kind: "boundary", title: "Boundaries" },
] as const;

/** Entries of one kind, grouped by category in catalog order. */
function groupByCategory(entries: readonly AwsCatalogEntry[]): [string, AwsCatalogEntry[]][] {
  const groups = new Map<string, AwsCatalogEntry[]>();
  for (const entry of entries) {
    groups.set(entry.category, [...(groups.get(entry.category) ?? []), entry]);
  }
  return [...groups];
}

function handleDragStart(event: DragEvent<HTMLButtonElement>, catalogId: string) {
  event.dataTransfer.setData(AWS_DRAG_MIME, JSON.stringify(buildAwsDragPayload(catalogId)));
  event.dataTransfer.effectAllowed = "copy";
}

interface AwsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddEntry: (catalogId: string) => void;
}

/**
 * Searchable AWS picker: a trigger button plus a panel of native buttons, so
 * Enter and Space insert without any custom key handling. Items are also HTML
 * drag sources. Escape closes and returns focus to the trigger.
 */
export function AwsPanel({ open, onOpenChange, onAddEntry }: AwsPanelProps) {
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const results = searchAwsCatalog(query);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onOpenChange(false);
    triggerRef.current?.focus();
  };

  return (
    <div className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls="aws-panel"
        aria-label="AWS items"
        title="AWS items"
        onClick={() => onOpenChange(!open)}
        className="flex h-12 w-12 items-center justify-center rounded-full border border-surface-border bg-elevated/90 text-copy-muted shadow-lg backdrop-blur transition-colors hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Cloud className="h-5 w-5" aria-hidden />
      </button>
      {open ? (
        <TooltipProvider>
          <div
            id="aws-panel"
            role="region"
            aria-label="AWS items"
            className="absolute bottom-full left-1/2 mb-3 flex max-h-[60vh] w-80 -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-lg border border-surface-border bg-elevated p-3 shadow-lg"
          >
            <Input
              autoFocus
              type="search"
              aria-label="Search AWS items"
              placeholder="Search AWS items"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {results.length === 0 ? (
              <p className="text-sm text-copy-muted">No AWS items match your search</p>
            ) : (
              SECTIONS.map(({ kind, title }) => {
                const groups = groupByCategory(results.filter((entry) => entry.kind === kind));
                if (groups.length === 0) return null;
                return (
                  <section key={kind} aria-label={title} className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase text-copy-secondary">{title}</h3>
                    {groups.map(([category, entries]) => (
                      <div key={category} role="group" aria-label={category} className="flex flex-col gap-1">
                        <h4 className="text-xs text-copy-muted">{category}</h4>
                        {entries.map((entry) => (
                          <Tooltip key={entry.id}>
                            <TooltipTrigger
                              render={
                                <button
                                  type="button"
                                  draggable
                                  aria-describedby={`${entry.id}-description`}
                                  onDragStart={(event) => handleDragStart(event, entry.id)}
                                  onClick={() => onAddEntry(entry.id)}
                                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-copy-primary hover:bg-subtle focus-visible:outline-2 focus-visible:outline-brand"
                                />
                              }
                            >
                              <AwsIcon catalogId={entry.id} className="h-6 w-6" />
                              {entry.name}
                              <span id={`${entry.id}-description`} className="sr-only">
                                {entry.description}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right">{entry.description}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    ))}
                  </section>
                );
              })
            )}
          </div>
        </TooltipProvider>
      ) : null}
    </div>
  );
}
