import { redirect } from "next/navigation";

import { EditorShell } from "@/components/editor/editor-shell";
import { getCurrentIdentity } from "@/lib/access";
import { getOwnedDiagrams, getSharedDiagrams } from "@/lib/diagrams";

// Server component: both diagram lists are fetched here and passed down, so the
// sidebar never fetches on mount. Mutations go through the API routes.
export default async function EditorPage() {
  const identity = await getCurrentIdentity();

  // proxy.ts already gates this route, so this is a backstop — it also narrows
  // `identity` for the queries below.
  if (!identity) {
    redirect(process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL as string);
  }

  const [ownedDiagrams, sharedDiagrams] = await Promise.all([
    getOwnedDiagrams(identity.userId),
    getSharedDiagrams(identity),
  ]);

  return (
    <EditorShell
      ownedDiagrams={ownedDiagrams}
      sharedDiagrams={sharedDiagrams}
    />
  );
}
