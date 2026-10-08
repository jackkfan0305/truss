"use client";

import { type DragEvent } from "react";

import { CodeIcon } from "@/components/canvas/code-icon";
import { searchCodeCatalog } from "@/lib/code-catalog";
import { CODE_DRAG_MIME, buildCodeDragPayload } from "@/lib/canvas-drag";
import { DOCK_GRID_CLASS, DOCK_TILE_CLASS, tileDelay } from "@/lib/dock-ui";

export function handleCodeDragStart(event: DragEvent<HTMLButtonElement>, catalogId: string) {
  event.dataTransfer.setData(CODE_DRAG_MIME, JSON.stringify(buildCodeDragPayload(catalogId)));
  event.dataTransfer.effectAllowed = "copy";
}

/** The Code section of the bottom dock. Seven entries need only search, so it has no category chips. */
export function CodePanel({ query, onAddEntry }: { query: string; onAddEntry: (catalogId: string) => void }) {
  const results = searchCodeCatalog(query);

  if (results.length === 0) {
    return <p className="text-sm text-copy-muted">No code items match your search</p>;
  }

  return (
    <div id="code-panel" role="group" aria-label="Code items" className={DOCK_GRID_CLASS}>
      {results.map((entry, index) => (
        <button
          key={entry.id}
          type="button"
          draggable
          title={entry.description}
          aria-describedby={`${entry.id}-description`}
          onDragStart={(event) => handleCodeDragStart(event, entry.id)}
          onClick={() => onAddEntry(entry.id)}
          className={DOCK_TILE_CLASS}
          style={tileDelay(index)}
        >
          <CodeIcon catalogId={entry.id} className="h-8 w-8" />
          {entry.name}
          <span id={`${entry.id}-description`} className="sr-only">{entry.description}</span>
        </button>
      ))}
    </div>
  );
}
