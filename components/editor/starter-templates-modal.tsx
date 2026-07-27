"use client";

import { EditorDialog } from "@/components/editor/editor-dialog";
import {
  CANVAS_TEMPLATES,
  getNodeBox,
  getTemplateBounds,
  type CanvasTemplate,
} from "@/components/editor/starter-templates";
import { Button } from "@/components/ui/button";
import { buildShapeGeometry, isSvgShape } from "@/lib/node-shape-geometry";
import { NODE_COLORS, type CanvasNode } from "@/types/canvas";

/** Flow units of breathing room around the diagram inside the preview box. */
const PREVIEW_PADDING = 32;

/**
 * Every stroke in the preview is `non-scaling-stroke`, so this is device pixels
 * rather than flow units — a 1.5px node border shrunk by the preview's ~0.15
 * scale factor would not survive rasterisation.
 */
const PREVIEW_STROKE = 1;

/** The 0.75rem of `CSS_SHAPE_RADIUS.rectangle`, in the SVG's user units. */
const RECTANGLE_RADIUS = 12;

interface StarterTemplatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (template: CanvasTemplate) => void;
}

/**
 * The starter template picker (18-starter-templates). Presentational: it knows
 * which template was chosen, and the canvas owns what importing one does.
 */
export function StarterTemplatesModal({
  open,
  onOpenChange,
  onImport,
}: StarterTemplatesModalProps) {
  const handleImport = (template: CanvasTemplate) => {
    onImport(template);
    onOpenChange(false);
  };

  return (
    <EditorDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Start from a template"
      description="Importing replaces everything currently on the canvas."
      className="sm:max-w-3xl"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
      }
    >
      <ul className="grid max-h-[60vh] gap-3 overflow-y-auto sm:grid-cols-2">
        {CANVAS_TEMPLATES.map((template) => (
          <li
            key={template.id}
            className="flex flex-col gap-3 rounded-2xl border border-surface-border bg-surface p-3"
          >
            <TemplatePreview template={template} />

            <div className="flex-1">
              <h3 className="text-sm font-medium text-copy-primary">
                {template.name}
              </h3>
              <p className="mt-1 text-xs text-copy-muted">
                {template.description}
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => handleImport(template)}
            >
              Import {template.name}
            </Button>
          </li>
        ))}
      </ul>
    </EditorDialog>
  );
}

/**
 * A miniature of the template, drawn as one inline SVG — no React Flow instance
 * for something that never pans, zooms or responds to a pointer.
 *
 * Fitting is the `viewBox` plus `preserveAspectRatio`: the browser scales the
 * template's own bounds into the fixed preview box, so no scale factor is
 * computed here and a template laid out anywhere in flow space still centres.
 */
function TemplatePreview({ template }: { template: CanvasTemplate }) {
  const bounds = getTemplateBounds(template.nodes);
  const centers = new Map(
    template.nodes.map((node) => {
      const { x, y, width, height } = getNodeBox(node);

      return [node.id, { x: x + width / 2, y: y + height / 2 }];
    })
  );

  return (
    <svg
      viewBox={[
        bounds.x - PREVIEW_PADDING,
        bounds.y - PREVIEW_PADDING,
        bounds.width + PREVIEW_PADDING * 2,
        bounds.height + PREVIEW_PADDING * 2,
      ].join(" ")}
      preserveAspectRatio="xMidYMid meet"
      className="h-28 w-full rounded-xl bg-page"
      aria-hidden
    >
      {/* Straight centre-to-centre lines, not the canvas's right-angle route:
          at preview scale the routing is below a pixel of difference. Drawn
          first so a line runs under the node it ends at, not over it. */}
      {template.edges.map((edge) => {
        const from = centers.get(edge.source);
        const to = centers.get(edge.target);

        if (!from || !to) {
          return null;
        }

        return (
          <line
            key={edge.id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--canvas-edge)"
            strokeOpacity={0.4}
            strokeWidth={PREVIEW_STROKE}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {template.nodes.map((node) => (
        <PreviewNode key={node.id} node={node} />
      ))}
    </svg>
  );
}

function PreviewNode({ node }: { node: CanvasNode }) {
  const { x, y, width, height } = getNodeBox(node);
  const { shape, color } = node.data;
  const { fill, text } = NODE_COLORS[color];
  const paint = {
    fill,
    stroke: text,
    strokeWidth: PREVIEW_STROKE,
    vectorEffect: "non-scaling-stroke",
  } as const;

  return (
    // Translated rather than offset per coordinate, so the SVG shapes can reuse
    // `buildShapeGeometry` exactly as the canvas draws it — in node-local units.
    <g transform={`translate(${x} ${y})`}>
      {isSvgShape(shape) ? (
        <path
          d={buildShapeGeometry(shape, { width, height }, PREVIEW_STROKE).outline}
          strokeLinejoin="round"
          {...paint}
        />
      ) : shape === "circle" ? (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={width / 2}
          ry={height / 2}
          {...paint}
        />
      ) : (
        <rect
          width={width}
          height={height}
          rx={shape === "pill" ? height / 2 : RECTANGLE_RADIUS}
          {...paint}
        />
      )}
    </g>
  );
}
