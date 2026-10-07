"use client";

import { type DragEvent } from "react";

import { AwsIcon } from "@/components/canvas/aws-icon";
import { searchAwsCatalog } from "@/lib/aws-catalog";
import { DOCK_GRID_CLASS, DOCK_TILE_CLASS, tileDelay } from "@/lib/dock-ui";
import { AWS_DRAG_MIME, buildAwsDragPayload } from "@/lib/canvas-drag";

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
