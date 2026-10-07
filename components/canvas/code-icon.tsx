import { Box, Braces, Folder, List, Play, SquareFunction, Type, type LucideIcon } from "lucide-react";

import { getCodeCatalogEntry, type CodeIconName } from "@/lib/code-catalog";
import { cn } from "@/lib/utils";

const ICONS: Record<CodeIconName, LucideIcon> = {
  entry: Play, function: SquareFunction, method: Braces, type: Type, enum: List, class: Box, module: Folder,
};

export function CodeIcon({ catalogId, className }: { catalogId: string; className?: string }) {
  const entry = getCodeCatalogEntry(catalogId);
  if (!entry) return null;
  const Icon = ICONS[entry.icon];
  return <Icon className={cn("h-4 w-4 shrink-0", className)} aria-hidden />;
}
