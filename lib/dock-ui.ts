import { AWS_CATALOG } from "@/lib/aws-catalog";

/** Category chips for the dock, in catalog order. */
export const AWS_CATEGORIES = [...new Set(AWS_CATALOG.map((entry) => entry.category))];

/** Shared by every dock section so the grids look identical. */
export const DOCK_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] content-start gap-1.5";
export const DOCK_TILE_CLASS =
  "dock-tile flex cursor-grab flex-col items-center gap-1.5 rounded-[10px] px-1 py-2.5 text-center text-[11px] text-copy-secondary transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-brand active:cursor-grabbing";

/** Stagger for the tile unblur: a short wait for the dock to grow, then 18ms per tile. */
export const tileDelay = (index: number) => ({ animationDelay: `${120 + index * 18}ms` });
