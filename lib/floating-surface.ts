/**
 * The material every floating control sits on: the navbar chips, the bottom
 * dock and (through `LIQUID_SURFACE`) the gooey canvas controls. Radius is left
 * to each piece, since a pill and a card need different corners.
 */
export const FLOATING_SURFACE = "border border-surface-border bg-elevated shadow-lg shadow-page/60";

/**
 * `FLOATING_SURFACE` spelled for liquid-gooey, which paints its own silhouette
 * and takes raw CSS: Tailwind's `shadow-lg` layers in `--bg-base` at 60%, and
 * the border becomes an inset ring so it follows the merged goo shape.
 */
export const LIQUID_SURFACE = {
  fill: "var(--bg-elevated)",
  shadow:
    "0 10px 15px -3px rgb(7 8 10 / 0.6), 0 4px 6px -4px rgb(7 8 10 / 0.6), inset 0 0 0 1px var(--border-default)",
} as const;
