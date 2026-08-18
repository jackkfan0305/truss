import { Prisma } from "@/generated/prisma/client";
import { resolveIdentitySource } from "@/lib/agent-identity";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PROJECT_NAME,
  jsonError,
  parseProjectId,
  parseProjectName,
  readJsonBody,
} from "@/lib/project-requests";

const UNIQUE_VIOLATION = "P2002";

// Auth is enforced here rather than in proxy.ts so unauthenticated API calls
// get a JSON 401 instead of a redirect to the sign-in page.

// Bearer-accepting (agent-auth contract): resolving just the userId is all a
// list-my-projects query ever needed, cheap or not, so this reuses the same
// no-Clerk-call identity step `authorizeProject` uses for its owner path.
export async function GET(request: Request): Promise<Response> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return jsonError("Unauthorized", 401);
  }

  const projects = await prisma.project.findMany({
    where: {
      ownerId: identitySource.userId,
      status: { notIn: ["DELETING", "DELETED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ projects });
}

// Bearer-accepting for the same reason GET is: a headless create needs to make
// the project before it can import a graph into it, and it authenticates with
// the same agent token. Minting a token is the one route that stays
// cookie-only (app/api/agent/tokens/route.ts).
export async function POST(request: Request): Promise<Response> {
  const identitySource = await resolveIdentitySource(request);

  if (!identitySource) {
    return jsonError("Unauthorized", 401);
  }

  const userId = identitySource.userId;

  const body = await readJsonBody(request);
  const name = parseProjectName(body, DEFAULT_PROJECT_NAME);

  if (!name) {
    return jsonError("Invalid project name", 400);
  }

  const id = parseProjectId(body);

  if (!id.ok) {
    return jsonError("Invalid project ID", 400);
  }

  try {
    // `id.id` is the slug+suffix room ID from the create dialog. Omitted, the
    // schema's cuid() default applies — either way the ID is not sequential.
    const project = await prisma.project.create({
      data: { ...(id.id ? { id: id.id } : {}), ownerId: userId, name },
    });

    return Response.json({ project }, { status: 201 });
  } catch (caught) {
    // The create dialog regenerates its suffix after this response, so the
    // user's next submit retries with a different room ID.
    if (
      caught instanceof Prisma.PrismaClientKnownRequestError &&
      caught.code === UNIQUE_VIOLATION
    ) {
      return jsonError("That project ID is taken. Please try again.", 409);
    }

    throw caught;
  }
}
