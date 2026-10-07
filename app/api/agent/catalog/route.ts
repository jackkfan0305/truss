import { AWS_CATALOG, type AwsCatalogResponse } from "@/lib/aws-catalog";

/**
 * Static catalog metadata for browser and terminal agents. It holds no owner
 * data, so it needs no sign-in: a terminal agent can read it before linking.
 */
export function GET(): Response {
  const body: AwsCatalogResponse = { catalogVersion: 1, entries: AWS_CATALOG };
  return Response.json(body);
}
