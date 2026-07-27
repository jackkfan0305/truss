import type { NodeShape, NodeSize } from "@/types/canvas";

/**
 * Node shape drawing rules (13-node-shape).
 *
 * Kept out of the component so the path maths is checkable without a DOM —
 * `scripts/verify-canvas.ts` asserts the paths stay inside the node box.
 *
 * Per `context/ui-context.md`, diamond/hexagon/cylinder are inline SVG; the
 * other three are plain CSS boxes that only differ by corner radius.
 */
export const SVG_SHAPES = ["diamond", "hexagon", "cylinder"] as const;

export type SvgShape = (typeof SVG_SHAPES)[number];

export function isSvgShape(shape: NodeShape): shape is SvgShape {
  return SVG_SHAPES.includes(shape as SvgShape);
}

/** Matches the `rounded-xl` step for inline UI in `context/ui-context.md`. */
export const CSS_SHAPE_RADIUS: Record<Exclude<NodeShape, SvgShape>, string> = {
  rectangle: "0.75rem",
  pill: "9999px",
  circle: "50%",
};

export interface ShapeGeometry {
  /** The filled body of the shape. */
  outline: string;
  /** Stroke-only line drawn over the body — only the cylinder's front rim. */
  detail?: string;
}

/**
 * All coordinates are in node pixels, so the caller's `viewBox` is the node's
 * own size and strokes never scale unevenly.
 *
 * `strokeWidth` matters to the geometry: a stroke straddles its path, so every
 * edge is inset by half of it or the outer half gets clipped by the SVG box.
 */
export function buildShapeGeometry(
  shape: SvgShape,
  { width, height }: NodeSize,
  strokeWidth: number
): ShapeGeometry {
  const inset = strokeWidth / 2;
  const right = width - inset;
  const bottom = height - inset;
  const midX = width / 2;
  const midY = height / 2;

  if (shape === "diamond") {
    return {
      outline: `M ${midX} ${inset} L ${right} ${midY} L ${midX} ${bottom} L ${inset} ${midY} Z`,
    };
  }

  if (shape === "hexagon") {
    // The slanted ends take a fifth of the width each, clamped so a narrow
    // hexagon degenerates into a diamond rather than crossing over itself.
    const notch = Math.min(width * 0.2, midX - inset);

    return {
      outline:
        `M ${notch} ${inset} L ${width - notch} ${inset} ` +
        `L ${right} ${midY} L ${width - notch} ${bottom} ` +
        `L ${notch} ${bottom} L ${inset} ${midY} Z`,
    };
  }

  // Cylinder: a body between two half-ellipses. The top rim is drawn twice —
  // once as the body's top edge, once as the visible front curve.
  const radiusY = Math.min(height * 0.16, midY - inset);
  const radiusX = midX - inset;
  const top = inset + radiusY;
  const base = bottom - radiusY;

  return {
    outline:
      `M ${inset} ${top} A ${radiusX} ${radiusY} 0 0 1 ${right} ${top} ` +
      `L ${right} ${base} A ${radiusX} ${radiusY} 0 0 1 ${inset} ${base} Z`,
    detail: `M ${inset} ${top} A ${radiusX} ${radiusY} 0 0 0 ${right} ${top}`,
  };
}
