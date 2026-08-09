"use client";

import { useViewport } from "@xyflow/react";
import { Loader2 } from "lucide-react";

import { useCollaborators } from "@/hooks/use-collaborators";

/**
 * Other participants' cursors, drawn over the canvas (19-presence-avatars-cursors).
 *
 * Presence carries canvas coordinates, so the viewport transform is applied
 * here instead: `useViewport` re-renders on pan and zoom, which keeps a cursor
 * pinned to the diagram while the pointer itself stays a constant on-screen
 * size — rendering inside React Flow's viewport would scale the pointers with
 * the zoom level and make them unreadable at either extreme.
 *
 * Never renders the current user: `useCollaborators` excludes every connection
 * belonging to them.
 */
export function LiveCursors() {
  const collaborators = useCollaborators();
  const { x, y, zoom } = useViewport();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {collaborators.map(({ connectionId, presence, info }) => {
        // `null` while the pointer is off the canvas — see `Presence.cursor`.
        if (!presence.cursor) {
          return null;
        }

        return (
          <div
            key={connectionId}
            className="absolute left-0 top-0"
            style={{
              transform: `translate(${presence.cursor.x * zoom + x}px, ${
                presence.cursor.y * zoom + y
              }px)`,
            }}
          >
            <svg
              width="16"
              height="19"
              viewBox="0 0 16 19"
              fill={info.color}
              aria-hidden
              className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
            >
              <path d="M0.5 0.5 L0.5 15.2 L4.3 11.6 L6.9 17.4 L9.5 16.2 L6.9 10.6 L12 10.6 Z" />
            </svg>

            <span
              className="absolute left-3 top-4 flex items-center gap-1 whitespace-nowrap rounded-xl px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ backgroundColor: info.color }}
            >
              {info.name}
              {/*
                24-ai-presence-state: a participant with a generation in flight
                spins in their own badge, so the work is attributed to whoever
                (or whatever) started it. Absent presence is not thinking.
              */}
              {presence.isThinking ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
