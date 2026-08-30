import { Prisma } from "@/generated/prisma/client";
import { resolveIdentitySource } from "@/lib/agent-identity";
import { NOT_TOMBSTONED } from "@/lib/diagram-lifecycle";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_DIAGRAM_NAME,
  jsonError,
  parseDiagramId,
  parseDiagramName,
  readJsonBody,
} from "@/lib/api-requests";

const UNIQUE_VIOLATION = "P2002";

// Auth is enforced here rather than in proxy.ts so unauthenticated API calls
// get a JSON 401 instead of a redirect to the sign-in page.

// Bearer-accepting (agent-auth contract): resolving just the userId is all a
// list-my-diagrams query ever needed, cheap or not, so this reuses the same
// no-Clerk-call identity step `authorizeDiagram` uses for its owner path.
export async function GET(request: Request): Promise<Response> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return jsonError("Unauthorized", 401);
  }

  const diagrams = await prisma.diagram.findMany({
    where: { ownerId: identitySource.userId, ...NOT_TOMBSTONED },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ diagrams });
}

// Bearer-accepting for the same reason GET is: a headless create needs to make
// the diagram before it can import a graph into it, and it authenticates with
// the same agent token. Minting a token is the one route that stays
// cookie-only (app/api/agent/tokens/route.ts).
export async function POST(request: Request): Promise<Response> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return jsonError("Unauthorized", 401);
  }

  const userId = identitySource.userId;

  const body = await readJsonBody(request);
  const name = parseDiagramName(body, DEFAULT_DIAGRAM_NAME);

  if (!name) {
    return jsonError("Invalid diagram name", 400);
  }

  const id = parseDiagramId(body);

  if (!id.ok) {
    return jsonError("Invalid diagram ID", 400);
  }

  try {
    // `id.id` is the slug+suffix room ID from the create dialog. Omitted, the
    // schema's cuid() default applies — either way the ID is not sequential.
    const diagram = await prisma.diagram.create({
      data: { ...(id.id ? { id: id.id } : {}), ownerId: userId, name },
    });

    return Response.json({ diagram }, { status: 201 });
  } catch (caught) {
    // The create dialog regenerates its suffix after this response, so the
    // user's next submit retries with a different room ID.
    if (
      caught instanceof Prisma.PrismaClientKnownRequestError &&
      caught.code === UNIQUE_VIOLATION
    ) {
      return jsonError("That diagram ID is taken. Please try again.", 409);
    }

    throw caught;
  }
}
