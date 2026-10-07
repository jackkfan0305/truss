"use client";

import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { Liquid } from "liquid-gooey";
import {
  Maximize,
  Plus,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { type CanvasHistoryControls } from "@/hooks/use-canvas-history";
import { LIQUID_SURFACE } from "@/lib/floating-surface";
import {
  VIEWPORT_TRANSITION_MS,
  type CanvasEdge,
  type CanvasNode,
} from "@/types/canvas";

const TRANSITION = { duration: VIEWPORT_TRANSITION_MS };

/** The first item clears the toggle by 8px; the rest sit 4px apart, close enough to bridge. */
const OFFSETS = [56, 108, 160] as const;

/** An overshooting ease-out: the droplets pop slightly past their spot and settle. */
const POP = { duration: 550, ease: "cubic-bezier(0.34, 1.56, 0.64, 1)" } as const;

interface ControlItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  x: number;
  y: number;
}

const BUTTON_CLASS =
  "flex h-12 w-12 items-center justify-center rounded-full text-copy-muted transition-[color,opacity] duration-[150ms,250ms] hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none";

interface CanvasControlsProps {
  history: Pick<CanvasHistoryControls, "undo" | "redo" | "canUndo" | "canRedo">;
}

/**
 * The floating zoom and history controls (17-canvas-ergonomics), folded into
 * one liquid button: history rises above it, zoom runs to its right. History is
 * this tab's own stack (`useCanvasHistory`): undo takes back your last change
 * here.
 *
 * The keyboard shortcuts are registered here because this is the one component
 * that already holds all four handlers. They work whether or not it is open.
 */
export function CanvasControls({ history }: CanvasControlsProps) {
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const { undo, redo, canUndo, canRedo } = history;
  const [open, setOpen] = useState(false);

  useKeyboardShortcuts({ flow, undo, redo });

  const items: ControlItem[] = [
    { label: "Undo", icon: Undo2, onClick: undo, disabled: !canUndo, x: 0, y: -OFFSETS[0] },
    { label: "Redo", icon: Redo2, onClick: redo, disabled: !canRedo, x: 0, y: -OFFSETS[1] },
    { label: "Zoom out", icon: ZoomOut, onClick: () => void flow.zoomOut(TRANSITION), x: OFFSETS[0], y: 0 },
    { label: "Fit view", icon: Maximize, onClick: () => void flow.fitView(TRANSITION), x: OFFSETS[1], y: 0 },
    { label: "Zoom in", icon: ZoomIn, onClick: () => void flow.zoomIn(TRANSITION), x: OFFSETS[2], y: 0 },
  ];

  return (
    <Liquid
      {...LIQUID_SURFACE}
      filterPadding={OFFSETS[2] + 24}
      role="toolbar"
      aria-label="Canvas controls"
      className="relative h-12 w-12"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) setOpen(false);
      }}
    >
      {items.map(({ label, icon: Icon, onClick, disabled, x, y }, index) => (
        <Liquid.Item
          key={label}
          x={open ? x : 0}
          y={open ? y : 0}
          transition={POP}
          delay={index * 30}
          className="absolute inset-0"
        >
          {/* Closed, the items sit under the toggle: hidden and out of the tab order. */}
          <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            inert={!open}
            className={`${BUTTON_CLASS} ${open ? (disabled ? "opacity-40" : "opacity-100") : "opacity-0"}`}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </button>
        </Liquid.Item>
      ))}
      <Liquid.Item className="absolute inset-0">
        <button
          type="button"
          aria-label={open ? "Hide canvas controls" : "Show canvas controls"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className={BUTTON_CLASS}
        >
          <Plus
            aria-hidden
            className={`h-5 w-5 transition-transform duration-[400ms] ease-[var(--ease-smooth-out)] motion-reduce:transition-none ${open ? "rotate-45" : ""}`}
          />
        </button>
      </Liquid.Item>
    </Liquid>
  );
}
