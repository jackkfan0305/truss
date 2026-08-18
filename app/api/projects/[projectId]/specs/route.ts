import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { specFileName } from "@/lib/spec-storage";
import type { ProjectSpecSummary } from "@/types/project";

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * Newest first, capped. The sidebar list is a scrollable panel, not a paginated
 * view, and a project that has generated hundreds of specs does not need all of
 * them in one response.
 */
const MAX_SPECS = 50;

/**
 * This project's specs, as metadata (29-spec-ui-integration).
 *
 * The one read `28` left out: the download route serves a single document, and
 * the Specs tab needs to know which documents exist before it can ask for one.
 *
 * `filePath` is deliberately not selected. It is a private Blob pointer that the
 * browser cannot fetch anyway, so putting it in a response would only publish
 * the storage layout. The download route resolves it with the store token.
 *
 * `requireOwner: false`, matching the download route: a collaborator edits the
 * canvas a spec is written from, so a collaborator can see the specs.
 */
export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId } = await params;

  const access = await authorizeProject(request, projectId, { requireOwner: false });

  if (!access.ok) {
    return access.response;
  }

  const rows = await prisma.projectSpec.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: MAX_SPECS,
    select: { id: true, createdAt: true },
  });

  // The file name is computed here, by the same function the download route
  // puts in `Content-Disposition`, so the name in the list is the name the file
  // saves under rather than a second guess at it.
  const specs: ProjectSpecSummary[] = rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    fileName: specFileName(row.createdAt),
  }));

  return Response.json(
    { specs },
    // Private per-project content behind a cookie check, same as the download.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
