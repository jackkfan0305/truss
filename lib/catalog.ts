import { AWS_CATALOG, getAwsCatalogEntry, type AwsCatalogEntry } from "@/lib/aws-catalog";
import { CODE_CATALOG, getCodeCatalogEntry, type CodeCatalogEntry } from "@/lib/code-catalog";

/** Both catalogs as one list, tagged so a reader can tell the families apart. */
export type CatalogEntryWithFamily =
  | (AwsCatalogEntry & { readonly family: "aws" })
  | (CodeCatalogEntry & { readonly family: "code" });

/** Body of `GET /api/agent/catalog`. */
export interface CatalogResponse {
  readonly catalogVersion: 1;
  readonly entries: readonly CatalogEntryWithFamily[];
}

export const CATALOG_ENTRIES: readonly CatalogEntryWithFamily[] = [
  ...AWS_CATALOG.map((entry) => ({ ...entry, family: "aws" as const })),
  ...CODE_CATALOG.map((entry) => ({ ...entry, family: "code" as const })),
];

export function getAnyCatalogEntry(id: string): AwsCatalogEntry | CodeCatalogEntry | undefined {
  return getAwsCatalogEntry(id) ?? getCodeCatalogEntry(id);
}

/** A `boundary` node may name a boundary from either family. */
export function isBoundaryCatalogId(id: string): boolean {
  return getAnyCatalogEntry(id)?.kind === "boundary";
}
