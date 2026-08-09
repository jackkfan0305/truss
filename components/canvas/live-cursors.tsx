"use client";

import { useViewport } from "@xyflow/react";
import { Loader2 } from "lucide-react";

import { useCollaborators } from "@/hooks/use-collaborators";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { AI_CURSOR_SWEEP_MS, AI_USER_ID } from "@/types/tasks";

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
 *
 * The transform is split across three nested layers (32-live-canvas-building)
 * so the AI cursor can animate between positions. Viewport and position used to
 * be multiplied into one `translate`, and a transition on that would animate
 * pan and zoom too — the cursor would slide around behind the diagram every
 * time the canvas moved. Separated, only the position layer transitions:
 *
 *   outer  viewport pan/zoom   no transition — panning stays instant
 *   middle canvas position     transitions, AI only
 *   inner  1/zoom              no transition — cancels the outer scale, which
 *                              is what keeps the pointer a constant size
 */
export function LiveCursors() {
  const collaborators = useCollaborators();
  const { x, y, zoom } = useViewport();
  /*
   * Read here rather than left to `motion-reduce:transition-none`: the sweep is
   * an inline `transition`, and an inline declaration outranks any class, so
   * the utility could never switch it off. The AI cursor jumps to each position
   * instead of gliding when the reader has asked for less motion.
   */
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {collaborators.map(({ connectionId, id, presence, info }) => {
          // `null` while the pointer is off the canvas — see `Presence.cursor`.
          if (!presence.cursor) {
            return null;
          }

          // Only the AI sweeps. A human cursor updates at pointer frequency, and
          // a transition would render it permanently behind where the person
          // actually is.
          const shouldSweep = id === AI_USER_ID && !prefersReducedMotion;

          return (
            <div
              key={connectionId}
              className="absolute left-0 top-0"
              style={{
                transform: `translate(${presence.cursor.x}px, ${presence.cursor.y}px)`,
                transformOrigin: "0 0",
                transition: shouldSweep
                  ? `transform ${AI_CURSOR_SWEEP_MS}ms cubic-bezier(0.33, 1, 0.68, 1)`
                  : undefined,
              }}
            >
              <div
                className="absolute left-0 top-0"
                style={{
                  transform: `scale(${1 / zoom})`,
                  transformOrigin: "0 0",
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
