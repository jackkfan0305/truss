"use client";

import { type DragEvent } from "react";

import { AwsIcon } from "@/components/canvas/aws-icon";
import { AWS_CATALOG, searchAwsCatalog } from "@/lib/aws-catalog";
import { AWS_DRAG_MIME, buildAwsDragPayload } from "@/lib/canvas-drag";

/** Category chips for the dock, in catalog order. */
export const AWS_CATEGORIES = [...new Set(AWS_CATALOG.map((entry) => entry.category))];

/** Shared by every dock section so the grids look identical. */
export const DOCK_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] content-start gap-1.5";
export const DOCK_TILE_CLASS =
  "dock-tile flex cursor-grab flex-col items-center gap-1.5 rounded-[10px] px-1 py-2.5 text-center text-[11px] text-copy-secondary transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing";

/** Stagger for the tile unblur: a short wait for the dock to grow, then 18ms per tile. */
export const tileDelay = (index: number) => ({ animationDelay: `${120 + index * 18}ms` });

function handleDragStart(event: DragEvent<HTMLButtonElement>, catalogId: string) {
  event.dataTransfer.setData(AWS_DRAG_MIME, JSON.stringify(buildAwsDragPayload(catalogId)));
  event.dataTransfer.effectAllowed = "copy";
}

interface AwsPanelProps {
  query: string;
  /** A catalog category, or null for all of them. */
  category: string | null;
  onAddEntry: (catalogId: string) => void;
}

/**
 * The AWS section of the bottom dock: a grid of native buttons, so Enter and
 * Space insert without any custom key handling. Items are also HTML drag
 * sources. Search, category chips, opening and Escape belong to `SectionDock`.
 */
export function AwsPanel({ query, category, onAddEntry }: AwsPanelProps) {
  const results = searchAwsCatalog(query).filter((entry) => !category || entry.category === category);

  if (results.length === 0) {
    return <p className="text-sm text-copy-muted">No AWS items match your search</p>;
  }

  return (
    <div id="aws-panel" role="group" aria-label="AWS items" className={DOCK_GRID_CLASS}>
      {results.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          draggable
          title={entry.description}
          aria-describedby={`${entry.id}-description`}
          onDragStart={(event) => handleDragStart(event, entry.id)}
          onClick={() => onAddEntry(entry.id)}
          className={DOCK_TILE_CLASS}
          style={tileDelay(index)}
        >
          <AwsIcon catalogId={entry.id} className="h-8 w-8" />
          {entry.name}
          <span id={`${entry.id}-description`} className="sr-only">
            {entry.description}
          </span>
        </button>
      ))}
    </div>
  );
}
