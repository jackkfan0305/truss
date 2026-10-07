"use client";

import { useState } from "react";

import { getAwsCatalogEntry } from "@/lib/aws-catalog";
import { cn } from "@/lib/utils";

/**
 * Catalog icon in its official colours. A missing catalog entry or a failed
 * load shows the readable name instead, so identity never depends on the image.
 */
export function AwsIcon({ catalogId, className }: { catalogId: string; className?: string }) {
  const entry = getAwsCatalogEntry(catalogId);
  const [failedPath, setFailedPath] = useState<string | null>(null);

  if (!entry) {
    return <span className="text-xs text-copy-muted">Unknown AWS item</span>;
  }
  if (failedPath === entry.iconPath) {
    return <span className="text-xs text-copy-muted">{entry.name}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- local static SVG, sized by the node
    <img
      src={entry.iconPath}
      alt=""
      draggable={false}
      className={cn("h-8 w-8 shrink-0", className)}
      onError={() => setFailedPath(entry.iconPath)}
    />
  );
}
