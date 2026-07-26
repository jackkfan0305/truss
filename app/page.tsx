import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// `/` is a router, not a page: signed-in users land in the editor, everyone
// else goes to sign-in. The middleware already gates this route, so the
// unauthenticated branch is a backstop rather than the primary path.
export default async function Home() {
  const { isAuthenticated } = await auth();

  redirect(
    isAuthenticated
      ? "/editor"
      : (process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL as string)
  );
}
