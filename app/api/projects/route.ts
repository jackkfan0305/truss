import { auth } from "@clerk/nextjs/server";

import { Prisma } from "@/generated/prisma/client";
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

export async function GET(): Promise<Response> {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

  const projects = await prisma.project.findMany({
    where: { ownerId: userId },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ projects });
}

export async function POST(request: Request): Promise<Response> {
  const { userId } = await auth();

  if (!userId) {
    return jsonError("Unauthorized", 401);
  }

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
