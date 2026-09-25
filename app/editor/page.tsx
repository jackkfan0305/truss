import { redirect } from "next/navigation";

import { EditorShell } from "@/components/editor/editor-shell";
import { getCurrentIdentity } from "@/lib/access";
import { getOwnedDiagrams } from "@/lib/diagrams";

// Server component: the diagram list is fetched here and passed down, so the
// sidebar never fetches on mount. Mutations go through the API routes.
export default async function EditorPage() {
  const identity = await getCurrentIdentity();

  // proxy.ts already gates this route, so this is a backstop — it also narrows
  // `identity` for the queries below.
  if (!identity) {
    redirect(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL as string);
  }

  const ownedDiagrams = await getOwnedDiagrams(identity.userId);

  return (
    <EditorShell
      ownedDiagrams={ownedDiagrams}
    />
  );
}
