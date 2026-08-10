"use client";

import type { ReactNode } from "react";

import {
  CSS_SHAPE_RADIUS,
  buildShapeGeometry,
  isSvgShape,
} from "@/lib/node-shape-geometry";
import { cn } from "@/lib/utils";
import { NODE_COLORS, type NodeColor, type NodeShape } from "@/types/canvas";

/**
 * The drawn body of a node (13-node-shape), shared by the canvas node renderer
 * and the shape panel's drag ghost so a dragged preview cannot drift from what
 * actually lands on the canvas.
 */

/** 35% alpha on the node's accent — subtle at rest, full strength when selected. */
const REST_STROKE_ALPHA = "59";
const REST_STROKE_WIDTH = 1.5;
const SELECTED_STROKE_WIDTH = 2.5;

/**
 * Label padding per shape. The SVG shapes do not fill their bounding box, so
 * their text needs pulling in past the slanted or curved edges — proportional
 * so it holds at any node size.
 */
const CONTENT_PADDING: Record<NodeShape, string> = {
  rectangle: "px-3 py-2",
  pill: "px-5 py-2",
  circle: "px-6 py-4",
  diamond: "px-[22%] py-[14%]",
  hexagon: "px-[16%] py-2",
  cylinder: "px-4 pb-3 pt-[20%]",
};

interface NodeShapeFrameProps {
  shape: NodeShape;
  color: NodeColor;
  /** The node's rendered size — the SVG viewBox, so shapes scale with it. */
  width: number;
  height: number;
  selected?: boolean;
  /**
   * Applied to the shape's own wrapper rather than the React Flow node, which
   * owns `transform` for positioning — an arrival animation there would fight
   * it and drag the node across the canvas.
   */
  className?: string;
  children?: ReactNode;
}

export function NodeShapeFrame({
  shape,
  color,
  width,
  height,
  selected = false,
  className,
  children,
}: NodeShapeFrameProps) {
  const { fill, text } = NODE_COLORS[color];
  const strokeWidth = selected ? SELECTED_STROKE_WIDTH : REST_STROKE_WIDTH;
  const stroke = selected ? text : `${text}${REST_STROKE_ALPHA}`;

  return (
    <div
      className={cn("relative h-full w-full", className)}
      style={{ color: text }}
    >
      {isSvgShape(shape) ? (
        <ShapeSvg
          shape={shape}
          width={width}
          height={height}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: fill,
            border: `${strokeWidth}px solid ${stroke}`,
            borderRadius: CSS_SHAPE_RADIUS[shape],
          }}
        />
      )}
      <div
        className={`relative flex h-full w-full items-center justify-center text-center text-sm ${CONTENT_PADDING[shape]}`}
      >
        {children}
      </div>
    </div>
  );
}

interface ShapeSvgProps extends Omit<NodeShapeFrameProps, "color" | "selected"> {
  fill: string;
  stroke: string;
  strokeWidth: number;
}

function ShapeSvg({
  shape,
  width,
  height,
  fill,
  stroke,
  strokeWidth,
}: ShapeSvgProps) {
  if (!isSvgShape(shape)) {
    return null;
  }

  const { outline, detail } = buildShapeGeometry(
    shape,
    { width, height },
    strokeWidth
  );

  return (
    // The viewBox is the node's own pixel size, so the shape tracks a resize
    // without the stroke stretching with it.
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <path
        d={outline}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
      {detail ? (
        <path
          d={detail}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
