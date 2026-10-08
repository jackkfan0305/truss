import { CATALOG_ENTRIES, type CatalogResponse } from "@/lib/catalog";

/**
 * Static catalog metadata for browser and terminal agents. It holds no owner
 * data, so it needs no sign-in: a terminal agent can read it before linking.
 */
export function GET(): Response {
  const body: CatalogResponse = { catalogVersion: 1, entries: CATALOG_ENTRIES };
  return Response.json(body);
}
