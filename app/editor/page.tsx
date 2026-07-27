import { redirect } from "next/navigation";

import { EditorShell } from "@/components/editor/editor-shell";
import { getCurrentIdentity } from "@/lib/project-access";
import { getOwnedProjects, getSharedProjects } from "@/lib/projects";

// Server component: both project lists are fetched here and passed down, so the
// sidebar never fetches on mount. Mutations go through the API routes.
export default async function EditorPage() {
  const identity = await getCurrentIdentity();

  // proxy.ts already gates this route, so this is a backstop — it also narrows
  // `identity` for the queries below.
  if (!identity) {
    redirect(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL as string);
  }

  const [ownedProjects, sharedProjects] = await Promise.all([
    getOwnedProjects(identity.userId),
    getSharedProjects(identity),
  ]);

  return (
    <EditorShell
      ownedProjects={ownedProjects}
      sharedProjects={sharedProjects}
    />
  );
}
