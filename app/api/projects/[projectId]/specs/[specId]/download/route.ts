import { get } from "@vercel/blob";

import { prisma } from "@/lib/prisma";
import { authorizeProject } from "@/lib/project-access";
import { jsonError } from "@/lib/project-requests";
import {
  SPEC_BLOB_ACCESS,
  SPEC_CONTENT_TYPE,
  specFileName,
} from "@/lib/spec-storage";

interface RouteParams {
  params: Promise<{ projectId: string; specId: string }>;
}

/**
 * Downloads a generated spec as a Markdown file (28-spec-persistence-download).
 *
 * The document lives in a private Blob store, so its URL is not fetchable on its
 * own — this handler is the only way to read one, and it is where access is
 * decided. `requireOwner: false`: a collaborator can ask for a spec and edits the
 * canvas it was written from, so a collaborator can read it back.
 */
export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { projectId, specId } = await params;

  const access = await authorizeProject(request, projectId, { requireOwner: false });

  if (!access.ok) {
    return access.response;
  }

  /*
   * `projectId` is part of the lookup rather than something checked after it:
   * another project's spec is simply not found here, so there is no ordering in
   * which the wrong document gets fetched and rejected afterwards.
   *
   * Unknown ID and wrong-project ID collapse into the same 404 on purpose — the
   * caller has access to *this* project, and telling them a spec ID exists
   * elsewhere is not theirs to know.
   */
  const spec = await prisma.projectSpec.findFirst({
    where: { id: specId, projectId },
    select: { filePath: true, createdAt: true },
  });

  if (!spec) {
    return jsonError("Spec not found", 404);
  }

  let stream: ReadableStream<Uint8Array>;

  try {
    /*
     * `get` rather than a plain `fetch`: a private blob's URL is not readable
     * without the store token, which `get` attaches.
     *
     * `useCache: false` reads origin storage. A spec pathname is written once,
     * so the CDN copy is normally identical — except for the one case that
     * matters, a retried run replacing its own document seconds after the first
     * attempt cached it.
     */
    const result = await get(spec.filePath, {
      access: SPEC_BLOB_ACCESS,
      useCache: false,
    });

    // Only conditional requests produce a 304, and this makes none — the check
    // is what proves `stream` is non-null to the type system.
    if (!result || result.statusCode !== 200) {
      throw new Error(`Blob read returned ${result?.statusCode ?? "nothing"}`);
    }

    stream = result.stream;
  } catch (error: unknown) {
    // The pointer is in the database but the document did not come back. A 404
    // here would read as "no such spec" and hide a storage failure.
    console.error(`Spec download failed for ${projectId}/${specId}`, error);
    return jsonError("Could not read the spec", 502);
  }

  // Streamed straight through rather than buffered: a spec is several thousand
  // tokens of prose and nothing in this handler needs to look at it.
  return new Response(stream, {
    headers: {
      "Content-Type": SPEC_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${specFileName(spec.createdAt)}"`,
      // Model-authored Markdown served from our own origin. Nothing else pins
      // the type, and a body sniffed as HTML would make this a stored XSS.
      "X-Content-Type-Options": "nosniff",
      // Private per-project content behind a cookie check: a shared cache must
      // not be allowed to hand it to the next caller.
      "Cache-Control": "private, no-store",
    },
  });
}
